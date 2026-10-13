import { parse } from 'parse5';
import { hash } from './core.mjs';

// Source trust is a product policy, not a claim of independent verification.
export function apifyContent(pack) {
  const bio=pack.sources.find(s=>s.id==='profile:bio')?.text ?? pack.profile.bio ?? '';
  const sources=pack.sources.filter(s=>s.id.startsWith('profile:'));
  return {policy:'apify-authoritative-v1',bio,lines:bio.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),sources};
}
export function adoptApifyFacts(input,pack) {
  const facts=structuredClone(input);
  facts.business.name=pack.profile.name||pack.profile.username;
  const ids=new Set();
  facts.claims=facts.claims.map((c,i)=>{
    const id=c.id&&!ids.has(c.id)?c.id:'apify-'+hash([c,i]).slice(0,20);ids.add(id);
    return {...c,id,status:'verified',normalized:c.original};
  });
  // Raw profile claims bypass model summarization, including on resumed cached jobs.
  for(const source of apifyContent(pack).sources) {
    const id='apify-profile-'+hash(source.id).slice(0,20);
    if(ids.has(id))continue;
    facts.claims.push({id,kind:'other',original:source.text,normalized:source.text,sourceId:source.id,quote:source.text,date:source.date||null,status:'verified'});ids.add(id);
  }
  facts.limitations=(facts.limitations||[]).filter(s=>!/^Cidade omitida:|^Afirmação de WhatsApp omitida:/.test(s));
  return facts;
}

function publicUrl(raw) {
  try {
    let u=new URL(raw);
    if(u.hostname==='l.instagram.com'&&u.searchParams.has('u'))u=new URL(u.searchParams.get('u'));
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;
    return u.href;
  } catch {return null;}
}
function phoneUrl(value,countryCode,whatsapp) {
  const digits=value.replace(/\D/g,'');
  if(digits.length<8||digits.length>15)return null;
  if(!whatsapp)return 'tel:'+(value.trim().startsWith('+')?'+':'')+digits;
  // Country code is an explicit deployment setting, never inferred by a model.
  const international=value.trim().startsWith('+')?digits:
    countryCode&&[10,11].includes(digits.length)?countryCode+digits:digits;
  return 'https://wa.me/'+international;
}
export function apifyLinks(facts,pack,config={}) {
  const out=[{id:'instagram',url:pack.profile.url,label:'Ver perfil no Instagram',channel:'instagram',sourceId:'profile:url'}];
  const add=(url,channel,sourceId,label)=>{
    if(!url||out.some(l=>l.url===url))return;
    const base=channel;
    out.push({id:out.some(l=>l.id===base)?base+'-'+hash(url).slice(0,8):base,url,channel,sourceId,label});
  };
  const country=String(config.defaultPhoneCountryCode??'55').replace(/\D/g,'');
  const sources=pack.sources||[];
  const bio=apifyContent(pack).bio;
  for(const s of sources) {
    for(const hit of s.text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      const url=publicUrl(hit[0]);if(!url)continue;
      const u=new URL(url);
      if(u.hostname==='wa.me')add(url,'whatsapp',s.id,'Conversar pelo WhatsApp');
      else if(['api.whatsapp.com','www.whatsapp.com'].includes(u.hostname)&&u.searchParams.get('phone'))add(url,'whatsapp',s.id,'Conversar pelo WhatsApp');
      else if(s.id.startsWith('profile:'))add(url,'website',s.id,/agend|reserv/i.test(bio)?'Agendar atendimento':'Visitar o site');
    }
    for(const hit of s.text.matchAll(/[\w.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g))add('mailto:'+hit[0],'email',s.id,'Enviar e-mail');
    // Extract whole phone numbers; never concatenate fragments across sources.
    for(const hit of s.text.matchAll(/(?:\+\d{1,3}[ .-]*)?(?:\(\d{2}\)|\b\d{2})[ .-]*\d{4,5}[ .-]?\d{4}\b/g)) {
      add(phoneUrl(hit[0],country,false),'phone',s.id,'Ligar para a empresa');
      const prefix=s.text.slice(Math.max(0,hit.index-45),hit.index);
      if(/whatsapp|whats\b|zap\b/i.test(prefix))add(phoneUrl(hit[0],country,true),'whatsapp',s.id,'Conversar pelo WhatsApp');
    }
  }
  for(const c of facts.claims) {
    if(['phone','whatsapp'].includes(c.kind))add(phoneUrl(c.original,country,c.kind==='whatsapp'),c.kind,c.sourceId,c.kind==='whatsapp'?'Conversar pelo WhatsApp':'Ligar para a empresa');
    if(c.kind==='email'&&/^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}$/.test(c.original))add('mailto:'+c.original,'email',c.sourceId,'Enviar e-mail');
    if(['website','shop'].includes(c.kind))add(publicUrl(c.original),c.kind,c.sourceId,c.kind==='shop'?'Acessar a loja':/agend|reserv/i.test(bio)?'Agendar atendimento':'Visitar o site');
  }
  return out;
}
const normalized=s=>String(s).normalize('NFKC').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
export function ensureBioCopy(input,pack,facts) {
  const copy=structuredClone(input),content=apifyContent(pack);
  const present=normalized(copy.sections.flatMap(s=>[s.heading,...s.paragraphs]).join(' '));
  const lines=content.lines.filter(s=>normalized(s)&&!present.includes(normalized(s)));
  if(lines.length) {
    let id='informacoes-do-perfil';while(copy.sections.some(s=>s.id===id))id+='-a';
    const claim=facts.claims.find(c=>c.id==='apify-profile-'+hash('profile:bio').slice(0,20));
    copy.sections.push({id,purpose:'Preservar integralmente a bio em uma composição adequada à marca; pode distribuir estes dados por outras seções.',desktop:'Integrar informações e unidades ao design autoral.',mobile:'Conteúdo completo e legível, sem cortes.',heading:'Informações e atendimento',paragraphs:lines,claimIds:claim?[claim.id]:[],assetIds:[],ctaLinkId:null});
  }
  return copy;
}
export function missingBioContent(files,brief) {
  if(!brief.authoritativeContent)return [];
  const texts=[],hrefs=new Set();
  function visit(n,hidden=false) {
    const attrs=n.attrs||[];
    hidden=hidden||['head','script','style','template','noscript'].includes(n.tagName)||attrs.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true'||a.name==='style'&&/display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.value));
    if(hidden)return;
    if(n.nodeName==='#text')texts.push(n.value);
    if(n.tagName==='a'){const h=attrs.find(a=>a.name==='href');if(h)hrefs.add(h.value);}
    for(const c of n.childNodes||[])visit(c,hidden);
  }
  for(const [name,bytes]of Object.entries(files))if(name.endsWith('.html'))visit(parse(bytes.toString()));
  const visible=normalized(texts.join(' '));
  const missing=brief.authoritativeContent.lines.filter(line=>normalized(line)&&!visible.includes(normalized(line)));
  for(const link of brief.links||[])if(link.sourceId?.startsWith('profile:')&&!hrefs.has(link.url))missing.push('Link do perfil: '+link.url);
  return missing;
}
