import { parse } from 'parse5';
import * as css from 'css-tree';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { must, hash, Fault } from './core.mjs';

export function listFiles(dir,prefix='') {
  return readdirSync(path.join(dir,prefix),{withFileTypes:true}).flatMap(e=>e.isDirectory()?listFiles(dir,prefix+e.name+'/'):[prefix+e.name]);
}
export function walk(node,fn) {fn(node);for(const child of node.childNodes||[])walk(child,fn);}
export function attr(node,name) {return node.attrs?.find(a=>a.name===name)?.value;}
function textOf(node){return node.nodeName==='#text'?node.value:(node.childNodes||[]).map(textOf).join(' ');}
const normalized=s=>String(s).normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
export function localRef(ref,files) {
  must(typeof ref==='string'&&ref.startsWith('./')&&!ref.includes('\\')&&!ref.includes('%')&&!ref.includes('?')&&!ref.includes('#'),'LOCAL_REFERENCE','Referência deve ser um arquivo relativo ./ sem query/fragmento.');
  const file=ref.slice(2); must(!file.split('/').includes('..')&&files.has(file),'BROKEN_REFERENCE','Arquivo referenciado não existe no pacote.'); return file;
}
export function validateSite(files,brief,secretValues=[]) {
  const html=files['index.html']?.toString(),styles=files['styles.css']?.toString();
  must(html&&styles,'SITE_INCOMPLETE','Projeto sem HTML/CSS completo.');
  must(hash(files['runtime.js']||'')===hash(readFileSync(new URL('./runtime.js',import.meta.url))),'RUNTIME_HASH','Runtime alterado: execução não autorizada.');
  must(/^<!doctype html>/i.test(html.trim())&&/<\/html>\s*$/i.test(html),'HTML_INCOMPLETE','HTML sem início/fim íntegros.');
  for(const [name,data]of Object.entries(files)) {
    must(!name.startsWith('.')||name==='.nojekyll','PUBLIC_FILE','Arquivo oculto não autorizado.');
    if(!/\.(?:html|css|js|md|txt|json)$/.test(name))continue;
    const s=data.toString();
    must(![...secretValues,brief.job?.id].filter(v=>typeof v==='string'&&v.length>=8).some(v=>s.includes(v))&&!/(?:sk-ant-|sk-proj-|ghp_|github_pat_|apify_api_)[A-Za-z0-9_-]{10,}/.test(s),'SECRET','Segredo/identificador privado detectado no artefato público.');
    must(!/cdninstagram\.com|fbcdn\.net|sourceUrl|request-id|ALLOWED_CHAT_IDS|JOB_HMAC_KEY/.test(s),'INTERNAL_DATA','Dado interno/CDN detectado no artefato público.');
  }
  const errors=[];const doc=parse(html,{sourceCodeLocationInfo:true,onParseError:e=>errors.push(e.code)});
  must(errors.length===0,'HTML_PARSE','HTML inválido: '+errors.slice(0,4).join(', '));
  const nodes=[];walk(doc,n=>{if(n.tagName)nodes.push(n);});
  const tags=new Set('html head body title meta link script header nav main section footer div span a h1 h2 h3 h4 h5 h6 p ul ol li dl dt dd strong em b i small br hr picture source img button'.split(' '));
  const ids=new Map(),existing=new Set(Object.keys(files));
  const paths=new Map(brief.assets.flatMap(a=>a.variants.map(v=>[v.path,a]))),links=new Map(brief.links.map(l=>[l.id,l]));
  const allowedText=[brief.business.name,brief.seo.title,brief.seo.description,...brief.sections.flatMap(s=>[s.heading,...s.paragraphs]),...brief.navigation.map(n=>n.label),...brief.links.map(l=>l.label),'Menu','Abrir menu','Fechar menu','Pular para o conteúdo','Voltar ao topo','Instagram',String(brief.technical?.year||new Date().getUTCFullYear())].map(normalized);
  walk(doc,n=>{if(n.nodeName==='#text'&&n.value.trim()&&n.parentNode?.tagName!=='script')must(allowedText.some(t=>t.includes(normalized(n.value))),'PUBLIC_COPY','Texto público fora da copy aprovada.');});
  const visible=[];let menuButtons=0,primary=0;
  for(const n of nodes) {
    must(tags.has(n.tagName),'HTML_TAG',`Elemento não autorizado: ${n.tagName}.`);
    const id=attr(n,'id');if(id){must(!ids.has(id),'DUPLICATE_ID','ID HTML repetido.');ids.set(id,n);}
    for(const a of n.attrs||[]) {
      must(!a.name.startsWith('on')&&!['style','srcdoc','ping','action','formaction','background','manifest','contenteditable','autofocus'].includes(a.name)&&!a.name.includes(':'),'HTML_ATTRIBUTE','Atributo executável ou fora da política.');
      if(['src','poster'].includes(a.name))localRef(a.value,existing);
      if(a.name==='srcset')for(const part of a.value.split(',')) {const [ref,descriptor,...rest]=part.trim().split(/\s+/);must(!rest.length&&/^\d+(?:\.\d+)?[wx]$/.test(descriptor),'SRCSET','srcset inválido.');localRef(ref,existing);}
    }
    if(n.tagName==='script')must(attr(n,'src')==='./runtime.js'&&attr(n,'defer')!==undefined&&!textOf(n).trim(),'SCRIPT','Somente runtime.js local e imutável é permitido.');
    if(n.tagName==='link'){must(attr(n,'rel')==='stylesheet'&&attr(n,'href')==='./styles.css','LINK_RESOURCE','Somente folha de estilos local é permitida.');}
    if(n.tagName==='meta') {
      must(!attr(n,'http-equiv'),'META_EXEC','Meta http-equiv fornecida pelo modelo é proibida.');
      const key=attr(n,'name')||attr(n,'property'),value=attr(n,'content');
      if(attr(n,'charset'))must(attr(n,'charset').toLowerCase()==='utf-8','META','Charset deve ser UTF-8.');
      else if(key==='viewport')must(/width=device-width/.test(value||'')&&!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(value||''),'VIEWPORT','Viewport restringe acessibilidade.');
      else if(['description','og:description'].includes(key))must(value===brief.seo.description,'META_COPY','Descrição não aprovada.');
      else if(key==='og:title')must(value===brief.seo.title,'META_COPY','Título social não aprovado.');
      else if(key==='og:type')must(value==='website','META','Tipo social inválido.');
      else if(key==='theme-color')must(Object.values(brief.brand.colors).includes(value),'META','Cor de tema não aprovada.');
      else throw new Fault('META','Metadado fora do contrato estático.');
    }
    if(n.tagName==='img') {
      const a=paths.get(localRef(attr(n,'src'),existing));must(a,'IMAGE_UNKNOWN','Imagem não aprovada.');
      must(attr(n,'alt')===a.alt,'IMAGE_ALT','Alt diferente do aprovado.');
      const v=a.variants.find(v=>'./'+v.path===attr(n,'src'));
      must(Number(attr(n,'width'))===v.width&&Number(attr(n,'height'))===v.height,'IMAGE_SIZE','Dimensões HTML incorretas.');
      if(a.role==='hero')must(attr(n,'fetchpriority')==='high'&&attr(n,'loading')!=='lazy','HERO_LOADING','Hero não prioritário.');
      else if(a.role!=='logo')must(attr(n,'loading')==='lazy','IMAGE_LOADING','Imagem fora do hero sem lazy loading.');
      visible.push(a.assetId);
      for(const p of (attr(n,'srcset')||'').split(',').filter(Boolean))must(paths.get(p.trim().split(/\s+/)[0].slice(2))?.assetId===a.assetId,'SRCSET_ASSET','srcset mistura assets.');
    }
    if(n.tagName==='button') {must(attr(n,'data-menu-toggle')!==undefined&&attr(n,'type')==='button'&&attr(n,'aria-controls')&&attr(n,'aria-expanded')==='false','BUTTON','Botão sem comportamento implementado.');menuButtons++;}
    if(n.tagName==='a') {
      const href=attr(n,'href');must(href&&href!=='#','ANCHOR','Link vazio.');
      if(!href.startsWith('#')) {
        const l=links.get(attr(n,'data-link-id'));must(l&&href===l.url&&normalized(textOf(n))===normalized(l.label),'CTA','Destino ou rótulo de CTA não corresponde ao canal comprovado.');
        if(attr(n,'data-primary-cta')!==undefined)primary++;
        if(attr(n,'target')==='_blank')must(/\bnoopener\b/.test(attr(n,'rel')||'')&&/\bnoreferrer\b/.test(attr(n,'rel')||''),'LINK_REL','Link externo sem proteção.');
      }
    }
  }
  must(nodes.filter(n=>n.tagName==='script').length===1 && nodes.filter(n=>n.tagName==='link').length===1,'RESOURCES','Projeto deve usar exatamente styles.css e runtime.js.');
  must(nodes.filter(n=>n.tagName==='h1').length===1&&nodes.some(n=>n.tagName==='html'&&attr(n,'lang')==='pt-BR'),'SEMANTICS','h1 único/idioma ausente.');
  must(nodes.some(n=>n.tagName==='main'&&attr(n,'id')==='main')&&nodes.some(n=>n.tagName==='a'&&attr(n,'href')==='#main'),'SKIP_LINK','Main/link de salto ausente.');
  must(menuButtons<=1&&primary>=1,'INTERACTION','Menu/CTA fora do contrato.');
  if(menuButtons) {const b=nodes.find(n=>n.tagName==='button'),nav=ids.get(attr(b,'aria-controls'));must(nav?.tagName==='nav'&&attr(nav,'data-menu')!==undefined,'MENU','Navegação controlada inexistente.');}
  for(const n of nodes.filter(n=>n.tagName==='a'))if(attr(n,'href').startsWith('#'))must(ids.has(attr(n,'href').slice(1)),'ANCHOR_TARGET','Âncora não existe.');
  must(new Set(visible).size===visible.length,'IMAGE_REPEATED','Mesma imagem repetida no site.');
  must(brief.assets.every(a=>visible.includes(a.assetId)),'IMAGE_MISSING','Asset aprovado ausente no HTML.');
  for(const sec of brief.sections) {
    const node=ids.get(sec.id);must(node,'SECTION_MISSING','Seção aprovada não foi implementada.');
    const allowed=[sec.heading,...sec.paragraphs, ...brief.links.map(l=>l.label),...brief.assets.filter(a=>sec.assetIds.includes(a.assetId)).map(a=>a.alt)];
    let remaining=normalized(textOf(node));
    for(const phrase of allowed.sort((a,b)=>b.length-a.length))if(normalized(phrase))remaining=remaining.split(normalized(phrase)).join(' ');
    must(!remaining.trim(),'COPY_CHANGED','Texto de seção difere da copy aprovada.');
  }
  must(textOf(nodes.find(n=>n.tagName==='title')).trim()===brief.seo.title,'SEO','Title alterado.');
  must(nodes.some(n=>n.tagName==='meta'&&attr(n,'name')==='description'&&attr(n,'content')===brief.seo.description),'SEO','Description alterada.');
  must(nodes.some(n=>n.tagName==='meta'&&attr(n,'name')==='viewport'),'VIEWPORT','Viewport ausente.');
  for(const n of nodes.filter(n=>['html','head','body'].includes(n.tagName)))must(n.sourceCodeLocation?.startTag&&n.sourceCodeLocation?.endTag,'HTML_INCOMPLETE','Estrutura HTML incompleta.');
  let ast;try{ast=css.parse(styles,{positions:true,onParseError:e=>{throw e;}});}catch{throw new Fault('CSS_PARSE','CSS inválido ou incompleto.');}
  must(!styles.includes('\\'),'CSS_ESCAPE','Escapes CSS não fazem parte do contrato de saída. Use caracteres Unicode literais.');
  css.walk(ast,node=>{
    if(node.type==='Atrule')must(!['import','namespace','document'].includes(node.name.toLowerCase()),'CSS_RULE','Regra CSS externa/fora da política.');
    if(node.type==='Url'){const file=localRef(node.value,existing);must(file.startsWith('assets/fonts/')&&file.endsWith('.woff2'),'CSS_ASSET','CSS pode carregar apenas fontes locais; fotos usam img/picture.');}
    if(node.type==='Function')must(!['image-set','-webkit-image-set','expression','paint','element','-moz-element'].includes(node.name.toLowerCase()),'CSS_FUNCTION','Função CSS fora da política.');
    if(node.type==='Declaration'&&node.property.toLowerCase()==='content')must(!/[\p{L}\p{N}]/u.test(css.generate(node.value).replace(/none|normal/g,'')),'CSS_COPY','CSS não pode introduzir texto comercial.');
  });
  must(styles.includes('prefers-reduced-motion')&&styles.includes(':focus-visible'),'ACCESSIBILITY_CSS','Foco visível/redução de movimento ausentes.');
  return {passed:true,fileHashes:Object.fromEntries(Object.entries(files).map(([p,b])=>[p,hash(b)])),images:visible.length};
}
export function applyPatches(files,patches) {
  const original={...files},out={...files};const changed={};
  for(const patch of patches) {
    must(['index.html','styles.css'].includes(patch.file)&&hash(original[patch.file])===patch.expectedHash,'PATCH_HASH','Patch não corresponde à versão auditada.');
    const current=out[patch.file].toString();
    must(patch.find&&current.split(patch.find).length===2,'PATCH_ANCHOR','Âncora do patch não é única/exata.');
    changed[patch.file]=(changed[patch.file]||0)+Math.max(patch.find.length,patch.replace.length);
    must(changed[patch.file]<=Math.max(400,original[patch.file].length*.15)&&patch.find.length<current.length*.4,'PATCH_SCOPE','Patch exige reconstrução ampla; publicação bloqueada.');
    out[patch.file]=Buffer.from(current.replace(patch.find,()=>patch.replace));
  }
  return out;
}
