import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { must, atomic, hash } from './core.mjs';

export function verifyFacts(facts,pack) {
  const sources=new Map(pack.sources.map(s=>[s.id,s]));const ids=new Set();
  for(const c of facts.claims) {
    must(!ids.has(c.id),'FACT_ID','ID de afirmação repetido.');ids.add(c.id);
    const s=sources.get(c.sourceId);
    must(s && c.quote.length>1 && s.text.includes(c.quote) && c.quote.includes(c.original),'FACT_SOURCE','Afirmação não corresponde a trecho exato da fonte declarada.');
    // Conservative critical values: no normalizing into a new contact or service.
    must(c.normalized.normalize('NFKC').toLocaleLowerCase('pt-BR')===c.original.normalize('NFKC').toLocaleLowerCase('pt-BR'),'FACT_NORMALIZATION','Valor normalizado alterou a afirmação original.');
    if(c.kind==='service')must(c.sourceId==='profile:bio'||c.sourceId.startsWith('post:'),'FACT_SERVICE','Serviço sem bio/legenda.');
    if(['phone','whatsapp'].includes(c.kind)) {
      must(c.quote.includes(c.original),'CONTACT','Contato fragmentado.');
      if(c.kind==='whatsapp')must(/whatsapp|whats\b|wa\.me\//i.test(c.quote),'WHATSAPP','WhatsApp não está explícito na mesma evidência.');
    }
  }
  for(const kind of ['phone','whatsapp','email','address','city','hours']) {
    const group=facts.claims.filter(c=>c.kind===kind && c.status==='verified');
    if(new Set(group.map(c=>c.normalized.toLowerCase())).size>1)group.forEach(c=>c.status='conflict');
  }
  must(facts.business.name===pack.profile.name||facts.business.name===pack.profile.username,'BRAND_NAME','Nome comercial não corresponde ao perfil.');
  must(facts.claims.some(c=>c.kind==='service'&&c.status==='verified'),'OFFER_UNKNOWN','Não há oferta/serviço comprovado suficiente. A geração foi interrompida.');
  return facts;
}
export function confirmedLinks(facts,pack) {
  const links=[{id:'instagram',url:pack.profile.url,label:'Conversar pelo Instagram',channel:'instagram',sourceId:'profile:url'}];
  const claims=facts.claims.filter(c=>c.status==='verified');
  const raw=[];
  for(const s of pack.sources)for(const hit of s.text.matchAll(/https:\/\/[^\s<>"']+/g)) raw.push({url:hit[0],sourceId:s.id});
  for(const x of raw) {
    let u;try{u=new URL(x.url);}catch{continue;}
    if(u.username||u.password||u.port)continue;
    if(u.hostname==='wa.me' && /^\/[1-9]\d{7,14}\/?$/.test(u.pathname))links.push({id:'whatsapp',url:`https://wa.me/${u.pathname.replaceAll('/','')}`,label:'Conversar pelo WhatsApp',channel:'whatsapp',sourceId:x.sourceId});
    if(['api.whatsapp.com','www.whatsapp.com'].includes(u.hostname)&&u.pathname==='/send'&&/^[1-9]\d{7,14}$/.test(u.searchParams.get('phone')||'')) links.push({id:'whatsapp',url:`https://wa.me/${u.searchParams.get('phone')}`,label:'Conversar pelo WhatsApp',channel:'whatsapp',sourceId:x.sourceId});
  }
  for(const c of claims) {
    if(c.kind==='email' && /^[\w.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(c.original))links.push({id:'email',url:'mailto:'+c.original,label:'Enviar e-mail',channel:'email',sourceId:c.sourceId});
    if(['phone','whatsapp'].includes(c.kind) && /^\+[1-9][\d ()-]{7,23}$/.test(c.original)) {
      const digits=c.original.replace(/\D/g,'');if(digits.length<=15)links.push({id:c.kind,url:c.kind==='whatsapp'?'https://wa.me/'+digits:'tel:+'+digits,label:c.kind==='whatsapp'?'Conversar pelo WhatsApp':'Ligar para a empresa',channel:c.kind,sourceId:c.sourceId});
    }
  }
  // Conflict omission, never guess country/area or promote an arbitrary number.
  return links.filter((l,i,a)=>a.findIndex(x=>x.url===l.url)===i && new Set(a.filter(x=>x.id===l.id).map(x=>x.url)).size===1);
}
function luminance(hex) {
  const v=hex.slice(1).match(/../g).map(s=>parseInt(s,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*v[0]+.7152*v[1]+.0722*v[2];
}
export function contrast(a,b) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
export function fixColors(colors) {
  for(const value of Object.values(colors))must(/^#[0-9a-fA-F]{6}$/.test(value),'COLOR','Token de cor inválido.');
  const out={...colors},repairs=[];
  for(const [fg,bg,min] of [['text','background',4.5],['text','surface',4.5],['muted','background',4.5],['muted','surface',4.5],['onAccent','accent',4.5],['focus','background',3]]) {
    if(contrast(out[fg],out[bg])<min){out[fg]=contrast('#111111',out[bg])>=min?'#111111':'#ffffff';repairs.push(`${fg}/${bg}`);}
  }
  if(contrast(out.text,out.background)<4.5||contrast(out.text,out.surface)<4.5||contrast(out.muted,out.background)<4.5||contrast(out.muted,out.surface)<4.5) {
    out.surface=out.background;out.text=contrast('#111111',out.background)>=4.5?'#111111':'#ffffff';out.muted=out.text;repairs.push('surface harmonizada para contraste');
  }
  return {colors:out,repairs};
}
export function installFonts(dir,pair) {
  const pairs={editorial:['lora','dm-sans'],modern:['dm-sans','lora'],technical:['space-grotesk','dm-sans']};
  const names=pairs[pair]; must(names,'FONT','Par de fontes fora do catálogo licenciado.');
  const root=fileURLToPath(new URL('../node_modules/@fontsource-variable/',import.meta.url));
  const files=[],rules=[];
  for(const name of names) {
    const source=path.join(root,name),all=readdirSync(path.join(source,'files'));
    const font=all.find(f=>f.includes('-latin-ext-wght-normal.woff2'));
    const latin=all.find(f=>f.includes('-latin-wght-normal.woff2'));
    must(font&&latin,'FONT_FILES','Arquivos de fonte não encontrados no pacote fixado.');
    const family={'dm-sans':'DM Sans','lora':'Lora','space-grotesk':'Space Grotesk'}[name];
    for(const [f,range] of [[font,'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'],[latin,'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD']]) {
      const target='assets/fonts/'+f;atomic(path.join(dir,'site',target),readFileSync(path.join(source,'files',f)));files.push(target);
      rules.push(`@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:swap;src:url('./${target}') format('woff2');unicode-range:${range}}`);
    }
    const license=readFileSync(path.join(source,'LICENSE'),'utf8');must(/SIL OPEN FONT LICENSE|SIL Open Font License/i.test(license),'FONT_LICENSE','Licença de fonte não confirmada.');
    atomic(path.join(dir,'site',`assets/fonts/LICENSE-${name}.txt`),license);files.push(`assets/fonts/LICENSE-${name}.txt`);
  }
  return {heading:names[0],body:names[1],files,css:rules.join('\n'),license:'SIL Open Font License 1.1; arquivos de licença incluídos'};
}
export function validateBrief(brief,dir,config) {
  must(brief.schemaVersion==='1.0'&&brief.approved===true,'BRIEF_APPROVAL','Briefing sem aprovação.');
  must(brief.sections.length>0 && brief.sections[0].id==='hero','BRIEF_HERO','Primeira seção não é hero.');
  const sectionIds=new Set(),usedAssets=new Set(),claims=new Set(brief.evidence.claims.filter(c=>c.status==='verified').map(c=>c.id)),assets=new Set(brief.assets.map(a=>a.assetId)),links=new Set(brief.links.map(l=>l.id));
  for(const s of brief.sections) {
    must(/^[a-z][a-z0-9-]{0,40}$/.test(s.id)&&!sectionIds.has(s.id),'SECTION_ID','Seção com ID inválido/duplicado.');sectionIds.add(s.id);
    must(s.claimIds.every(id=>claims.has(id))&&s.assetIds.every(id=>assets.has(id))&&(!s.ctaLinkId||links.has(s.ctaLinkId)),'BRIEF_REFERENCE','Referência inexistente no briefing.');
    for(const id of s.assetIds){must(!usedAssets.has(id),'ASSET_REPEAT','Imagem repetida em seções diferentes.');usedAssets.add(id);}
  }
  must(brief.navigation.every(n=>sectionIds.has(n.sectionId)),'NAVIGATION','Âncora de navegação inexistente.');
  must(brief.sections.some(s=>s.ctaLinkId),'CTA_MISSING','Briefing sem CTA funcional.');
  must(brief.assets.every(a=>a.role==='logo'||usedAssets.has(a.assetId)),'ASSET_UNUSED','Asset selecionado sem destino de seção.');
  for(const a of brief.assets)for(const v of a.variants)must(existsSync(path.join(dir,'site',v.path)),'ASSET_MISSING','Arquivo selecionado ainda não existe.');
  const colors=brief.brand.colors;
  must(contrast(colors.text,colors.background)>=4.5 && contrast(colors.text,colors.surface)>=4.5 && contrast(colors.onAccent,colors.accent)>=4.5,'CONTRAST','Tokens sem contraste mínimo.');
  must(brief.assets.length<=config.maxSiteImages,'ASSET_LIMIT','Quantidade final excede o limite.');
  must(Buffer.byteLength(JSON.stringify(brief))<config.claudeInputBytes-6000,'BRIEF_SIZE','Briefing grande demais para a geração reservada.');
  return hash(brief);
}
