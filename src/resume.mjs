import { savedVisualCandidates } from './audit-policy.mjs';
import { must,STAGES } from './core.mjs';
export function resumeJob(store,job,chat,config,active=false) {
  must(job.chat===chat,'JOB_OWNER','Trabalho pertence a outro chat.');
  must(!store.checkpoint(job.id,'purged'),'RETENTION','Artefatos expiraram; reserva Claude permanece consumida.');
  must(!active,'BUSY','Trabalho ainda em execução.');
  const stage=STAGES.find(s=>store.stage(job.id,s)?.state!=='done');
  if(!stage)return {stage:null,complete:true};
  const record=store.stage(job.id,stage);
  must(record?.state!=='running','BUSY','Etapa marcada em execução; verifique o único worker antes da retomada.');
  if(stage==='audit'){const terminal=store.checkpoint(job.id,'auditTerminal');must(!terminal||savedVisualCandidates(k=>store.checkpoint(job.id,k),config).length>0,'AUDIT_TERMINAL',terminal?.message||'Auditoria esgotada.');}
  if(stage==='generate'&&store.claude(job.id))must(store.claude(job.id).response,'CLAUDE_AMBIGUOUS','Claude já reservado sem resposta recuperável. Retomar não permite outra geração.');
  if(['failed','interrupted'].includes(record?.state))store.resetStage(job.id,stage);
  const deadline=Date.now()+config.maxJobDuration*1000;store.checkpoint(job.id,'deadline',deadline);
  if(['collect','curate'].includes(stage))for(const r of store.db.prepare("SELECT key,value FROM checkpoints WHERE job=? AND key LIKE 'apify:%'").all(job.id)){
    const v=JSON.parse(r.value);if(v?.id&&v?.deadline)store.checkpoint(job.id,r.key,{...v,deadline:Date.now()+config.apifyDeadline*1000});
  }
  store.event(job.id,'resume',{stage,deadline,claudeState:store.claude(job.id)?.state||'unused'});return {stage,complete:false};
}

