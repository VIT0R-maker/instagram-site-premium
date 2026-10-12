import { must, hash } from './core.mjs';
export const analysisContext=facts=>hash({name:facts.business.name,niche:facts.business.niche,subniche:facts.business.subniche,tone:facts.business.tone});
export function chooseFinalists(assets,limit) {
  const useful=assets.filter(a=>a.visual&&!a.visual.roles.includes('reject'));
  const logos=useful.filter(a=>a.origin==='profile'&&a.visual.roles.includes('logo'));
  const ranked=useful.filter(a=>!logos.includes(a)).sort((a,b)=>b.visual.quality-a.visual.quality),out=[...logos],counts=new Map();
  for(const a of ranked){const n=counts.get(a.postId)||0;if(n<2&&out.length<limit){out.push(a);counts.set(a.postId,n+1);}}
  for(const a of ranked)if(out.length<limit&&!out.includes(a))out.push(a);
  return out.slice(0,limit);
}
export function normalizeSelection(selection,finalists,limit) {
  const out=structuredClone(selection),ids=new Set();
  for(const a of out.assets){const f=finalists.find(x=>x.assetId===a.assetId);must(!ids.has(a.assetId)&&f&&!f.visual.roles.includes('reject')&&f.visual.roles.includes(a.role),'SELECTION_ROLE','Imagem rejeitada, duplicada ou função sem aprovação visual.');ids.add(a.assetId);a.priority=a.priority||(['logo','hero'].includes(a.role)?'essential':'recommended');if(['logo','hero'].includes(a.role))a.priority='essential';}
  if(out.identity.logoAssetId)must(out.assets.some(a=>a.assetId===out.identity.logoAssetId&&a.role==='logo'),'LOGO_POLICY','Logo identificada não pode desaparecer da seleção.');
  must(out.heroMode==='typographic'?!out.assets.some(a=>a.role==='hero'):out.assets.filter(a=>a.role==='hero').length===1,'HERO_POLICY','Hero incoerente com a curadoria.');
  const essential=out.assets.filter(a=>a.priority==='essential');must(essential.length<=limit,'SELECTION_ESSENTIAL','Recursos essenciais excedem orçamento; reavaliar antes de gerar.');
  if(out.assets.length>limit){const ranks={essential:0,recommended:1,optional:2};const ordered=out.assets.map((a,i)=>({a,i})).sort((a,b)=>ranks[a.a.priority]-ranks[b.a.priority]||a.i-b.i);const keep=new Set(ordered.slice(0,limit).map(x=>x.a.assetId));const dropped=out.assets.filter(a=>!keep.has(a.assetId));out.assets=out.assets.filter(a=>keep.has(a.assetId));out.limitations.push('Orçamento: omitidos somente recursos não essenciais: '+dropped.map(a=>a.assetId).join(', '));}
  return out;
}
