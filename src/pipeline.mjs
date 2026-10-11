import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Providers } from './providers.mjs';
import { normalizeProfile, processCandidates, pixels, makeVariants } from './images.mjs';
import { verifyFacts, confirmedLinks, fixColors, installFonts, validateBrief } from './brief.mjs';
import { publicationPreflight, publishSite } from './publish.mjs';
import { listFiles, validateSite, applyPatches } from './validate-site.mjs';
import { renderIsolated } from './render.mjs';
import { must, atomic, hash, Fault, STAGES } from './core.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);

export class Pipeline {
  constructor(config,env,store,root) {Object.assign(this,{config,env,store,root});}
  async run(stage,job,signal) {
    const p=new Providers(this.config,this.env,this.store,job,signal);
    const dir=path.join(this.root,'jobs',job.id),cp=(key,value)=>value===undefined?this.store.checkpoint(job.id,key):this.store.checkpoint(job.id,key,value);
    const save=(key,value)=>{cp(key,value);atomic(path.join(dir,key+'.json'),value);return value;};
    const cfg=this.config;
    if(stage==='preflight') {
      for(const key of ['GEMINI_API_KEY','ANTHROPIC_API_KEY','APIFY_TOKEN','GITHUB_TOKEN'])must(this.env[key]?.length>=12,'CONFIG_SECRET',`Configure ${key} no worker.`);
      const models=await p.preflightModels();
      const gh=await publicationPreflight(p);
      await exec('docker',['image','inspect',cfg.rendererImage,'--format','{{.Id}}'],{timeout:15000,windowsHide:true});
      // Verify all optional font packages before consuming Claude.
      installFonts(dir,'editorial');installFonts(dir,'technical');
      return save('preflight',{...gh,models:Object.keys(models)});
    }
    if(stage==='collect') {
      const details=await p.apify('details',1),posts=await p.apify('posts',cfg.postsLimit);
      const pack=normalizeProfile(details,posts,job,cfg.maxCandidateImages);
      const result=await processCandidates(pack,dir,cfg,signal);
      must(result.assets.some(a=>a.status==='downloaded'),'NO_IMAGES','Nenhuma imagem real pôde ser decodificada.');
      this.store.event(job.id,'collection',{posts:result.posts,candidates:result.candidates.length,downloaded:result.assets.filter(a=>a.status==='downloaded').length,rejected:result.assets.filter(a=>a.status!=='downloaded').length});
      return save('collection',result);
    }
    if(stage==='curate') {
      let pack=cp('collection');
      const facts=verifyFacts(await p.gemini('facts',{profile:pack.profile,sources:pack.sources}),pack);save('facts',facts);
      async function analyze() {
        const valid=pack.assets.filter(a=>a.status==='downloaded');
        for(let start=0;start<valid.length;) {
          const batch=[];let payloadSize=200000;
          while(start<valid.length&&batch.length<cfg.analysisBatchSize) {
            const next=valid[start],bytes=Math.ceil(next.analysisBytes/3)*4;
            if(payloadSize+bytes>cfg.geminiPayloadBytes&&batch.length)break;
            must(payloadSize+bytes<=cfg.geminiPayloadBytes,'GEMINI_IMAGE_SIZE','Imagem de análise individual excede o teto serializado.');
            batch.push(next);payloadSize+=bytes;start++;
          }
          const answer=await p.gemini('batch',{business:facts.business,images:batch.map(a=>({assetId:a.assetId,origin:a.origin,caption:a.caption,width:a.width,height:a.height,duplicateGroup:a.duplicateGroup}))},pixels(batch,dir));
          const ids=answer.images.map(a=>a.assetId);
          must(ids.length===batch.length&&new Set(ids).size===ids.length&&batch.every(a=>ids.includes(a.assetId)),'CURATION_IDS','Gemini perdeu ou inventou IDs no lote.');
          for(const a of batch){a.visual=answer.images.find(x=>x.assetId===a.assetId);const [x,y,w,h]=a.visual.protectedBox;must(x+w<=1.01&&y+h<=1.01,'VISUAL_BOX','Área protegida ultrapassa a imagem.');}
        }
      }
      await analyze();
      // One bounded expansion only when the initial usable collection is poor.
      if(pack.assets.filter(a=>a.visual&&!a.visual.roles.includes('reject')&&a.visual.quality>=65).length<Math.min(5,cfg.maxSiteImages)&&cfg.expandedCandidateImages>cfg.maxCandidateImages) {
        const details=await p.apify('details',1),posts=await p.apify('posts',cfg.expandedPostsLimit);
        pack=await processCandidates(normalizeProfile(details,posts,job,cfg.expandedCandidateImages),dir,cfg,signal);
        await analyze();save('collection',pack);
      }
      // Diversify per post; no rejected asset can enter the global comparison.
      const useful=pack.assets.filter(a=>a.visual&&!a.visual.roles.includes('reject')).sort((a,b)=>b.visual.quality-a.visual.quality);
      const finalists=[],postCounts=new Map();
      for(const a of useful){const n=postCounts.get(a.postId)||0;if(n<2&&finalists.length<cfg.maxFinalists){finalists.push(a);postCounts.set(a.postId,n+1);}}
      for(const a of useful)if(finalists.length<cfg.maxFinalists&&!finalists.includes(a))finalists.push(a);
      let selection;
      if(finalists.length)selection=await p.gemini('selection',{business:facts.business,maxSiteImages:cfg.maxSiteImages,finalists:finalists.map(a=>({assetId:a.assetId,...a.visual}))},pixels(finalists,dir),'selection',true);
      else selection={heroMode:'typographic',assets:[],identity:{logoAssetId:null,logoReason:'Nenhuma logo aprovada',colors:{background:'#f8f7f3',surface:'#ffffff',text:'#171717',muted:'#454545',accent:'#333333',onAccent:'#ffffff',border:'#777777',focus:'#222222'},colorEvidence:'Paleta neutra por insuficiência de identidade visual confiável'},limitations:['Todas as imagens foram rejeitadas; site tipográfico sem fotografia.']};
      must(selection.assets.length<=cfg.maxSiteImages&&new Set(selection.assets.map(a=>a.assetId)).size===selection.assets.length,'SELECTION_LIMIT','Curadoria fora dos limites.');
      for(const a of selection.assets) {
        const f=finalists.find(x=>x.assetId===a.assetId);
        must(f&&!f.visual.roles.includes('reject')&&f.visual.roles.includes(a.role),'SELECTION_ROLE','Asset não aprovado para a função escolhida.');
      }
      must(selection.heroMode==='typographic'?!selection.assets.some(a=>a.role==='hero'):selection.assets.filter(a=>a.role==='hero').length===1,'HERO_POLICY','Hero incoerente com a curadoria.');
      must(!selection.identity.logoAssetId||selection.assets.some(a=>a.assetId===selection.identity.logoAssetId&&a.role==='logo'),'LOGO_POLICY','Logo fora da seleção.');
      verifyFacts(facts,pack);save('visualCollection',pack);return save('curation',selection);
    }
    if(stage==='brief') {
      const pack=cp('visualCollection'),facts=cp('facts'),selection=cp('curation');
      const links=confirmedLinks(facts,pack);
      const finalAssets=await makeVariants(selection.assets,pack.assets,dir);
      const finalPixels=pixels(pack.assets.filter(a=>selection.assets.some(s=>s.assetId===a.assetId)),dir);
      let directions=await p.gemini('directions',{facts,selection,assets:finalAssets},finalPixels,'directions',true);
      if(!directions.acceptable)directions=await p.gemini('directions',{facts,selection,assets:finalAssets,previous:directions,retry:'Proponha três novas alternativas viáveis.'},finalPixels,'directions',true);
      must(directions.acceptable,'DIRECTION_REJECTED','Nenhuma direção criativa viável foi aprovada.');
      const chosen=directions.directions.find(d=>d.id===directions.chosenId);must(chosen,'DIRECTION_ID','Direção escolhida inexistente.');save('directions',directions);
      const fonts=installFonts(dir,chosen.fontPair),color=fixColors(selection.identity.colors);
      const suggestion=await p.nemotron(facts);
      const limits=[...facts.limitations,...selection.limitations];
      if(cfg.enableAiDecorativeImages)limits.push('Geração de imagens IA não implementada nesta edição; usados somente fotos reais e decoração CSS.');
      let copy,brief,review;
      for(let round=0;round<=cfg.maxBriefReviewRounds;round++) {
        copy=await p.gemini('copy',{facts,links,direction:chosen,assets:finalAssets,nemotronOptional:suggestion,previousCopy:copy||null,review:review||null},[],'copy',true);
        brief={schemaVersion:'1.0',approved:true,job:{id:job.id,profile:job.profile,language:'pt-BR',status:'brief_approved'},business:facts.business,evidence:{claims:facts.claims,sources:pack.sources},brand:{...selection.identity,...color,typography:fonts},creativeDirection:chosen,assets:finalAssets,sections:copy.sections,navigation:copy.navigation,links,motion:{policy:chosen.motion,reducedMotion:'none',contentVisibleByDefault:true},seo:copy.seo,technical:{format:'index.html + styles.css + trusted runtime.js',fontsCss:fonts.css,dependencies:'somente fontes e assets locais',basePath:'./',menu:'nonmodal disclosure',allowedFiles:['index.html','styles.css'],year:new Date().getUTCFullYear()},acceptance:{viewports:[360,390,768,1440],threshold:cfg.qualityThreshold,noCriticalIssues:true},limitations:[...limits,...copy.limitations]};
        try{validateBrief(brief,dir,cfg);}catch(e){if(round===cfg.maxBriefReviewRounds)throw e;review={approved:false,issues:[{description:e.message}],reason:'Validação determinística'};continue;}
        review=await p.gemini('review',{brief},[],'review',true);save('briefReview',review);
        if(review.approved&&!review.issues.some(i=>['high','critical'].includes(i.severity)))break;
        must(round<cfg.maxBriefReviewRounds,'BRIEF_REJECTED','Briefing reprovado após as rodadas permitidas.');
      }
      validateBrief(brief,dir,cfg);return save('brief',brief);
    }
    if(stage==='generate') {
      const brief=cp('brief');validateBrief(brief,dir,cfg);
      must(cp('briefReview')?.approved,'BRIEF_APPROVAL','Revisão obrigatória do briefing não aprovada.');
      const response=await p.claude(brief);
      must(response.files.length===2&&new Set(response.files.map(f=>f.path)).size===2,'SITE_FILES','Envelope com arquivos ausentes/duplicados.');
      for(const f of response.files)atomic(path.join(dir,'site',f.path),f.content);
      atomic(path.join(dir,'site','runtime.js'),readFileSync(new URL('./runtime.js',import.meta.url)));
      atomic(path.join(dir,'site','.nojekyll'),'');
      atomic(path.join(dir,'site','README.md'),'# Site estático\n\nEdite index.html e styles.css. Imagens em assets/; fontes locais com licenças em assets/fonts/.\n\nPublicação: GitHub Pages, branch principal, pasta raiz. Caminhos relativos preservam o subcaminho do repositório.\n\nJavaScript melhora apenas o menu; o conteúdo permanece disponível sem ele.\n');
      // No automatic closing tags, extraction heuristics or whole-site Gemini rewrite.
      return save('generation',{complete:true,responseHash:hash(response),files:response.files.map(f=>f.path)});
    }
    if(stage==='audit') {
      const brief=cp('brief'),site=path.join(dir,'site');
      let files=Object.fromEntries(listFiles(site).map(f=>[f,readFileSync(path.join(site,f))]));
      // Remove only preflight font packages not selected for this final brief.
      const publicFiles=new Set(['index.html','styles.css','runtime.js','.nojekyll','README.md',...brief.brand.typography.files,...brief.assets.flatMap(a=>a.variants.map(v=>v.path))]);
      files=Object.fromEntries(Object.entries(files).filter(([f])=>publicFiles.has(f)));
      must(Object.values(files).reduce((n,b)=>n+b.length,0)<=cfg.maxPublicBytes,'SITE_BUDGET','Pacote público excedeu o teto.');
      let previous=null;
      for(let round=0;round<=cfg.maxAuditRounds;round++) {
        const deterministic=validateSite(files,brief,Object.values(this.env));
        const rendered=await renderIsolated(files,cfg,job.repo,signal);
        for(const [i,s] of rendered.screenshots.entries())atomic(path.join(dir,'screenshots',`${round}-${i}.jpg`),Buffer.from(s.data,'base64'));
        const shots=rendered.screenshots.map(s=>({label:s.label,mime:'image/jpeg',bytes:Buffer.from(s.data,'base64')}));
        const audit=await p.gemini('audit',{brief,tests:rendered.tests,fileHashes:deterministic.fileHashes,files:{'index.html':files['index.html'].toString(),'styles.css':files['styles.css'].toString()}},shots,'audit',true);
        const score=Object.values(audit.rubric).reduce((a,b)=>a+b,0)/6;
        const passed=rendered.passed&&score>=cfg.qualityThreshold&&!audit.issues.some(i=>['high','critical'].includes(i.severity));
        save(`audit-${round}`,{audit,score,deterministic,render:{...rendered,screenshots:rendered.screenshots.map(({data,...s})=>s)}});
        if(previous&&score<previous.score) {
          files=previous.files;for(const [f,b]of Object.entries(files))atomic(path.join(site,f),b);
          throw new Fault('PATCH_REGRESSION','Patch piorou a avaliação; versão anterior restaurada. Publicação bloqueada.');
        }
        if(passed) {
          for(const [f,b]of Object.entries(files))atomic(path.join(site,f),b);
          const hashes=Object.fromEntries(Object.entries(files).map(([f,b])=>[f,hash(b)]));
          return save('approval',{approved:true,score,filesHash:hash(hashes),files:Object.keys(files),round,renderer:rendered.engine,reviewedAt:new Date().toISOString()});
        }
        must(round<cfg.maxAuditRounds&&audit.patches.length,'AUDIT_REJECTED','Revisão reprovou o site ou exige reconstrução; publicação bloqueada.');
        previous={score,files};files=applyPatches(files,audit.patches);
      }
    }
    if(stage==='publish') {
      const approval=cp('approval');must(approval?.approved,'QUALITY_GATE','Não existe aprovação obrigatória.');
      const files=Object.fromEntries(approval.files.map(f=>[f,readFileSync(path.join(dir,'site',f))]));
      validateSite(files,cp('brief'),Object.values(this.env));
      return publishSite(p,files,approval);
    }
    throw new Fault('STAGE','Etapa desconhecida.');
  }
}
