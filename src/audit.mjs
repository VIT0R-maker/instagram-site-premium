import { readFileSync } from 'node:fs';
import path from 'node:path';
import { diagnoseSite, applyPatches, fileHashes } from './validate-site.mjs';
import { finalizeSeo } from './seo.mjs';
import { renderIsolated } from './render.mjs';
import { reviewRendered,repairManifest } from './audit-review.mjs';
import { auditReferences } from './vision.mjs';
import { atomic, must, hash, Fault } from './core.mjs';

const authorFiles=files=>Object.fromEntries(Object.entries(files).filter(([f])=>/\.(html|css|js|svg)$/.test(f)&&!/^lib\//.test(f)).map(([f,b])=>[f,b.toString()]));
const technicalKeys=(diagnostic,render)=>[...diagnostic.issues.map(i=>`${i.code}:${i.file}:${i.component}`),...(render?.tests||[]).flatMap(t=>(t.errors||[]).map(e=>`${t.width}:${t.motion}:${t.page}:${e}`))];
export function progressEvidence(previous,current) {
  if(!previous)return {progress:true,regressions:[]};
  const removed=previous.technical.filter(k=>!current.technical.includes(k));
  const regressions=current.technical.filter(k=>!previous.technical.includes(k));
  return {progress:removed.length>0||current.observedImprovements.length>0,removed,regressions,scoreDelta:current.score-previous.score};
}
export async function auditProject({files,brief,interactions,config,p,dir,job,signal,cp,save,render=renderIsolated}) {
  const terminal=cp('auditTerminal');if(terminal)throw new Fault(terminal.code,terminal.message);
  const gate=(ok,code,message)=>{if(!ok){cp('auditTerminal',{code,message});throw new Fault(code,message);}};
  const snapshot=(round,value)=>{
    const hashes=fileHashes(value);for(const [f,b] of Object.entries(value))atomic(path.join(dir,'audit-versions',String(round),f),b);
    return {round,hashes,files:Object.keys(hashes)};
  };
  const restore=v=>Object.fromEntries(v.files.map(f=>{const b=readFileSync(path.join(dir,'audit-versions',String(v.round),f));must(hash(b)===v.hashes[f],'AUDIT_SNAPSHOT','Versão de auditoria alterada.');return [f,b];}));
  let state=cp('auditState');
  if(!state) {
    // Baseline contains the sole Claude output plus deterministic metadata, with no Gemini patch.
    files=finalizeSeo(files,brief,brief.publication.url);
    state={interactions,version:snapshot(0,files),round:0,noProgress:0,cumulative:{},removed:{},seen:[],previous:null};
    cp('auditBaseline',state.version);cp('auditState',state);
  }else files=restore(state.version);
  interactions=state.interactions||interactions;
  const baseline=restore(cp('auditBaseline'));
  for(let round=state.round;round<=config.maxAuditRounds;round++) {
    files=finalizeSeo(files,brief,brief.publication.url);
    must(Object.values(files).reduce((n,b)=>n+b.length,0)<=config.maxPublicBytes,'SITE_BUDGET','Pacote excedeu o teto público.');
    const deterministic=diagnoseSite(files,brief,Object.values(p.env||{}),interactions);
    // Never pass leaked secrets or truncated output to another model as a repair request.
    save(`diagnostic-${round}`,deterministic);
    gate(!deterministic.fatal,'SITE_FATAL','Site contém falha irrecuperável (segredo, origem ou estrutura incompleta). Veja diagnóstico privado; não haverá outra geração.');
    let rendered={passed:false,tests:[],screenshots:[],engine:null,skipped:'repair-first: corrigir antes de executar'};
    if(deterministic.safeToRender)rendered=await render(files,config,job.repo,signal,{interactions,assets:brief.assets});
    for(const [i,s] of rendered.screenshots.entries())atomic(path.join(dir,'screenshots',`${round}-${i}.jpg`),Buffer.from(s.data,'base64'));
    const baselineShots=round>0?(cp('audit-0')?.render.screenshots||[]).map((s,i)=>({...s,i})).filter(s=>s.kind==='fold').slice(0,8).map(s=>({...s,label:'BASELINE SEM PATCH — '+s.label,data:readFileSync(path.join(dir,'screenshots',`0-${s.i}.jpg`)).toString('base64')})):[];
    const shots=await auditReferences([...rendered.screenshots,...baselineShots],config);
    const audit=await reviewRendered(p,{brief,mode:deterministic.safeToRender?'rendered':'repair-first',diagnostics:deterministic,tests:rendered.tests,interactions,fileHashes:deterministic.fileHashes,files:authorFiles(files),previous:state.previous,baseline:cp('audit-0')||null,patchBudget:{maxFractionPerFile:config.maxPatchFraction,maxCumulativeFraction:config.maxCumulativePatchFraction,extendedFraction:config.maxExtendedPatchFraction,extendedCumulativeFraction:config.maxExtendedCumulativePatchFraction,requiresExtendedJustification:true,cumulative:state.cumulative,remainingRounds:config.maxAuditRounds-round},interactionHashes:Object.fromEntries(interactions.map(i=>[i.id,hash(i)]))},shots,config);
    const score=Object.values(audit.rubric).reduce((a,b)=>a+b,0)/6;
    const current={score,technical:technicalKeys(deterministic,rendered),issues:audit.issues,observedImprovements:audit.observedImprovements};
    const progress=progressEvidence(state.previous,current);
    const passed=deterministic.passed&&rendered.passed&&audit.semanticReview.approved&&!audit.semanticReview.unsupportedClaims.length&&score>=config.qualityThreshold&&!audit.issues.some(i=>['high','critical'].includes(i.severity));
    const report={audit,score,passed,progress,deterministic,render:{...rendered,screenshots:rendered.screenshots.map(({data,...s})=>s)}};
    save(`audit-${round}`,report);
    if(passed) {
      save('approvedInteractions',interactions);
      for(const [f,b]of Object.entries(files))atomic(path.join(dir,'site',f),b);
      const hashes=fileHashes(files);
      save('comparison',{sameJob:true,claudeGenerations:1,baseline:cp('auditBaseline'),final:{round,hashes},viewports:config.renderViewports,observedImprovements:audit.observedImprovements,baselineReport:'audit-0.json',finalReport:`audit-${round}.json`,limitations:['Notas e inspeção semântica são avaliações de modelo; métricas do navegador não garantem qualidade subjetiva.']});
      return save('approval',{approved:true,schemaVersion:'2.0',score,filesHash:hash(hashes),files:Object.keys(hashes),round,renderer:rendered.engine,interactionsHash:hash(interactions),reviewedAt:new Date().toISOString()});
    }
    state.noProgress=state.previous&&!progress.progress?state.noProgress+1:0;
    gate(state.noProgress<config.maxNoProgressRounds,'AUDIT_NO_PROGRESS','Rodadas sem melhoria observável; publicação bloqueada, versões preservadas.');
    gate(round<config.maxAuditRounds&&(audit.patches.length||audit.manifestRepairs?.length),'AUDIT_REJECTED','Site reprovado ou precisa de reconstrução. Não haverá outra geração.');
    const extended=typeof audit.scopeJustification==='string'&&audit.scopeJustification.trim().length>=80&&audit.issues.some(i=>['medium','high','critical'].includes(i.severity));
    const patchConfig=extended?{...config,maxPatchFraction:config.maxExtendedPatchFraction||.75,maxRemovedFraction:config.maxExtendedPatchFraction||.75}:config;
    if(extended)save(`scope-extension-${round}`,{justification:audit.scopeJustification,issues:audit.issues,limits:patchConfig.maxPatchFraction});
    let next;try{next=applyPatches(files,audit.patches,patchConfig);interactions=repairManifest(interactions,audit.manifestRepairs);}catch(e){gate(false,e.code||'PATCH_INVALID',e.message);}
    const cumulative={...state.cumulative},removed={...state.removed},cumulativeLimit=extended?(config.maxExtendedCumulativePatchFraction||.9):config.maxCumulativePatchFraction;
    for(const patch of audit.patches){cumulative[patch.file]=(cumulative[patch.file]||0)+Math.max(Buffer.byteLength(patch.find),Buffer.byteLength(patch.replace));removed[patch.file]=(removed[patch.file]||0)+Buffer.byteLength(patch.find);gate(cumulative[patch.file]<=Math.max(600,baseline[patch.file].length*cumulativeLimit)&&removed[patch.file]<=baseline[patch.file].length*cumulativeLimit,'PATCH_CUMULATIVE','Patches acumulados excedem correção localizada.');}
    const versionHash=hash({files:fileHashes(next),interactions});gate(!state.seen.includes(versionHash),'AUDIT_CYCLE','Auditoria retornou a uma versão já avaliada.');
    // No rollback driven by subjective score. New objective failures remain visible to the next review.
    state={...state,interactions,round:round+1,cumulative,removed,previous:current,seen:[...state.seen,hash({files:fileHashes(files),interactions:state.interactions})],version:snapshot(round+1,next)};
    cp('auditState',state);files=next;
  }
  gate(false,'AUDIT_BUDGET','Orçamento de auditoria esgotado; /retomar não reinicia as rodadas.');
}
