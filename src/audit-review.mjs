import { must,hash } from './core.mjs';
import { interactionsSchema } from './contracts.mjs';
import Ajv from 'ajv';
const validManifest=new Ajv({strict:false}).compile(interactionsSchema);
export function repairManifest(original,repairs=[]) {
  const result=structuredClone(original),ids=new Set();
  for(const r of repairs){const item=result.find(i=>i.id===r.id),old=original.find(i=>i.id===r.id);must(item&&hash(old)===r.expectedHash&&!ids.has(r.id)&&r.reason.trim().length>=30,'MANIFEST_REPAIR','Manifesto exige versão, ID existente e justificativa concreta.');ids.add(r.id);
    must(r.paths.length===old.paths.length&&new Set(r.paths.map(p=>p.input)).size===3,'MANIFEST_OBLIGATION','Correção não pode remover modalidade.');
    for(const p of r.paths){const before=old.paths.find(x=>x.input===p.input);must(before&&p.steps.length>=before.steps.length,'MANIFEST_OBLIGATION','Não apague passos funcionais para passar o teste.');
      for(const step of before.steps)must(p.steps.some(s=>s.action===step.action&&s.value===step.value&&s.expect.condition===step.expect.condition&&s.expect.name===step.expect.name&&s.expect.value===step.expect.value),'MANIFEST_OBLIGATION','Só seletores podem mudar; estado funcional e tecla exigidos devem permanecer.');
    }
    item.paths=r.paths;
  }
  must(validManifest(result),'MANIFEST_SCHEMA','Manifesto corrigido viola contrato.');return result;
}
export async function reviewRendered(p,payload,shots,config) {
  const cap=config.auditBatchImages||12,budget=config.geminiPayloadBytes-Buffer.byteLength(JSON.stringify(payload))-50000;
  must(budget>100000,'AUDIT_CONTEXT','Código/contexto grande demais para auditoria configurada.');
  const batches=[];let chunk=[],size=0;
  for(const [i,shot] of shots.entries()){const cost=4*Math.ceil(shot.bytes.length/3)+1000;must(cost<budget,'AUDIT_IMAGE_SIZE','Captura individual excede o orçamento; não será omitida.');if(chunk.length&&(chunk.length>=cap||size+cost>budget)){batches.push(chunk);chunk=[];size=0;}chunk.push({...shot,coverageId:'capture-'+i});size+=cost;}if(chunk.length)batches.push(chunk);
  if(batches.length<=1)return p.gemini('audit',payload,shots,'audit',true);
  must(batches.length<=(config.auditMaxBatchCalls||32),'AUDIT_COVERAGE_BUDGET','Cobertura precisa de mais chamadas que o orçamento; publicação bloqueada, nenhuma faixa omitida.');
  const partials=[];
  for(const [index,batch] of batches.entries()){
    const ids=batch.map(i=>i.coverageId),part=await p.gemini('auditPart',{brief:payload.brief,tests:payload.tests,diagnostics:payload.diagnostics,part:index+1,totalParts:batches.length,captures:batch.map(({bytes,...s})=>s)},batch,'auditPart',true);
    must(part.coverageIds.length===ids.length&&ids.every(id=>part.coverageIds.includes(id)),'AUDIT_COVERAGE','Auditor não confirmou todas as capturas deste lote.');partials.push(part);
  }
  const result=await p.gemini('audit',{...payload,visualParts:partials,coverage:{totalCaptures:shots.length,parts:batches.length,allReviewed:true}},[],'audit',true);
  // Consolidation may not average away a blocking finding in a late section.
  const blockers=partials.flatMap(p=>p.issues).filter(i=>['high','critical'].includes(i.severity));
  result.issues=[...result.issues,...blockers.filter(i=>!result.issues.some(x=>hash(x)===hash(i)))];
  for(const key of Object.keys(result.rubric))result.rubric[key]=Math.min(result.rubric[key],...partials.map(p=>p.rubric[key]));
  result.coverage={totalCaptures:shots.length,parts:batches.length,allReviewed:true};result.visualParts=partials;return result;
}
