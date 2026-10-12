// Adapted from criador-premium cropFit; suggestions are geometry, never a layout template.
export function aspect(value,native) {
  if(value==='native'||value==='auto')return native;
  if(typeof value==='number')return value>0&&Number.isFinite(value)?value:native;
  const m=/^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/.exec(value||'');
  return m&&Number(m[2])>0?Number(m[1])/Number(m[2]):native;
}
export function cropFit({width,height},box,targetAspect,anchor=[.5,.5],adjust=true) {
  if(!width||!height||!(targetAspect>0))throw Error('Geometria de recorte inválida');
  const ratio=width/height,w=Math.min(1,targetAspect/ratio),h=Math.min(1,ratio/targetAspect);
  const [bx,by,bw,bh]=box||[0,0,1,1],clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  let [ax,ay]=anchor.map(v=>clamp(v,0,1)),x=(1-w)*ax,y=(1-h)*ay;
  const fits=()=>bx>=x-1e-5&&by>=y-1e-5&&bx+bw<=x+w+1e-5&&by+bh<=y+h+1e-5;
  const initial=fits();
  if(!initial&&adjust&&bw<=w+1e-5&&bh<=h+1e-5){x=clamp(bx+bw/2-w/2,0,1-w);y=clamp(by+bh/2-h/2,0,1-h);ax=w===1?.5:x/(1-w);ay=h===1?.5:y/(1-h);}
  const intersection=Math.max(0,Math.min(x+w,bx+bw)-Math.max(x,bx))*Math.max(0,Math.min(y+h,by+bh)-Math.max(y,by));
  return {fits:fits(),adjusted:!initial&&fits(),objectPosition:`${(ax*100).toFixed(3)}% ${(ay*100).toFixed(3)}%`,anchor:[ax,ay],visibleBox:[x,y,w,h],protectedFraction:bw*bh?intersection/(bw*bh):1,risk:fits()?null:'A região protegida não cabe: altere proporção, use contain ou outra composição.'};
}
export function planCrops(asset,choice) {
  const native=asset.width/asset.height,v=asset.visual;
  const plan=device=>{const ratio=aspect(choice['componentRatio'+device],native),anchor=v['focal'+device];return {suggestedAspect:ratio,focalPoint:anchor,...cropFit(asset,v.protectedBox,ratio,anchor),alternatives:[native,1,3/2,4/5,16/9].filter((n,i,a)=>a.indexOf(n)===i).map(r=>({aspect:r,...cropFit(asset,v.protectedBox,r,anchor)}))};};
  return {original:{width:asset.width,height:asset.height,aspect:native},protectedBox:v.protectedBox,protectedElements:v.protectedElements,desktop:plan('Desktop'),mobile:plan('Mobile'),flexible:true,note:'Sugestões por dispositivo; escolha outra proporção se necessário. Nunca use um crop impossível só para cumprir o plano.'};
}
export function observedCrop(asset,metric) {
  const fit=metric.objectFit||metric.backgroundSize,position=metric.objectPosition||metric.backgroundPosition||'50% 50%';
  if(!asset.protectedBox||!metric.bounds?.width||!metric.bounds?.height)return null;
  if(['contain','auto'].includes(fit)||metric.objectFit==='fill')return {assetId:asset.assetId,assessed:true,fits:metric.objectFit!=='fill'||Math.abs(metric.bounds.width/metric.bounds.height-asset.width/asset.height)<.03,mode:fit};
  if(fit!=='cover')return {assetId:asset.assetId,assessed:false,reason:'Tamanho CSS complexo: inspeção visual necessária'};
  const terms=position.trim().split(/\s+/),keywords={left:'0%',top:'0%',center:'50%',right:'100%',bottom:'100%'};
  const parsed=terms.map(t=>keywords[t]||t);
  if(parsed.length===1)parsed.push('50%');
  if(parsed.length!==2||parsed.some(t=>!/^\d+(?:\.\d+)?%$/.test(t)))return {assetId:asset.assetId,assessed:false,reason:'Posicionamento CSS complexo: inspeção visual necessária'};
  return {assetId:asset.assetId,assessed:true,...cropFit(asset,asset.protectedBox,metric.bounds.width/metric.bounds.height,parsed.map(t=>parseFloat(t)/100),false)};
}
