import { readFileSync } from 'node:fs';
import path from 'node:path';
import { diagnoseSite, applyPatches, fileHashes, safePublicPath } from './validate-site.mjs';
import { finalizeSeo } from './seo.mjs';
import { renderIsolated } from './render.mjs';
import { reviewRendered,repairManifest } from './audit-review.mjs';
import { auditReferences } from './vision.mjs';
import { atomic, must, hash, Fault } from './core.mjs';

import { AUDIT_POLICY, visualScore, savedVisualCandidates, auditNotes, unsafePublication } from './audit-policy.mjs';

const authorFiles=files=>Object.fromEntries(Object.entries(files).filter(([f])=>/\.(html|css|js|svg)$/.test(f)&&!/^lib\//.test(f)).map(([f,b])=>[f,b.toString()]));
const technicalKeys=(diagnostic,render)=>[...diagnostic.issues.map(i=>`${i.code}:${i.file}:${i.component}`),...(render?.tests||[]).flatMap(t=>(t.errors||[]).map(e=>`${t.width}:${t.motion}:${t.page}:${e}`))];
export function progressEvidence(previous,current) {
  if(!previous)return {progress:true,regressions:[]};
  const removed=previous.technical.filter(k=>!current.technical.includes(k));
  const regressions=current.technical.filter(k=>!previous.technical.includes(k));
  return {progress:removed.length>0||current.observedImprovements.length>0,removed,regressions,scoreDelta:current.score-previous.score};
}
export async function auditProject({files,brief,interactions,config,p,dir,job,signal,cp,save,render=renderIsolated}) {
  const terminal=cp('auditTerminal');
  const gate=(ok,code,message)=>{if(!ok){cp('auditTerminal',{code,message});throw new Fault(code,message);}};
  const snapshot=(round,value)=>{
    const hashes=fileHashes(value);for(const [f,b] of Object.entries(value))atomic(path.join(dir,'audit-versions',String(round),f),b);
    return {round,hashes,files:Object.keys(hashes)};
  };
  const restore=v=>Object.fromEntries(v.files.map(f=>{const b=readFileSync(path.join(dir,'audit-versions',String(v.round),f));must(hash(b)===v.hashes[f],'AUDIT_SNAPSHOT','Versão de auditoria alterada.');return [f,b];}));
  const approve=(report,round,value,manifest,reused=false)=>{
    const diagnostic=diagnoseSite(value,brief,Object.values(p.env||{}),manifest);
    // File integrity and credential isolation are execution safeguards, not quality scores.
    must(!unsafePublication(diagnostic),'SITE_FATAL','Artefato contém dados privados ou caminho público inválido.');
    const score=visualScore(report.audit),hashes=fileHashes(value);
    must(score!==null&&score>=config.qualityThreshold,'VISUAL_SCORE','Nota visual abaixo do mínimo.');
    save('auditNotes',auditNotes({...report,deterministic:diagnostic},round,config.qualityThreshold,brief.limitations));
    save('approvedInteractions',manifest);
    for(const [f,b] of Object.entries(value))atomic(path.join(dir,'site',f),b);
    save('comparison',{sameJob:true,claudeGenerations:1,policy:AUDIT_POLICY,reusedReview:reused,baseline:cp('auditBaseline'),final:{round,hashes},viewports:config.renderViewports,observedImprovements:report.audit.observedImprovements,baselineReport:'audit-0.json',finalReport:`audit-${round}.json`,limitations:['Aprovação por nota visual; demais observações constam no relatório Telegram.']});
    if(terminal){cp('auditTerminalPrevious',terminal);cp('auditTerminal',null);}
    return save('approval',{approved:true,schemaVersion:'2.0',policy:AUDIT_POLICY,score,filesHash:hash(hashes),files:Object.keys(hashes),round,renderer:report.render?.engine,interactionsHash:hash(manifest),reusedReview:reused,reviewedAt:new Date().toISOString()});
  };
  // Recover the best already-reviewed version before any new render/model call.
  // Every byte must match the hashes in that round's report, not a later patch.
  for(const candidate of savedVisualCandidates(cp,config)) {
    const {report,round}=candidate,hashes=report.deterministic.fileHashes;
    must(Object.keys(hashes).length>0&&Object.keys(hashes).every(safePublicPath),'AUDIT_SNAPSHOT','Manifesto da versão salva inválido.');
    let value;
    try{value=restore({round,hashes,files:Object.keys(hashes)});}catch(e){
      if(e.code==='ENOENT')continue;
      throw e;
    }
    let manifest=report.interactions;
    if(!manifest){
      manifest=interactions;
      for(let prior=0;prior<round;prior++)manifest=repairManifest(manifest,cp(`audit-${prior}`)?.audit?.manifestRepairs||[]);
    }
    return approve(report,round,value,manifest,true);
  }
  if(terminal)throw new Fault(terminal.code,terminal.message);
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
    gate(!unsafePublication(deterministic),'SITE_FATAL','Artefato contém dados privados ou caminho público inválido.');
    let rendered={passed:false,tests:[],screenshots:[],engine:null,skipped:'repair-first: corrigir antes de executar'};
    if(deterministic.safeToRender)rendered=await render(files,config,job.repo,signal,{interactions,assets:brief.assets});
    for(const [i,s] of rendered.screenshots.entries())atomic(path.join(dir,'screenshots',`${round}-${i}.jpg`),Buffer.from(s.data,'base64'));
    const shots=await auditReferences(rendered.screenshots,config);
    const audit=await reviewRendered(p,{brief,mode:deterministic.safeToRender?'rendered':'repair-first',diagnostics:deterministic,tests:rendered.tests,interactions,fileHashes:deterministic.fileHashes,files:authorFiles(files),previous:state.previous,baseline:cp('audit-0')||null,patchBudget:{maxFractionPerFile:config.maxPatchFraction,maxCumulativeFraction:config.maxCumulativePatchFraction,extendedFraction:config.maxExtendedPatchFraction,extendedCumulativeFraction:config.maxExtendedCumulativePatchFraction,requiresExtendedJustification:true,cumulative:state.cumulative,remainingRounds:config.maxAuditRounds-round},interactionHashes:Object.fromEntries(interactions.map(i=>[i.id,hash(i)]))},shots,config);
    const score=visualScore(audit);
    must(score!==null,'VISUAL_SCORE','Auditoria não retornou os seis critérios visuais válidos.');
    const current={score,technical:technicalKeys(deterministic,rendered),issues:audit.issues,observedImprovements:audit.observedImprovements};
    const progress=progressEvidence(state.previous,current);
    const passed=score>=config.qualityThreshold;
    const report={policy:AUDIT_POLICY,audit,score,passed,progress,interactions,deterministic,render:{...rendered,screenshots:rendered.screenshots.map(({data,...s})=>s)}};
    save(`audit-${round}`,report);
    save('auditNotes',auditNotes(report,round,config.qualityThreshold,brief.limitations));
    if(passed)return approve(report,round,files,interactions);
    state.noProgress=state.previous&&!progress.progress?state.noProgress+1:0;
    gate(state.noProgress<config.maxNoProgressRounds,'AUDIT_NO_PROGRESS',`Nota visual ${score.toFixed(2)} abaixo de ${config.qualityThreshold}, sem progresso; versões preservadas.`);
    gate(round<config.maxAuditRounds&&(audit.patches.length||audit.manifestRepairs?.length),'AUDIT_REJECTED',`Nota visual ${score.toFixed(2)} abaixo de ${config.qualityThreshold}; sem novas correções disponíveis. Claude não será repetido.`);
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

