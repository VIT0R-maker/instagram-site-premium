import { parse, parseFragment, serialize } from 'parse5';
import { must } from './core.mjs';

export const SITE_CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; media-src 'self'; worker-src 'none'";
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function attr(n,k){return n.attrs?.find(a=>a.name===k)?.value;}
export function siteUrl(owner,repo) {
  must(/^[a-zA-Z0-9-]+$/.test(owner)&&/^[a-zA-Z0-9_.-]+$/.test(repo),'SEO_URL','Owner/repositório inválidos.');
  return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}
export function structuredData(brief,url) {
  const data={'@context':'https://schema.org','@type':'Organization',name:brief.business.name,url,sameAs:brief.links.filter(l=>/^https:/.test(l.url)).map(l=>l.url)};
  const claims=brief.evidence?.claims.filter(c=>c.status==='verified')||[];
  const email=brief.links.find(l=>l.channel==='email'),phone=brief.links.find(l=>l.channel==='phone');
  if(email)data.email=email.url.slice(7);if(phone)data.telephone=phone.url.slice(4);
  const addresses=claims.filter(c=>c.kind==='address');
  if(addresses.length===1)data.address={'@type':'PostalAddress',streetAddress:addresses[0].original};
  const logo=brief.assets.find(a=>a.role==='logo')?.variants.find(v=>/\.(png|jpg|webp)$/.test(v.path));if(logo)data.logo=new URL(logo.path,url).href;
  return data;
}
export function finalizeSeo(files,brief,url) {
  must(/^https:\/\/[a-zA-Z0-9-]+\.github\.io\/[^/]+\/$/.test(url),'SEO_URL','URL Pages definitiva ausente.');
  const out={...files};
  const photo=brief.assets.find(a=>a.role==='hero')||brief.assets.find(a=>a.role!=='logo');
  const image=photo?.variants.filter(v=>v.mime==='image/jpeg'||v.mime==='image/png').sort((a,b)=>b.width-a.width)[0];
  for(const [file,bytes] of Object.entries(files).filter(([f])=>f.endsWith('.html'))) {
    const html=bytes.toString();
    // Never conceal a truncated Claude response by letting parse5 close missing tags.
    must(/^<!doctype html>/i.test(html.trim())&&/<\/html>\s*$/i.test(html)&&/<\/head>/i.test(html)&&/<\/body>/i.test(html),'HTML_INCOMPLETE','Documento incompleto; finalização SEO não pode reconstruí-lo.');
    const doc=parse(html),head=doc.childNodes.find(n=>n.tagName==='html')?.childNodes.find(n=>n.tagName==='head');must(head,'SEO_HEAD','Head ausente.');
    head.childNodes=head.childNodes.filter(n=>!(n.tagName==='title'||n.tagName==='link'&&attr(n,'rel')==='canonical'||n.tagName==='script'&&attr(n,'type')==='application/ld+json'||n.tagName==='meta'&&(attr(n,'name')==='description'||attr(n,'property')?.startsWith('og:')||attr(n,'http-equiv')?.toLowerCase()==='content-security-policy')));
    const canonical=file==='index.html'?url:new URL(file,url).href;
    const ld=JSON.stringify(structuredData(brief,url)).replaceAll('<','\\u003c');
    const additions=`<meta http-equiv="Content-Security-Policy" content="${esc(SITE_CSP)}"><title>${esc(brief.seo.title)}</title><meta name="description" content="${esc(brief.seo.description)}"><link rel="canonical" href="${esc(canonical)}"><meta property="og:type" content="website"><meta property="og:locale" content="pt_BR"><meta property="og:site_name" content="${esc(brief.business.name)}"><meta property="og:title" content="${esc(brief.seo.title)}"><meta property="og:description" content="${esc(brief.seo.description)}"><meta property="og:url" content="${esc(canonical)}">${image?`<meta property="og:image" content="${esc(new URL(image.path,url).href)}"><meta property="og:image:width" content="${image.width}"><meta property="og:image:height" content="${image.height}"><meta property="og:image:alt" content="${esc(photo.alt)}">`:''}<script type="application/ld+json">${ld}</script>`;
    for(const n of parseFragment(additions).childNodes){n.parentNode=head;head.childNodes.push(n);}
    out[file]=Buffer.from(serialize(doc));
  }
  return out;
}
