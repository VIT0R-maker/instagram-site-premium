import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { hash } from '../src/core.mjs';
import { publishSite } from '../src/publish.mjs';
import { siteFixture } from './fixtures.mjs';
const config=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
function mock() {
  mkdirSync('test-output',{recursive:true});const root=mkdtempSync(path.resolve('test-output/publication-')),store=new Store(root);
  const job={id:'mock-publication',username:'atelier',repo:'site-atelier-stable'},files=siteFixture().files;
  files['assets/hero.jpg']=Buffer.from('image fixture bytes');
  const approval={approved:true,filesHash:hash(Object.fromEntries(Object.entries(files).map(([f,b])=>[f,hash(b)])))};
  store.checkpoint(job.id,'preflight',{owner:'owner'});
  const state={repo:null,head:'initial',pages:false,creates:0,refWrites:0,blobs:0,build:'built',buildCalls:0,temporary:false};
  const p={store,job,config:{...config,pagesPollingDeadline:0.03},github:async(route,opts={})=>{
    const method=opts.method||'GET',base='/repos/owner/'+job.repo;
    if(route==='/user/repos'){state.creates++;state.repo={owner:{login:'owner'},description:opts.body.description,default_branch:'main',html_url:'https://github.com/owner/'+job.repo};return {data:state.repo,status:201};}
    if(route===base)return state.repo?{data:state.repo,status:200}:{status:404,data:null};
    if(route===base+'/git/ref/heads/main')return {data:{object:{sha:state.head}}};
    if(route===base+'/git/blobs'){state.blobs++;return {data:{sha:'blob-'+state.blobs}};}
    if(route===base+'/git/trees')return {data:{sha:'tree'}};
    if(route===base+'/git/commits')return {data:{sha:'site-commit'}};
    if(route===base+'/git/refs/heads/main'){state.refWrites++;state.head=opts.body.sha;assert.equal(opts.body.force,false);return {data:{}};}
    if(route===base+'/pages'){
      if(method==='POST')state.pages=true;
      return state.pages?{data:{source:{branch:'main',path:'/'},html_url:'https://owner.github.io/'+job.repo+'/'},status:200}:{status:404};
    }
    if(route===base+'/pages/builds/latest'){state.buildCalls++;return {data:{commit:'site-commit',status:state.temporary&&state.buildCalls===1?'building':state.build}};}
    throw Error('Unexpected mocked route: '+route);
  }};
  const fetchPublic=async raw=>{const name=new URL(raw).pathname.split('/').slice(2).join('/');return {status:200,bytes:files[name]};};
  return {p,files,approval,state,fetchPublic};
}
test('publicação faz um commit coerente, valida subcaminho e retoma sem duplicar repo',async()=>{
  const m=mock();let fetches=0;
  const r=await publishSite(m.p,m.files,m.approval,async u=>{fetches++;assert(new URL(u).pathname.startsWith('/site-atelier-stable/'));return m.fetchPublic(u);},async()=>{});
  assert.equal(r.status,'published');assert.equal(m.state.creates,1);assert.equal(m.state.refWrites,1);assert(fetches>=4);
  await publishSite(m.p,m.files,m.approval,m.fetchPublic,async()=>{});assert.equal(m.state.creates,1);assert.equal(m.state.refWrites,1);m.p.store.close();
});
test('Pages pendente e 404 temporário são recuperados antes de declarar sucesso',async()=>{
  const m=mock();m.state.temporary=true;let publicCalls=0;
  const r=await publishSite(m.p,m.files,m.approval,async u=>{if(publicCalls++===0)return {status:404,bytes:Buffer.from('not yet')};return m.fetchPublic(u);},async()=>{});
  assert.equal(r.status,'published');assert(m.state.buildCalls>=3);m.p.store.close();
});
test('imagem pública ausente, build falho e qualidade ausente impedem sucesso',async()=>{
  const m=mock();await assert.rejects(publishSite(m.p,m.files,{approved:false},m.fetchPublic),e=>e.code==='QUALITY_GATE');assert.equal(m.state.creates,0);
  m.state.build='errored';await assert.rejects(publishSite(m.p,m.files,m.approval,m.fetchPublic,async()=>{}),e=>e.code==='PAGES_BUILD');assert(m.p.store.checkpoint(m.p.job.id,'repository'));
  m.state.build='built';await assert.rejects(publishSite(m.p,m.files,m.approval,async u=>u.endsWith('.jpg')?{status:404,bytes:Buffer.alloc(0)}:m.fetchPublic(u),async()=>new Promise(r=>setTimeout(r,2))),e=>e.code==='PAGES_PENDING');
  assert.equal(m.p.store.checkpoint(m.p.job.id,'publication'),undefined);m.p.store.close();
});
test('colisão com repositório de outro trabalho não altera seus arquivos',async()=>{
  const m=mock();m.state.repo={owner:{login:'owner'},description:'other job',default_branch:'main'};
  await assert.rejects(publishSite(m.p,m.files,m.approval,m.fetchPublic),e=>e.code==='REPO_CONFLICT');assert.equal(m.state.blobs,0);assert.equal(m.state.refWrites,0);m.p.store.close();
});
test('SQLite em oito processos concorrentes: contador físico do provedor permanece um',async()=>{
  const root=mkdtempSync(path.resolve('test-output/process-'));new Store(root).close();
  const script=fileURLToPath(new URL('./claim-process.mjs',import.meta.url));
  await Promise.all(Array.from({length:8},()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[script,root],{windowsHide:true,stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(errors)));})));
  assert.equal(readFileSync(path.join(root,'requests.txt'),'utf8').trim().split('\n').length,1);
  const s=new Store(root);assert.equal(s.claude('process-race').calls,1);assert.equal(s.claude('process-race').response,'saved');s.close();
});
