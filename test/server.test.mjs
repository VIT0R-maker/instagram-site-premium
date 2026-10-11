import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,mkdirSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';
import { STAGES } from '../src/core.mjs';
const config=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
test('HTTP: autorização, duplicação, ordem, progresso, falha e retomada conservam contexto',async()=>{
  mkdirSync('test-output',{recursive:true});const root=mkdtempSync(path.resolve('test-output/server-')),store=new Store(root),env={WORKER_TOKEN:'worker-test-token',JOB_HMAC_KEY:'job-test-key',TELEGRAM_BOT_ID:'1',ALLOWED_CHAT_IDS:'123'};
  const calls=[];let rejectAudit=true;
  const pipeline={run:async(stage,job)=>{calls.push(stage);await new Promise(r=>setTimeout(r,10));if(stage==='audit'&&rejectAudit)throw Error('audit unavailable');return {};}};
  const {server}=createApp({config,env,store,pipeline,root});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.WORKER_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return r.json();};
  try {
    assert.equal((await call('/v1/jobs',{message:{chat:{id:888},message_id:1,text:'https://instagram.com/test'}})).notify,false);
    const event={message:{chat:{id:123},message_id:1,text:'https://instagram.com/ceramica/'}};
    const a=await call('/v1/jobs',event),b=await call('/v1/jobs',event);assert.equal(a.jobId,b.jobId);
    assert.equal((await call(`/v1/jobs/${a.jobId}/stages/generate`,{})).code,'STAGE_ORDER');
    for(const stage of STAGES.slice(0,6)) {
      const route=`/v1/jobs/${a.jobId}/stages/${stage}`;
      await Promise.all([call(route,{}),call(route,{})]);
      await new Promise(r=>setTimeout(r,25));const status=await call(route);assert.equal(status.chatId,'123');assert.equal(status.stage,stage);
      assert.equal(status.state,stage==='audit'?'failed':'done');
    }
    assert.equal(calls.filter(x=>x==='generate').length,1);
    assert.equal((await call(`/v1/jobs/${a.jobId}/stages/publish`,{})).code,'STAGE_ORDER');
    rejectAudit=false;const resume=await call('/v1/jobs',{message:{chat:{id:123},message_id:2,text:'/retomar '+a.jobId}});assert.equal(resume.jobId,a.jobId);
    await call(`/v1/jobs/${a.jobId}/stages/generate`,{});assert.equal(calls.filter(x=>x==='generate').length,1);
    await call(`/v1/jobs/${a.jobId}/stages/audit`,{});await new Promise(r=>setTimeout(r,25));assert.equal((await call(`/v1/jobs/${a.jobId}/stages/audit`)).state,'done');
  }finally{await new Promise(r=>server.close(r));store.close();}
});
