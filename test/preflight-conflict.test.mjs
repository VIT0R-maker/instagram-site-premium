import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Fault } from '../src/core.mjs';
import { Store } from '../src/store.mjs';
import { resumeJob } from '../src/resume.mjs';
import { publicationPreflight } from '../src/publish.mjs';

function fixture({ conflicts=0, missing=false, error=null, marker=true }={}) {
  const base='/repos/owner/permission-probe',route=base+'/contents/permission-check.txt';
  const state={sha:missing?null:'initial-sha',gets:0,puts:[],waits:[],pages:0,version:0,races:0};
  const p={env:{GITHUB_PROBE_REPO:'permission-probe'},github:async(url,opts={})=>{
    const method=opts.method||'GET';
    if(url==='/user')return {data:{login:'owner',type:'User'},headers:{'x-oauth-scopes':'public_repo'}};
    if(url===base)return {data:{owner:{login:'owner'},private:false,description:marker?'instagram-site-premium permission probe':'other repository',permissions:{admin:true,push:true},default_branch:'main'}};
    if(url.split('?')[0]===route&&method==='GET') {
      state.gets++;
      return state.sha?{status:200,data:{type:'file',sha:state.sha}}:{status:404,data:null};
    }
    if(url===route&&method==='PUT') {
      state.puts.push(structuredClone(opts.body));
      if(error)throw error;
      if(state.puts.length<=conflicts)state.sha='external-'+(++state.version);
      if((opts.body.sha||null)!==state.sha) {
        state.races++;
        throw new Fault('HTTP_409',`is at ${state.sha} but expected ${opts.body.sha}`,{status:409});
      }
      state.sha='written-'+(++state.version);
      return {status:200,data:{content:{sha:state.sha}}};
    }
    if(url===base+'/pages') {state.pages++;return {status:200,data:{source:{branch:'main',path:'/'},html_url:'https://owner.github.io/permission-probe/'}};}
    throw new Error('Unexpected route: '+method+' '+url);
  }};
  return {p,state,wait:async ms=>{state.waits.push(ms);}};
}

test('preflight relê o SHA após HTTP 409 e repete somente o arquivo de prova',async()=>{
  const m=fixture({conflicts:1});
  const result=await publicationPreflight(m.p,m.wait);
  assert.equal(result.owner,'owner');
  assert.equal(m.state.gets,2);
  assert.deepEqual(m.state.puts.map(p=>p.sha),['initial-sha','external-1']);
  assert.equal(m.state.puts[0].content,m.state.puts[1].content);
  assert(m.state.puts.every(p=>p.branch==='main'&&!('force' in p)));
  assert.deepEqual(m.state.waits,[500]);
});

test('dois preflights concorrentes concluem apesar de disputar o mesmo arquivo',async()=>{
  const m=fixture();
  const results=await Promise.all([publicationPreflight(m.p,m.wait),publicationPreflight(m.p,m.wait)]);
  assert(results.every(r=>r.probe==='permission-probe'));
  assert.equal(m.state.races,1);
  assert.equal(m.state.puts.length,3);
});

test('arquivo ausente é criado sem SHA; sem conflito não há repetição',async()=>{
  const m=fixture({missing:true});
  await publicationPreflight(m.p,m.wait);
  assert.equal(m.state.puts.length,1);
  assert.equal('sha' in m.state.puts[0],false);
  assert.equal(m.state.puts[0].branch,'main');
  assert.deepEqual(m.state.waits,[]);
});

test('disputa persistente termina após quatro gravações e não aprova o preflight',async()=>{
  const m=fixture({conflicts:Infinity});
  await assert.rejects(publicationPreflight(m.p,m.wait),e=>e.code==='GITHUB_PROBE_CONFLICT');
  assert.equal(m.state.gets,4);
  assert.equal(m.state.puts.length,4);
  assert.deepEqual(m.state.waits,[500,1000,2000]);
  assert.equal(m.state.pages,0);
});

for(const code of ['HTTP_401','HTTP_403','HTTP_422','HTTP_500','HTTP_TIMEOUT']) {
  test(`erro ${code} não é tratado como conflito nem ocultado`,async()=>{
    const error=new Fault(code,'Failure fixture'),m=fixture({error});
    await assert.rejects(publicationPreflight(m.p,m.wait),e=>e===error);
    assert.equal(m.state.puts.length,1);
    assert.deepEqual(m.state.waits,[]);
    assert.equal(m.state.pages,0);
  });
}

test('repositório sem marcador de prova não recebe nenhuma gravação',async()=>{
  const m=fixture({marker:false});
  await assert.rejects(publicationPreflight(m.p,m.wait),e=>e.code==='GITHUB_PROBE');
  assert.equal(m.state.gets,0);
  assert.equal(m.state.puts.length,0);
});

test('job que falhou no preflight retoma sem criar ou consumir reserva Claude',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'preflight-resume-')),store=new Store(root);
  try {
    const job=store.create({id:'preflight-resume',chat:'123',username:'atelier',profile:'https://www.instagram.com/atelier/'});
    assert(store.claimStage(job.id,'preflight'));
    store.finish(job.id,'preflight','failed',{code:'HTTP_409'});
    const resumed=resumeJob(store,job,job.chat,{maxJobDuration:3600,apifyDeadline:600,qualityThreshold:85});
    assert.equal(resumed.stage,'preflight');
    assert(store.claimStage(job.id,'preflight'));
    const m=fixture({conflicts:1}),result=await publicationPreflight(m.p,m.wait);
    store.finish(job.id,'preflight','done',result);
    assert.equal(store.stage(job.id,'preflight').state,'done');
    assert.equal(store.claude(job.id),undefined);
    assert.equal(store.stage(job.id,'collect'),undefined);
  } finally {store.close();rmSync(root,{recursive:true,force:true});}
});
