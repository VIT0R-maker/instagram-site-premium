import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { visualFixture, fixtureRepairs } from '../test/visual-fixture.mjs';
import { auditProject } from '../src/audit.mjs';
import { Store, invokeClaudeOnce } from '../src/store.mjs';
import { atomic, hash } from '../src/core.mjs';
import { renderIsolated } from '../src/render.mjs';
const local=process.argv.includes('--local-fixture');
const config=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
const fixture=visualFixture(),job={id:'comparison-fixture-2026',repo:'site-fixture-subpath'};
const dir=path.resolve('test-output/comparison-'+Date.now()),store=new Store(dir);
const cp=(k,v)=>v===undefined?store.checkpoint(job.id,k):store.checkpoint(job.id,k,v);
const save=(k,v)=>{cp(k,v);atomic(path.join(dir,k+'.json'),v);return v;};
let mockGenerations=0;
await invokeClaudeOnce(store,job.id,async()=>{mockGenerations++;return {text:JSON.stringify({fixture:true,filesHash:hash(fixture.files)}),status:200,requestId:'mock-claude-fixture'};});
// Only these repository-owned fixtures can use the native test harness. Production
// renderIsolated always requires Docker and never falls back to host execution.
const render=local?async(files,cfg,repo,_signal,details)=>new Promise((resolve,reject)=>{
  const env=Object.fromEntries(['PATH','SystemRoot','TEMP','TMP','LOCALAPPDATA','USERPROFILE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  const p=spawn(process.execPath,['renderer/run.mjs'],{windowsHide:true,env,stdio:['pipe','pipe','pipe']});const chunks=[],errs=[];
  const timeout=setTimeout(()=>p.kill(),cfg.rendererTimeoutMs);p.stdout.on('data',c=>chunks.push(c));p.stderr.on('data',c=>errs.push(c));p.on('error',reject);
  p.on('close',code=>{clearTimeout(timeout);if(code)reject(Error(Buffer.concat(errs).toString()));else try{resolve(JSON.parse(Buffer.concat(chunks)));}catch(e){reject(e);}});
  p.stdin.end(JSON.stringify({files:Object.fromEntries(Object.entries(files).map(([f,b])=>[f,b.toString('base64')])),basePath:`/${repo}/`,maxHeight:cfg.maxScreenshotHeight,viewports:cfg.renderViewports,auditTileHeight:cfg.auditTileHeight,fontReadyTimeoutMs:cfg.fontReadyTimeoutMs,maxTemporalShots:cfg.maxTemporalShots,...details}));
}):renderIsolated;
let reviews=0;
const p={env:{},gemini:async(task,payload)=>{
  if(task==='auditPart')return {coverageIds:payload.captures.map(s=>s.coverageId),score:91,rubric:Object.fromEntries(['identity','composition','spacing','typography','images','responsiveness'].map(k=>[k,91])),issues:[],observations:['Inspeção simulada: conferir capturas reais separadamente.']};
  if(task!=='audit')throw Error('Somente mock de auditoria é permitido');
  const patched=reviews++>0;
  return {score:patched?91:80,rubric:Object.fromEntries(['identity','composition','spacing','typography','images','responsiveness'].map(k=>[k,patched?91:80])),semanticReview:{approved:true,unsupportedClaims:[],equivalentCopy:[]},observedImprovements:patched?['Patches de fixture aplicados. Confirmação visual humana/modelo ainda deve ler as capturas; nota é mock.']:[],issues:patched?[]:[{severity:'high',viewport:'320/390',component:'hero/CTA',evidence:'Fixture inclui título excessivo e CTA de 32px.',description:'Defeitos locais inseridos no cenário.',fix:'Aplicar os três patches definidos.'}],patches:patched?[]:fixtureRepairs.map(x=>({...x,expectedHash:payload.fileHashes[x.file]}))};
}};
try {
  const approval=await auditProject({files:fixture.files,brief:fixture.brief,interactions:fixture.interactions,config,p,dir,job,cp,save,render});
  const summary={passed:true,dir,nativeFixtureHarness:local,productionIsolationTested:!local,mockClaudeGenerations:mockGenerations,realModelRequests:0,geminiReviews:'mock',approval,baseline:cp('audit-0').render,final:cp(`audit-${approval.round}`).render};
  atomic('test-output/comparison-latest.json',summary);console.log(JSON.stringify({passed:true,dir,round:approval.round,realModelRequests:0,nativeFixtureHarness:local}));
}catch(e){atomic('test-output/comparison-latest.json',{passed:false,dir,nativeFixtureHarness:local,error:e.message,detail:e.detail||null});console.error(e);process.exitCode=1;}finally{store.close();}
