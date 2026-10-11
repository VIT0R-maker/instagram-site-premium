import http from 'node:http';
import path from 'node:path';
import { mkdirSync, rmSync, existsSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { Pipeline } from './pipeline.mjs';
import { STAGES, STAGE_TEXT, Fault, must, authEqual, profileUrl, jobIdentity, safeError, readJson } from './core.mjs';

const packageRoot=fileURLToPath(new URL('../',import.meta.url));
export function validateConfig(c) {
  must(c.schemaVersion==='2.0'&&!Object.hasOwn(c,'enableAiDecorativeImages')&&!Object.hasOwn(c,'geminiImageModel'),'CONFIG_MIGRATION','Execute npm run migrate:config -- caminho/config.json para migrar configuração v1 com backup.');
  for(const key of ['maxCandidateImages','expandedCandidateImages','analysisBatchSize','maxFinalists','maxSiteImages','maxJobDuration','maxActiveJobs','downloadConcurrency','geminiMaxCalls','apiAttempts','retentionDays'])must(Number.isInteger(c[key])&&c[key]>0,'CONFIG',`Parâmetro inválido: ${key}`);
  must(c.analysisBatchSize<=20&&c.maxFinalists<=20&&c.maxCandidateImages<=c.expandedCandidateImages&&c.expandedCandidateImages<=160&&c.maxSiteImages<=20&&c.apiAttempts<=4&&Number.isInteger(c.maxAuditRounds)&&c.maxAuditRounds>=0&&c.maxAuditRounds<=8&&c.maxBriefReviewRounds>=0&&c.maxBriefReviewRounds<=4,'CONFIG_LIMIT','Configuração excede limites operacionais.');
  must(c.claudeMaxImages>=c.maxSiteImages&&c.claudeMaxImages<=20&&c.claudeImageBase64Bytes<=8000000&&c.claudeRequestBytes<=24000000&&c.claudeReferenceMaxEdge<=2000&&c.claudeReferenceMinEdge>=512&&c.claudeReferenceMinEdge<=c.claudeReferenceMaxEdge,'CONFIG_VISION','Limites multimodais inválidos.');
  must(Number.isInteger(c.maxNoProgressRounds)&&c.maxNoProgressRounds>=1&&c.maxNoProgressRounds<=8&&c.maxPatchFraction>0&&c.maxPatchFraction<=.35&&c.maxCumulativePatchFraction>0&&c.maxCumulativePatchFraction<=.5,'CONFIG_AUDIT','Limites de reparo inválidos.');
  must(Array.isArray(c.renderViewports)&&[320,390,768,1440].every(w=>c.renderViewports.includes(w))&&c.renderViewports.length<=6&&c.auditImageMaxEdge>=1200&&c.auditImageMaxEdge<=2000&&c.maxDetailShots>=2&&c.maxDetailShots<=16&&c.maxTemporalShots>=2,'CONFIG_RENDER','Viewports/detalhes/movimento obrigatórios ausentes.');
  must(c.geminiPayloadBytes<=16000000&&c.qualityThreshold>=85&&c.qualityThreshold<=100,'CONFIG_QUALITY','Limite de payload/qualidade fora do contrato.');
  must(/^[a-z0-9][a-z0-9-]{0,15}$/.test(c.repoPrefix),'CONFIG_PREFIX','Prefixo do repositório inválido.');
  return c;
}
export function createApp({config,env,store,pipeline,root}) {
  const active=new Map(),allowed=new Set(String(env.ALLOWED_CHAT_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));
  function status(job,stage) {
    const record=stage?store.stage(job.id,stage):null;
    const failure=record?.result?JSON.parse(record.result):null;
    const pub=store.checkpoint(job.id,'publication'),repo=store.checkpoint(job.id,'repository'),cl=store.claude(job.id);
    return {accepted:true,jobId:job.id,chatId:job.chat,username:job.username,stage:stage||null,state:record?.state||'pending',message:record?.state==='failed'?`${failure?.message || 'Falha na etapa.'}${cl&&!cl.response?' A reserva do Claude permanece consumida/ambígua.':''}${repo?' Repositório: '+repo.url:''}`:pub?.status==='published'?`Site publicado e verificado.\n${pub.siteUrl}\nRepositório: ${pub.repoUrl}\nJob: ${job.id}`:STAGE_TEXT[stage]||'Trabalho recebido.',repoUrl:repo?.url||null,siteUrl:pub?.status==='published'?pub.siteUrl:null,claudeState:cl?.state||'unused',code:failure?.code||null};
  }
  const server=http.createServer(async(req,res)=>{
    const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    try {
      if(req.url==='/healthz'&&req.method==='GET'){send(200,{ok:true,version:'2.0.0'});return;}
      must(authEqual(req.headers.authorization||'','Bearer '+env.WORKER_TOKEN),'AUTH','Autenticação do worker inválida.');
      const url=new URL(req.url,'http://worker');let body={};
      if(req.method==='POST'){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;must(size<=24000,'BODY_SIZE','Corpo HTTP excede o limite.');chunks.push(chunk);}try{body=JSON.parse(Buffer.concat(chunks)||'{}');}catch{throw new Fault('BODY_JSON','Corpo JSON inválido.');}}
      if(req.method==='POST'&&url.pathname==='/v1/jobs') {
        const m=body.message,chat=String(m?.chat?.id||'');
        if(!allowed.has(chat)){send(200,{accepted:false,notify:false,message:'Chat não autorizado.'});return;}
        try {
          let job;const resume=/^\/retomar\s+([a-f0-9]{24})$/.exec(String(m?.text||'').trim());
          if(resume) {
            job=store.get(resume[1]);must(job.chat===chat,'JOB_OWNER','Trabalho pertence a outro chat.');
            must(!store.checkpoint(job.id,'purged'),'RETENTION','Artefatos expiraram. O registro da reserva permanece, impedindo nova chamada.');
            must(!active.has(job.id),'BUSY','Trabalho ainda em execução.');
            for(const stage of STAGES)if(['failed','interrupted'].includes(store.stage(job.id,stage)?.state))store.resetStage(job.id,stage);
            store.checkpoint(job.id,'deadline',Date.now()+config.maxJobDuration*1000);
          }else {
            must(Number.isSafeInteger(m?.message_id),'INPUT_EVENT','Mensagem Telegram sem message_id.');
            const profile=profileUrl(m.text),id=jobIdentity(env.TELEGRAM_BOT_ID,chat,m.message_id,env.JOB_HMAC_KEY);
            job=store.create({id,chat,...profile,repo:`${config.repoPrefix}-${profile.username.replaceAll('.','-')}-${id.slice(0,10)}`});
            if(!store.checkpoint(id,'deadline'))store.checkpoint(id,'deadline',Date.now()+config.maxJobDuration*1000);
          }
          send(200,{...status(job),notify:true});return;
        }catch(e){send(200,{accepted:false,notify:true,chatId:chat,...safeError(e)});return;}
      }
      const match=/^\/v1\/jobs\/([a-f0-9]{24})\/stages\/(preflight|collect|curate|brief|generate|audit|publish)$/.exec(url.pathname);
      must(match,'ROUTE','Rota inexistente.');const [,id,stage]=match;const job=store.get(id);
      must(allowed.has(job.chat),'AUTH','Chat do trabalho não está mais autorizado.');
      if(req.method==='GET'){send(200,status(job,stage));return;}
      must(req.method==='POST','METHOD','Método não permitido.');
      const index=STAGES.indexOf(stage);
      must(!index||store.stage(id,STAGES[index-1])?.state==='done','STAGE_ORDER','Etapa anterior ainda não foi concluída.');
      const previous=store.stage(id,stage);
      if(['done','running','failed'].includes(previous?.state)){send(200,status(job,stage));return;}
      must(!store.checkpoint(id,'purged'),'RETENTION','Artefatos privados expirados.');
      must(!active.has(id)&&active.size<config.maxActiveJobs,'CAPACITY','Capacidade ocupada; reenvie o mesmo evento ou use /retomar sem criar outro trabalho.');
      const remaining=(store.checkpoint(id,'deadline')||0)-Date.now();
      must(remaining>0,'JOB_DEADLINE','Prazo do trabalho excedido. Use /retomar para recuperar checkpoints sem repetir Claude.');
      if(store.claimStage(id,stage)) {
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),remaining);active.set(id,controller);
        store.event(id,'stage_start',{stage});
        Promise.resolve().then(()=>pipeline.run(stage,job,controller.signal)).then(result=>{
          store.finish(id,stage,'done',{ok:true});store.event(id,'stage_done',{stage});
        }).catch(e=>{
          const error=controller.signal.aborted?{code:'JOB_DEADLINE',message:'Prazo máximo atingido; reserva do Claude preservada.'}:safeError(e);
          let diagnostic=String(e.stack||e.message||e);
          for(const value of Object.values(env))if(typeof value==='string'&&value.length>=8)diagnostic=diagnostic.split(value).join('[REDACTED]');
          store.checkpoint(id,'lastFailure',{stage,...error,diagnostic:diagnostic.slice(0,6000)});
          store.finish(id,stage,'failed',error);store.event(id,'stage_failed',{stage,...error});
        }).finally(()=>{clearTimeout(timer);active.delete(id);});
      }
      send(200,status(job,stage));
    }catch(e){send(e.code==='AUTH'?401:400,{accepted:false,state:'failed',...safeError(e)});}
  });
  return {server,active,status};
}

