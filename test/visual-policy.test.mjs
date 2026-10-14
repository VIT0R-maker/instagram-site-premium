import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {atomic,STAGES} from '../src/core.mjs';
import {auditProject} from '../src/audit.mjs';
import {visualScore,telegramChunks} from '../src/audit-policy.mjs';
import {diagnoseSite,fileHashes} from '../src/validate-site.mjs';
import {resumeJob} from '../src/resume.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {installAuditNotifications} from '../scripts/visual-notification-workflow.mjs';
import {siteFixture} from './fixtures.mjs';
import {visualFixture} from './visual-fixture.mjs';
const config=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
const answer=n=>({rubric:Object.fromEntries(['identity','composition','spacing','typography','images','responsiveness'].map(k=>[k,n])),issues:[{severity:'high',component:'controle',description:'Observação <teste>_x',evidence:'e',fix:'f'}],semanticReview:{approved:false,unsupportedClaims:[{text:'observação'}]},patches:[],observedImprovements:[]});
function setup(){
  const root=mkdtempSync(path.join(os.tmpdir(),'visual-policy-')),store=new Store(root),job={id:'policy-test',chat:'1',repo:'fixture'};
  const dir=path.join(root,'jobs',job.id),cp=(k,v)=>v===undefined?store.checkpoint(job.id,k):store.checkpoint(job.id,k,v),save=(k,v)=>{cp(k,v);atomic(path.join(dir,k+'.json'),v);return v;};
  const x=siteFixture();
  // Deliberately leave an unregistered control; this is advice, not a veto.
  x.files['index.html']=Buffer.from(x.files['index.html'].toString().replace('data-interaction="menu"','data-interaction="unregistered"'));
  return {root,store,job,dir,cp,save,x};
}
test('85 aprova apesar de diagnóstico, navegador, semântica e severity; 84.99 não aprova',async()=>{
  for(const n of [85,84.99]){
    const h=setup();try{
      const args={...h,files:h.x.files,brief:h.x.brief,interactions:h.x.interactions,config:{...config,maxAuditRounds:0},p:{env:{},gemini:async()=>answer(n)},render:async()=>({passed:false,tests:[{width:390,errors:['teste pendente']}],screenshots:[]})};
      if(n===85){assert((await auditProject(args)).approved);assert(h.cp('auditNotes').includes('INTERACTION_TEST'));assert(h.cp('auditNotes').includes('teste pendente'));}
      else {await assert.rejects(auditProject(args),e=>e.code==='AUDIT_REJECTED');assert(!h.cp('approval'));}
    }finally{h.store.close();}
  }
});
test('retomada recupera melhor snapshot legado mesmo com terminal; zero Gemini e zero renderer',async()=>{
  const h=setup();try{
    for(const stage of STAGES.slice(0,5)){h.store.claimStage(h.job.id,stage);h.store.finish(h.job.id,stage,'done',{});}
    h.store.claimStage(h.job.id,'audit');h.store.finish(h.job.id,'audit','failed',{});
    h.cp('auditTerminal',{code:'AUDIT_NO_PROGRESS',message:'old policy'});
    for(const [round,n] of [[1,86.5],[2,91.67]]){
      const files={...h.x.files,'styles.css':Buffer.concat([h.x.files['styles.css'],Buffer.from(`\n/* round ${round} */`)])};
      for(const [f,b] of Object.entries(files))atomic(path.join(h.dir,'audit-versions',String(round),f),b);
      h.cp(`audit-${round}`,{audit:answer(n),passed:false,score:n,deterministic:diagnoseSite(files,h.x.brief,[],h.x.interactions),render:{passed:true,tests:[]}});
    }
    assert.equal(resumeJob(h.store,h.job,'1',config).stage,'audit');
    const result=await auditProject({...h,files:h.x.files,brief:h.x.brief,interactions:h.x.interactions,config,p:{env:{},gemini:()=>assert.fail('paid call')},render:()=>assert.fail('render')});
    assert(result.approved);assert(result.reusedReview);assert.equal(result.round,2);assert.equal(h.cp('auditTerminal'),null);
    assert(readFileSync(path.join(h.dir,'site/styles.css'),'utf8').includes('round 2'));
    assert(!h.store.claude(h.job.id));
    // The publishing stage must not reapply the old all-diagnostics-must-pass gate.
    h.cp('brief',h.x.brief);h.cp('generation',{interactions:h.x.interactions});h.cp('preflight',{owner:'fixture'});
    const provider={store:h.store,job:h.job,config,github:async()=>{throw Error('publisher reached');}};
    const pipeline=new Pipeline(config,{},h.store,h.root,{createProviders:()=>provider});
    await assert.rejects(pipeline.run('publish',h.job),e=>e.message==='publisher reached');
  }finally{h.store.close();}
});
test('nota antiga não aprova bytes alterados',async()=>{
  const h=setup();try{
    h.cp('audit-2',{audit:answer(92),deterministic:{fileHashes:fileHashes(h.x.files)}});
    for(const [f,b] of Object.entries(h.x.files))atomic(path.join(h.dir,'audit-versions','2',f),b);
    atomic(path.join(h.dir,'audit-versions/2/styles.css'),'modified');
    await assert.rejects(auditProject({...h,files:h.x.files,brief:h.x.brief,interactions:h.x.interactions,config,p:{env:{},gemini:()=>assert.fail('model')}}),e=>e.code==='AUDIT_SNAPSHOT');
    assert(!h.cp('approval'));
  }finally{h.store.close();}
});
test('alt de img com data-asset-id é reconhecido',()=>{
  const x=visualFixture();
  const html=x.files['index.html'].toString();
  const asset=x.brief.assets[0];
  const files={...x.files,'index.html':Buffer.from(html.replace('</main>',`<img data-asset-id="${asset.assetId}" src="${asset.variants[0].path}" alt="Descrição da foto"></main>`))};
  assert(!diagnoseSite(files,x.brief,[],x.interactions).issues.some(i=>i.code==='BACKGROUND_ALT'));
});
test('nota exige seis números finitos; relatório extenso preserva caracteres e todas as partes',()=>{
  assert.equal(visualScore(answer(85)),85);assert.equal(visualScore({rubric:{identity:100}}),null);
  const text='Detalhe <a>&_🙂\n'.repeat(1500),parts=telegramChunks(text);
  assert(parts.length>1);assert(parts.every(p=>p.length<4096));assert(telegramChunks('🙂'.repeat(5000)).every(p=>p.length<4096));
  assert.equal(parts.map(p=>p.slice(p.indexOf('\n')+1)).join(''),text);
});
test('workflow envia relatório em partes com intervalo e HTML escapado, preservando o chat',()=>{
  const workflow=JSON.parse(readFileSync(new URL('../workflow_instagram_site_premium.json',import.meta.url)));
  const before=JSON.stringify(workflow);installAuditNotifications(workflow);assert.equal(JSON.stringify(workflow),before);
  for(const kind of ['resultado','diagnóstico']){
    const node=workflow.nodes.find(n=>n.name===`Preparar ${kind} e relatório`);
    const fn=new Function('$input',node.parameters.jsCode);
    const items=fn({first:()=>({json:{chatId:'123',jobId:'job',stage:'audit',message:'Concluído',auditMessages:['Notas & <t>_🙂']}})});
    assert.equal(items.length,2);assert(items.every(i=>i.json.chatId==='123'));
    assert.equal(items[1].json.message,'Notas & <t>_🙂');
    const target=kind==='resultado'?'Telegram — resultado verificado':'Telegram — diagnóstico';
    const send=workflow.nodes.find(n=>n.name===target);
    const expression=send.parameters.text.slice(3,-2);
    const escaped=new Function('$json','return '+expression)(items[1].json);
    assert.equal(escaped,'Notas &amp; &lt;t&gt;_🙂');
    assert.equal(send.parameters.additionalFields.parse_mode,'HTML');
    assert.equal(workflow.connections[`Partes do ${kind}`].main[1][0].node,`Intervalo do ${kind}`);
  }
});
