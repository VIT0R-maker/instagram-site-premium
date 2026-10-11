import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { atomic, STAGES } from '../src/core.mjs';
const workflow=JSON.parse(readFileSync(new URL('../../workflow_instagram_site_premium.json',import.meta.url)));
const posts=[],polls=new Map();
const server=http.createServer(async(req,res)=>{
  for await(const _ of req){}
  let result={accepted:true,notify:true,jobId:'123456789012345678901234',chatId:'123',message:'mock'};
  if(req.url==='/v1/jobs')result.state='pending';
  else {const stage=req.url.split('/').pop();if(!STAGES.includes(stage)){res.writeHead(404).end();return;}
    result.stage=stage;
    if(req.method==='POST'){posts.push(stage);result.state='running';}
    else{const n=(polls.get(stage)||0)+1;polls.set(stage,n);result.state=n===1?'running':'done';}
    if(stage==='publish'&&result.state==='done')result.message='MOCK_FINAL_VERIFIED';
  }
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});
await new Promise(r=>server.listen(0,'0.0.0.0',r));
for(const n of workflow.nodes) {
  delete n.credentials;
  if(n.type==='n8n-nodes-base.telegramTrigger'){n.type='n8n-nodes-base.manualTrigger';n.typeVersion=1;n.parameters={};}
  if(n.type==='n8n-nodes-base.telegram'){n.type='n8n-nodes-base.code';n.typeVersion=2;n.parameters={jsCode:'return $input.all();'};}
  if(n.name==='Contexto — um evento por execução')n.parameters.jsCode=n.parameters.jsCode.replace("const event = $input.item.json;","const event = {message:{chat:{id:123},message_id:1,text:'https://www.instagram.com/teste/'}};").replace('http://host.docker.internal:8787',`http://host.docker.internal:${server.address().port}`);
  if(n.type==='n8n-nodes-base.httpRequest'){delete n.parameters.authentication;delete n.parameters.genericAuthType;}
  if(n.type==='n8n-nodes-base.wait')n.parameters.amount=0.1;
}
try {
  const code=await new Promise((resolve,reject)=>{
    const child=spawn('docker',['run','--rm','-i','--entrypoint','/bin/sh','-e','N8N_DIAGNOSTICS_ENABLED=false','-e','N8N_VERSION_NOTIFICATIONS_ENABLED=false','-e','N8N_LOG_LEVEL=error','n8nio/n8n:2.41.6','-c','cat > /tmp/workflow.json && n8n import:workflow --input=/tmp/workflow.json && n8n execute --id=IGPremiumSingleClaudeV1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const output=[];const timer=setTimeout(()=>child.kill(),120000);
    child.stdout.on('data',b=>output.push(b));child.stderr.on('data',b=>output.push(b));child.on('error',reject);
    child.on('close',code=>{clearTimeout(timer);atomic('test-output/n8n-execution.log',Buffer.concat(output));resolve(code);});
    child.stdin.end(JSON.stringify(workflow));
  });
  const report={n8n:'2.41.6',exitCode:code,stagesPosted:posts,polls:Object.fromEntries(polls),realProviders:false,passed:code===0&&JSON.stringify(posts)===JSON.stringify(STAGES)&&[...polls.values()].every(n=>n===2)};
  atomic('test-output/n8n-report.json',report);console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}finally{await new Promise(r=>server.close(r));}
