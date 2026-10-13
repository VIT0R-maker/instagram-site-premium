import sharp from 'sharp';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { download } from './net.mjs';
import { must, hash, atomic, Fault } from './core.mjs';
import { planCrops } from './crops.mjs';

export function normalizeProfile(details,posts,job,cap) {
  const p=details.find(x=>String(x.username).toLowerCase()===job.username);
  must(p && !p.error,'PROFILE_MISSING','Perfil inexistente ou coleta sem perfil correspondente.');
  must(p.private!==true && p.isPrivate!==true,'PROFILE_PRIVATE','O perfil é privado.');
  const sources=[];
  const source=(id,text,url,date=null) => {if(typeof text==='string'&&text.trim())sources.push({id,text:text.slice(0,6000),url,date});};
  source('profile:name',p.fullName || p.username,job.profile);
  source('profile:bio',p.biography,job.profile);
  source('profile:category',p.businessCategoryName || p.categoryName,job.profile);
  source('profile:external',p.externalUrl,job.profile);
  for(const [i,l] of (p.externalUrls || []).entries()) source(`profile:external:${i}`,typeof l==='string'?l:l.url,job.profile);
  const unique=new Map();
  // Posts em colaboração (ou fixados) podem ter outro dono. Eles são descartados, não usados como evidência.
  // Só falha se a maioria dos posts vier de outro perfil (sinal de coleta errada).
  const returned=[...posts,...(p.latestPosts || [])];
  const own=returned.filter(post=>!post.ownerUsername || String(post.ownerUsername).toLowerCase()===job.username);
  must(returned.length-own.length<=own.length,'PROFILE_MISMATCH','Os posts retornados pertencem majoritariamente a outro perfil.');
  for(const post of own) {
    const id=String(post.id || post.shortCode || ''); if(id && !post.error) unique.set(id,post);
  }
  const ordered=[...unique.values()].sort((a,b)=>String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  const candidates=[]; const seen=new Set();
  function add(url,postId,index,origin,caption,date,postUrl) {
    if(typeof url!=='string'||!url.startsWith('https://'))return;
    let canonical;try{canonical=new URL(url); canonical.search='';}catch{return;}
    if(seen.has(canonical.href))return; seen.add(canonical.href);
    const assetId='a_'+hash(`${job.username}:${postId}:${index}:${canonical.pathname}`).slice(0,20);
    candidates.push({assetId,origin,postId,carouselIndex:index,sourceUrl:url,caption:caption.slice(0,6000),date:date||null,postUrl:postUrl||null,status:'pending',provenance:'instagram_real'});
  }
  add(p.profilePicUrlHD || p.profilePicUrl,'profile',0,'profile','',null,job.profile);
  // Temporal stratification across the requested feed. Each carousel is kept together,
  // without the old three-child cap or a cover-first pass across all posts.
  const interleaved=[];
  for(let lo=0,hi=ordered.length-1;lo<=hi;lo++,hi--) {interleaved.push(ordered[lo]);if(lo!==hi)interleaved.push(ordered[hi]);}
  for(const post of interleaved) {
    const id=String(post.id || post.shortCode), caption=String(post.caption || '');
    source('post:'+id,caption,post.url || job.profile,post.timestamp || null);
    const children=post.childPosts?.length?post.childPosts:(post.images?.length?post.images.map(url=>({displayUrl:url})):[]);
    if(children.length) children.forEach((child,i)=>add(child.displayUrl,id,i,child.type==='Video'?'video_cover':'carousel',caption,post.timestamp,post.url));
    else add(post.displayUrl,id,0,post.type==='Video'?'video_cover':'post',caption,post.timestamp,post.url);
  }
  must(sources.some(s=>s.id==='profile:bio'||s.id.startsWith('post:')),'EVIDENCE_EMPTY','Não há bio nem legendas suficientes para um site honesto.');
  return {profile:{username:job.username,name:p.fullName||p.username,bio:p.biography||'',url:job.profile},sources,posts:ordered.length,candidates:candidates.slice(0,cap),availableCandidates:candidates.length};
}
export async function decodeImage(bytes,config) {
  const im=sharp(bytes,{failOn:'error',limitInputPixels:config.maxImagePixels,animated:false});
  const meta=await im.metadata();
  must(['jpeg','png','webp','avif'].includes(meta.format)&&meta.width&&meta.height,'IMAGE_FORMAT','Conteúdo não é uma imagem suportada e decodificável.');
  must(meta.width>=32 && meta.height>=32 && (meta.pages||1)===1,'IMAGE_DIMENSIONS','Imagem pequena demais ou animada.');
  const original=await im.rotate().toBuffer();
  const corrected=await sharp(original).metadata();
  const analysis=await sharp(original).resize({width:1280,height:1280,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).jpeg({quality:85}).toBuffer();
  const pixels=await sharp(original).resize(9,8,{fit:'fill'}).greyscale().raw().toBuffer();
  let perceptual=0n;for(let y=0;y<8;y++)for(let x=0;x<8;x++)perceptual=(perceptual<<1n)|(pixels[y*9+x]>pixels[y*9+x+1]?1n:0n);
  return {original,analysis,meta:{mime:`image/${meta.format}`,width:corrected.width,height:corrected.height,bytes:bytes.length,hash:hash(bytes),perceptual:perceptual.toString(16).padStart(16,'0'),hasAlpha:!!meta.hasAlpha}};
}
export async function processCandidates(pack,dir,config,signal,fetchImage=download) {
  mkdirSync(path.join(dir,'originals'),{recursive:true});mkdirSync(path.join(dir,'analysis'),{recursive:true});
  const output=new Array(pack.candidates.length); let cursor=0,total=0;
  await Promise.all(Array.from({length:config.downloadConcurrency},async()=>{
    while(cursor<pack.candidates.length) {
      const index=cursor++,c=pack.candidates[index];
      try {
        const rawFile=path.join(dir,'originals',c.assetId);let bytes;
        if(existsSync(rawFile))bytes=readFileSync(rawFile);else bytes=await fetchImage(c.sourceUrl,config,signal);
        const decoded=await decodeImage(bytes,config);
        total+=bytes.length;must(total<=config.maxOriginalBytesPerJob,'IMAGE_BUDGET','Acervo excedeu o teto agregado.');
        atomic(rawFile,bytes);atomic(path.join(dir,'analysis',c.assetId+'.jpg'),decoded.analysis);
        output[index]={...c,...decoded.meta,status:'downloaded',originalPath:'originals/'+c.assetId,analysisPath:'analysis/'+c.assetId+'.jpg',analysisBytes:decoded.analysis.length};
      }catch(e){output[index]={...c,status:'rejected',reason:e instanceof Fault?e.code:'DOWNLOAD_DECODE'};}
    }
  }));
  const seen=new Map(),similar=new Map();
  for(const a of output)if(a.status==='downloaded') {
    if(seen.has(a.hash)){a.status='duplicate';a.duplicateOf=seen.get(a.hash);}else seen.set(a.hash,a.assetId);
    // Exact dHash is advisory, not an automatic discard: preserve distinct useful angles.
    a.duplicateGroup=similar.get(a.perceptual)||a.assetId; similar.set(a.perceptual,a.duplicateGroup);
  }
  return {...pack,assets:output};
}
export function pixels(assets,dir,max=1280) {
  return assets.map(a=>({assetId:a.assetId,mime:'image/jpeg',bytes:readFileSync(path.join(dir,a.analysisPath))}));
}
export async function makeVariants(selected,assets,dir) {
  const out=[];mkdirSync(path.join(dir,'site','assets'),{recursive:true});
  for(const choice of selected) {
    const a=assets.find(x=>x.assetId===choice.assetId);must(a?.status==='downloaded','ASSET_ID','Asset aprovado não existe.');
    const raw=readFileSync(path.join(dir,a.originalPath)),variants=[];
    const maximum=Math.min(a.width,choice.role==='hero'?2400:1600);
    const widths=[...new Set([480,960,1600,2400].filter(w=>w<maximum).concat(maximum))].sort((a,b)=>a-b);
    for(const width of widths)for(const format of ['avif','webp',a.hasAlpha?'png':'jpeg']) {
      const ext=format==='jpeg'?'jpg':format; const file=`assets/${a.assetId}-${width}.${ext}`;
      const pipeline=sharp(raw,{limitInputPixels:40000000}).rotate().resize({width,withoutEnlargement:true});
      const bytes=await pipeline.toFormat(format,{quality:format==='avif'?60:84}).toBuffer();atomic(path.join(dir,'site',file),bytes);
      const info=await sharp(bytes).metadata();variants.push({path:file,width:info.width,height:info.height,mime:`image/${format}`,bytes:bytes.length,sha256:hash(bytes)});
    }
    out.push({...choice,assetId:a.assetId,width:a.width,height:a.height,variants,provenance:a.provenance,hash:a.hash,context:a.visual.observable,alt:a.visual.alt,focalDesktop:a.visual.focalDesktop,focalMobile:a.visual.focalMobile,protectedBox:a.visual.protectedBox,protectedElements:a.visual.protectedElements,cropPlan:planCrops(a,choice),visual:a.visual});
  }
  return out;
}
