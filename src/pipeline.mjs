import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildBrief } from './briefing.mjs';
import { analysisContext, chooseFinalists, normalizeSelection } from './curation.mjs';
import { Providers } from './providers.mjs';
import { normalizeProfile, processCandidates, pixels } from './images.mjs';
import { verifyFacts, validateBrief } from './brief.mjs';
import { publicationPreflight, publishSite } from './publish.mjs';
import { validateSite } from './validate-site.mjs';
import { auditProject } from './audit.mjs';
import { claudeReferences } from './vision.mjs';
import { verifyResources } from './resources.mjs';
import { safePublicPath } from './validate-site.mjs';
import { must, atomic, hash, Fault } from './core.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);

export class Pipeline {
  constructor(config,env,store,root,dependencies={}) {Object.assign(this,{config,env,store,root,dependencies});}
  async run(stage,job,signal) {
    const p=this.dependencies.createProviders?.(job,signal)||new Providers(this.config,this.env,this.store,job,signal);
    const dir=path.join(this.root,'jobs',job.id),cp=(key,value)=>value===undefined?this.store.checkpoint(job.id,key):this.store.checkpoint(job.id,key,value);
    const save=(key,value)=>{cp(key,value);atomic(path.join(dir,key+'.json'),value);return value;};
    const cfg=this.config;
    if(stage==='preflight') {
      for(const key of ['GEMINI_API_KEY','ANTHROPIC_API_KEY','APIFY_TOKEN','GITHUB_TOKEN'])must(this.env[key]?.length>=12,'CONFIG_SECRET',`Configure ${key} no worker.`);
      const models=await p.preflightModels();
      const gh=await publicationPreflight(p);
      await exec('docker',['image','inspect',cfg.rendererImage,'--format','{{.Id}}'],{timeout:15000,windowsHide:true});
      // Verify all optional font packages before consuming Claude.
      verifyResources();
      return save('preflight',{...gh,models:Object.keys(models)});
    }
    if(stage==='collect') {
      const details=await p.apify('details',1),posts=await p.apify('posts',cfg.postsLimit);
      const pack=normalizeProfile(details,posts,job,cfg.maxCandidateImages);
      const result=await processCandidates(pack,dir,cfg,signal,this.dependencies.fetchImage);
      must(result.assets.some(a=>a.status==='downloaded'),'NO_IMAGES','Nenhuma imagem real pôde ser decodificada.');
      this.store.event(job.id,'collection',{posts:result.posts,candidates:result.candidates.length,downloaded:result.assets.filter(a=>a.status==='downloaded').length,rejected:result.assets.filter(a=>a.status!=='downloaded').length});
      return save('collection',result);
    }
    if(stage==='curate') {
      let pack=cp('collection');
      // Rehydrate text from existing Apify checkpoints after policy updates, without a new scrape.
      const savedDetails=cp('apify:details:1:dataset');
      const savedPosts=cp(`apify:posts:${cfg.postsLimit}:dataset`);
      if(savedDetails&&savedPosts) {
        const refreshed=normalizeProfile(savedDetails,savedPosts,job,cfg.maxCandidateImages);
        pack={...pack,profile:refreshed.profile,sources:refreshed.sources};save('collection',pack);
      }
      let facts=verifyFacts(await p.gemini('facts',{profile:pack.profile,sources:pack.sources}),pack);save('facts',facts);
      async function analyze() {
        const contextHash=analysisContext(facts);
        const valid=pack.assets.filter(a=>a.status==='downloaded'&&!(a.visual&&a.visualContext===contextHash));
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
          for(const a of batch){a.visual=answer.images.find(x=>x.assetId===a.assetId);a.visualContext=contextHash;const [x,y,w,h]=a.visual.protectedBox;must(x+w<=1.01&&y+h<=1.01,'VISUAL_BOX','Área protegida ultrapassa a imagem.');}
        }
      }
      await analyze();
      // One bounded expansion only when the initial usable collection is poor.
      if(pack.assets.filter(a=>a.visual&&!a.visual.roles.includes('reject')&&a.visual.quality>=65).length<Math.min(5,cfg.maxSiteImages)&&cfg.expandedCandidateImages>cfg.maxCandidateImages) {
        const details=await p.apify('details',1),posts=await p.apify('posts',cfg.expandedPostsLimit);
        const previous=new Map(pack.assets.map(a=>[a.assetId,a]));
        pack=await processCandidates(normalizeProfile(details,posts,job,cfg.expandedCandidateImages),dir,cfg,signal,this.dependencies.fetchImage);
        for(const a of pack.assets){const old=previous.get(a.assetId);if(old?.hash===a.hash&&old?.visual){a.visual=old.visual;a.visualContext=old.visualContext;}}
        facts=verifyFacts(await p.gemini('facts',{profile:pack.profile,sources:pack.sources}),pack);save('facts',facts);
        await analyze();save('collection',pack);
      }
      const finalists=chooseFinalists(pack.assets,cfg.maxFinalists);
      let selection;
      if(finalists.length)selection=await p.gemini('selection',{business:facts.business,maxSiteImages:cfg.maxSiteImages,finalists:finalists.map(a=>({assetId:a.assetId,...a.visual}))},pixels(finalists,dir),'selection',true);
      else selection={heroMode:'typographic',assets:[],identity:{logoAssetId:null,logoReason:'Nenhuma logo aprovada',colors:{background:'#f8f7f3',surface:'#ffffff',text:'#171717',muted:'#454545',accent:'#333333',onAccent:'#ffffff',border:'#777777',focus:'#222222'},colorEvidence:'Paleta neutra por insuficiência de identidade visual confiável'},limitations:['Todas as imagens foram rejeitadas; site tipográfico sem fotografia.']};
      selection=normalizeSelection(selection,finalists,cfg.maxSiteImages);
      verifyFacts(facts,pack);save('visualCollection',pack);return save('curation',selection);
    }
    if(stage==='brief')return buildBrief({p,pack:cp('visualCollection'),facts:cp('facts'),selection:cp('curation'),dir,cfg,job,cp,save});
    if(stage==='generate') {
      const brief=cp('brief');validateBrief(brief,dir,cfg);
      must(cp('briefReview')?.approved,'BRIEF_APPROVAL','Revisão obrigatória do briefing não aprovada.');
      const refs=this.store.claude(job.id)?[]:await claudeReferences(brief,cp('visualCollection'),dir,cfg);
      const response=await p.claude(brief,refs);
      const names=response.files.map(f=>f.path);
      must(new Set(names.map(n=>n.toLowerCase())).size===names.length&&names.includes('index.html')&&names.some(f=>f.endsWith('.css')),'SITE_FILES','Envelope com arquivos ausentes/duplicados (inclusive em Windows).');
      for(const f of response.files)must(safePublicPath(f.path)&&!/^assets\/|^lib\//.test(f.path),'SITE_PATH','Caminho de arquivo autoral inválido.');
      for(const f of response.files)atomic(path.join(dir,'site',f.path),f.content);
      if(!names.includes('runtime.js')&&response.files.some(f=>f.path.endsWith('.html')&&f.content.includes('./runtime.js'))) {
        atomic(path.join(dir,'site','runtime.js'),readFileSync(new URL('./runtime.js',import.meta.url)));names.push('runtime.js');
      }
      atomic(path.join(dir,'site','.nojekyll'),'');
      atomic(path.join(dir,'site','README.md'),'# Site estático\n\nHTML, CSS, JavaScript e SVG autorais. Fotografias e fontes locais em assets/; licenças incluídas. Bibliotecas opcionais em lib/. Publicação GitHub Pages com caminhos relativos. Conteúdo essencial disponível sem JavaScript.\n');
      return save('generation',{complete:true,schemaVersion:'2.0',responseHash:hash(response),files:names,interactions:response.interactions});
    }
    if(stage==='audit') {
      const brief=cp('brief'),generation=cp('generation');
      must(brief.schemaVersion==='2.0'&&generation?.schemaVersion==='2.0','JOB_MIGRATION','Job antigo já gerado permanece preservado e não pode ser regenerado. Veja a migração documentada.');
      const publicFiles=[...generation.files,'.nojekyll','README.md',...brief.brand.typography.files,...brief.resources.files,...brief.assets.flatMap(a=>a.variants.map(v=>v.path))];
      const files=Object.fromEntries([...new Set(publicFiles)].map(f=>[f,readFileSync(path.join(dir,'site',f))]));
      return auditProject({files,brief,interactions:generation.interactions,config:cfg,p,dir,job,signal,cp,save});
    }
    if(stage==='publish') {
      const approval=cp('approval');must(approval?.approved,'QUALITY_GATE','Não existe aprovação obrigatória.');
      const files=Object.fromEntries(approval.files.map(f=>[f,readFileSync(path.join(dir,'site',f))]));
      if(approval.schemaVersion==='2.0')validateSite(files,cp('brief'),Object.values(this.env),cp('approvedInteractions')||cp('generation').interactions);
      // A v1 approval remains byte-bound; do not mutate or regenerate historical artifacts.
      return publishSite(p,files,approval);
    }
    throw new Fault('STAGE','Etapa desconhecida.');
  }
}

