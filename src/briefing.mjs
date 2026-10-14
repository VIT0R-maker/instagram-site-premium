import { compactBrief, briefSizeReport } from './brief-package.mjs';
import { apifyContent, ensureBioCopy } from './apify-content.mjs';
import { readFileSync } from 'node:fs';
import { verifyFacts,confirmedLinks,fixColors,validateBrief } from './brief.mjs';
import { chooseFinalists,normalizeSelection } from './curation.mjs';
import { makeVariants,pixels } from './images.mjs';
import { FONT_CATALOG,LIBRARY_CATALOG,installFonts,installLibrary } from './resources.mjs';
import { siteUrl } from './seo.mjs';
import { must,hash } from './core.mjs';

export function repairDependencies(targets) {
  const out=new Set(targets);
  if(out.has('facts'))for(const t of ['links','selection','crops','direction','copy'])out.add(t);
  if(out.has('selection')||out.has('crops'))for(const t of ['variants','direction','copy'])out.add(t);
  if(out.has('fonts'))out.add('direction');
  if(out.has('direction'))for(const t of ['fonts','copy'])out.add(t);
  if(out.has('links')||out.has('structure'))out.add('copy');
  return out;
}
export function validDirections(value) {
  return value.acceptable&&value.directions.length===3&&new Set(value.directions.map(d=>d.id)).size===3&&value.directions.some(d=>d.id===value.chosenId)&&new Set(value.directions.map(d=>hash([d.grid,d.desktopHero,d.textImageRelation,d.typography]))).size===3;
}
export async function chooseDirection(p,payload,images) {
  let answer=await p.gemini('directions',payload,images,'directions',true);
  if(!validDirections(answer))answer=await p.gemini('directions',{...payload,previous:answer,retry:'ID escolhido deve existir; três composições estruturalmente diferentes. Não retornar apenas novas cores.'},images,'directions',true);
  must(validDirections(answer),'DIRECTION_REJECTED','Direção inválida ou alternativas indistinguíveis após recuperação limitada.');return answer;
}
export async function buildBrief({p,pack,facts,selection,dir,cfg,job,cp,save}) {
  let state=cp('briefWork')||{round:0,targets:['facts','selection','direction','copy'],facts,selection,copy:null,directions:null};
  // Initial facts/selection already have their own completed stages.
  if(!cp('briefWork'))state.targets=['variants','direction','copy'];
  let brief;
  for(let round=state.round;round<=cfg.maxBriefReviewRounds;round++) {
    const targets=repairDependencies(state.targets),review=state.review||null;
    facts=verifyFacts(state.facts,pack);selection=state.selection;
    if(targets.has('facts'))facts=verifyFacts(await p.gemini('facts',{profile:pack.profile,sources:pack.sources,review}),pack);
    if(targets.has('crops')) {
      const selected=pack.assets.filter(a=>a.status==='downloaded'&&(targets.has('facts')||selection.assets.some(s=>s.assetId===a.assetId)));
      for(let i=0;i<selected.length;i+=cfg.analysisBatchSize){const batch=selected.slice(i,i+cfg.analysisBatchSize);const result=await p.gemini('batch',{business:facts.business,images:batch.map(a=>({assetId:a.assetId,caption:a.caption,width:a.width,height:a.height})),review},pixels(batch,dir));
        must(result.images.length===batch.length&&new Set(result.images.map(a=>a.assetId)).size===batch.length,'CURATION_IDS','Revisão dos recortes perdeu IDs.');
        for(const a of batch){const v=result.images.find(v=>v.assetId===a.assetId);must(v,'CURATION_IDS','Revisão visual perdeu ID de asset.');if(v.roles.includes('reject'))targets.add('selection');const [x,y,w,h]=v.protectedBox;must(x+w<=1.001&&y+h<=1.001,'VISUAL_BOX','Área protegida inválida.');a.visual=v;}
      }
      save('visualCollection',pack);
    }
    if(targets.has('selection')){const finalists=chooseFinalists(pack.assets,cfg.maxFinalists);selection=normalizeSelection(await p.gemini('selection',{business:facts.business,maxSiteImages:cfg.maxSiteImages,finalists:finalists.map(a=>a.visual),previous:selection,review},pixels(finalists,dir),'selection',true),finalists,cfg.maxSiteImages);}
    const links=confirmedLinks(facts,pack,cfg);
    const assets=targets.has('variants')||!state.assets?await makeVariants(selection.assets,pack.assets,dir):state.assets;
    const images=pixels(pack.assets.filter(a=>selection.assets.some(s=>s.assetId===a.assetId)),dir);
    let directions=state.directions;
    if(targets.has('direction')||!directions)directions=await chooseDirection(p,{facts,selection,fontCatalog:FONT_CATALOG,libraryCatalog:LIBRARY_CATALOG,assets,review,previous:directions},images);
    const chosen=directions.directions.find(d=>d.id===directions.chosenId),fonts=installFonts(dir,chosen.fonts),resources=installLibrary(dir,chosen.library,chosen.libraryReason),color=fixColors(selection.identity.colors);
    let suggestion=cp('nemotronOptional');if(suggestion===undefined){suggestion=await p.nemotron(facts);cp('nemotronOptional',suggestion);}
    let copy=state.copy;if(targets.has('copy')||!copy)copy=await p.gemini('copy',{facts,links,direction:chosen,assets,nemotronOptional:suggestion,previousCopy:copy,review},[],'copy',true);
    copy=ensureBioCopy(copy,pack,facts);
    brief={authoritativeContent:apifyContent(pack),schemaVersion:'2.0',approved:true,publication:{url:siteUrl(cp('preflight').owner,job.repo),repo:job.repo},resources,
      constraints:{immutable:['fatos e evidências','identidade comercial','contatos coletados pelo Apify','origem dos assets'],qualityRequired:['legibilidade','região protegida das fotos','responsividade','interações funcionais','fidelidade factual'],directionPreferences:['tipografia preparada','conceito escolhido','paleta observada'],creativeFreedom:['estrutura e ordem editorial','grid e proporções','SVG e detalhes','movimento','omitir recursos opcionais','reuso funcional']},
      job:{id:job.id,profile:job.profile,language:'pt-BR',status:'brief_approved'},business:facts.business,evidence:{claims:facts.claims,sources:pack.sources},brand:{...selection.identity,...color,typography:fonts},creativeDirection:chosen,assets,sections:copy.sections,navigation:copy.navigation,links,motion:{policy:chosen.motion,reducedMotion:'respeitar preferência sem ocultar conteúdo',contentVisibleByDefault:true},seo:copy.seo,
      technical:{format:'HTML/CSS/JS/SVG locais; contrato 2.0, até 16 arquivos autorais',fontsCss:fonts.css,dependencies:'fontes, fotos e biblioteca opcional preparadas',basePath:'./',allowedExtensions:['html','css','js','svg'],optionalRuntime:{path:'runtime.js',source:readFileSync(new URL('./runtime.js',import.meta.url),'utf8')},year:new Date().getUTCFullYear()},acceptance:{viewports:cfg.renderViewports,threshold:cfg.qualityThreshold,noCriticalIssues:true},limitations:[...facts.limitations,...selection.limitations,...copy.limitations]};
    // Preserve source material privately; review and create from one compact projection.
    save('briefFull',brief);
    const fullBrief=brief;
    brief=compactBrief(fullBrief);
    const sizeReport=save('briefSize',briefSizeReport(fullBrief,brief,cfg));
    // A transport budget failure cannot be repaired by rewriting customer-facing copy.
    if(sizeReport.compactBytes>=sizeReport.limitBytes) {
      save('briefReview',{approved:false,repairTargets:[],issues:[{severity:'high',component:'BRIEF_SIZE',evidence:JSON.stringify(sizeReport),description:'Pacote compacto excedeu o limite local; nenhuma informação foi descartada.',fix:'Ajustar claudeInputBytes após consultar briefSize.json.'}],reason:'Orçamento do pacote compacto'});
      must(false,'BRIEF_SIZE',`Briefing compacto: ${sizeReport.compactBytes} bytes; limite: ${sizeReport.limitBytes}. Consulte briefSize.json e ajuste claudeInputBytes; não reescreva a copy.`);
    }
    let nextReview;
    try{validateBrief(brief,dir,cfg);}catch(e){nextReview={approved:false,repairTargets:e.code==='ASSET_BUDGET'?['selection']:['copy'],issues:[{severity:'high',component:e.code,evidence:e.message,description:e.message,fix:'Corrigir a causa no briefing'}],reason:'Validação determinística'};}
    if(!nextReview)nextReview=await p.gemini('review',{brief,availableAssets:pack.assets.filter(a=>a.visual).map(a=>({assetId:a.assetId,...a.visual})),fontCatalog:FONT_CATALOG},images,'review',true);
    save('briefReview',nextReview);save('facts',facts);save('curation',selection);save('directions',directions);
    if(nextReview.approved&&!nextReview.issues.some(i=>['high','critical'].includes(i.severity))){validateBrief(brief,dir,cfg);return save('brief',brief);}
    must(round<cfg.maxBriefReviewRounds,'BRIEF_REJECTED','Briefing reprovado; diagnóstico e dependências preservados, Claude não foi chamado.');
    state={round:round+1,targets:nextReview.repairTargets?.length?nextReview.repairTargets:['copy'],review:nextReview,facts,selection,assets,directions,copy};save('briefWork',state);
  }
}