async function main() {
  process.umask(0o077);
  const env=process.env,config=validateConfig(readJson(path.join(packageRoot,'config.json')));
  for(const key of ['WORKER_TOKEN','JOB_HMAC_KEY'])must(env[key]?.length>=32,'CONFIG_SECRET',`${key} precisa de pelo menos 32 caracteres aleatórios.`);
  must(/^\d+$/.test(env.TELEGRAM_BOT_ID||'')&&env.ALLOWED_CHAT_IDS,'CONFIG_TELEGRAM','Configure bot ID e chats permitidos.');
  const root=path.resolve(env.DATA_DIR||path.join(packageRoot,'data'));mkdirSync(root,{recursive:true,mode:0o700});
  // OS process guard: one server per DB/volume. Stale PID lock requires explicit operator removal.
  const lock=path.join(root,'worker.lock');const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
  const store=new Store(root);store.recover();
  const pipeline=new Pipeline(config,env,store,root),app=createApp({config,env,store,pipeline,root});
  function cleanup(){const cutoff=Date.now()-config.retentionDays*86400000;
    for(const row of store.db.prepare('SELECT id FROM jobs WHERE created<?').all(cutoff)) {
      if(app.active.has(row.id)||store.checkpoint(row.id,'purged'))continue;
      const target=path.resolve(root,'jobs',row.id);must(target.startsWith(path.resolve(root,'jobs')+path.sep),'CLEANUP_PATH','Caminho de limpeza inválido.');
      rmSync(target,{recursive:true,force:true});store.checkpoint(row.id,'purged',true);
      // Keep idempotency tombstones and Claude reservation forever. Purge raw model data.
      store.db.prepare('DELETE FROM checkpoints WHERE job=? AND key NOT IN (?,?,?)').run(row.id,'purged','publication','repository');
      store.db.prepare("UPDATE claude SET response=NULL,state='expired' WHERE job=?").run(row.id);
    }
  }
  cleanup();const retention=setInterval(cleanup,3600000);
  app.server.listen(Number(env.PORT||8787),env.HOST||'127.0.0.1',()=>process.stdout.write('Worker pronto na porta configurada.\n'));
  async function stop(){clearInterval(retention);for(const c of app.active.values())c.abort();app.server.close();setTimeout(()=>{store.close();rmSync(lock,{force:true});process.exit(0);},1500).unref();}
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{process.stderr.write(JSON.stringify(safeError(e))+'\n');process.exitCode=1;});
