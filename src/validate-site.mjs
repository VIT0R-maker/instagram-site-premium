import { parse, parseFragment } from 'parse5';
import * as css from 'css-tree';
import { parse as parseJS } from 'acorn';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { must, hash, Fault } from './core.mjs';
import { SITE_CSP, structuredData } from './seo.mjs';

export function listFiles(dir,prefix='') {return readdirSync(path.join(dir,prefix),{withFileTypes:true}).flatMap(e=>e.isDirectory()?listFiles(dir,prefix+e.name+'/'):[prefix+e.name]);}
export function walk(n,fn){fn(n);for(const c of n.childNodes||[])walk(c,fn);if(n.content)walk(n.content,fn);}
export function attr(n,name){return n.attrs?.find(a=>a.name===name)?.value;}
function textOf(n){return n?.nodeName==='#text'?n.value:(n?.childNodes||[]).map(textOf).join(' ');}
export function safePublicPath(name) {return name==='.nojekyll'||/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(html|css|js|svg|woff2|avif|webp|jpg|jpeg|png|txt|md)$/.test(name)&&!name.split('/').some(p=>p==='.'||p==='..'||/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p));}
export function localRef(ref,files,from='index.html') {
  must(typeof ref==='string'&&ref&&!/^(?:[a-z][\w+.-]*:|\/)/i.test(ref)&&!/[\\%\x00-\x20]/.test(ref),'LOCAL_REFERENCE','Recurso deve usar caminho relativo local, sem origem externa ou codificação ambígua.');
  const [pathname]=ref.split(/[?#]/),file=path.posix.normalize(path.posix.join(path.posix.dirname(from),pathname||path.posix.basename(from)));
  must(safePublicPath(file)&&files.has(file),'BROKEN_REFERENCE','Referência local não existe no pacote: '+ref);return file;
}
export function fileHashes(files){return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([p,b])=>[p,hash(b)]));}

// Static checks collect repairable diagnostics, not a template or a literal copy whitelist.
export function diagnoseSite(files,brief,secretValues=[],interactions=[]) {
  const issues=[],existing=new Set(Object.keys(files)),used=new Set(),copy=[],backgrounds=[];
  const paths=new Map((brief.assets||[]).flatMap(a=>a.variants.map(v=>[v.path,{asset:a,variant:v}])));
  const add=(code,message,file,category='renderable',component='')=>issues.push({code,message,file,category,component});
  const check=(ok,...args)=>{if(!ok)add(...args);return !!ok;};
  const reference=(ref,from,category='renderable')=>{try{return localRef(ref,existing,from);}catch(e){add(e.code,e.message,from,category,ref||'');return null;}};
  for(const [file,bytes] of Object.entries(files)) {
    if(!check(safePublicPath(file),'PUBLIC_PATH','Caminho público inválido.',file,'fatal'))continue;
    if(!/\.(html|css|js|svg|md|txt)$/.test(file))continue;
    const s=bytes.toString();
    check(![...secretValues,brief.job?.id].filter(v=>typeof v==='string'&&v.length>=8).some(v=>s.includes(v))&&!/(?:sk-ant-|sk-proj-|ghp_|github_pat_|apify_api_)[A-Za-z0-9_-]{10,}/.test(s),'SECRET','Credencial/identificador privado no artefato.',file,'fatal');
    check(!/https?:[^\s"'<>]*(?:cdninstagram\.com|fbcdn\.net)/i.test(s),'PRIVATE_CDN','URL temporária de coleta no site público.',file,'repair-first');
  }
  check(!!files['index.html'],'SITE_INCOMPLETE','index.html ausente.','index.html','fatal');
  check(Object.keys(files).some(f=>f.endsWith('.css')),'SITE_INCOMPLETE','Nenhuma folha de estilos entregue.','index.html','fatal');
  const prepared={...(brief.brand?.typography?.hashes||{}),...(brief.resources?.hashes||{})};
  for(const [f,{variant}] of paths)if(files[f])check(!variant.sha256||hash(files[f])===variant.sha256,'ASSET_HASH','Foto diferente da aprovada.',f,'fatal');
  for(const [f,h] of Object.entries(prepared))check(files[f]&&hash(files[f])===h,'RESOURCE_HASH','Recurso licenciado alterado/ausente.',f,'fatal');
  for(const f of Object.keys(files)) {
    if(/\.(jpg|jpeg|png|webp|avif)$/.test(f))check(paths.has(f),'IMAGE_UNKNOWN','Raster não aprovado pela curadoria.',f,'fatal');
    if(f.startsWith('lib/')||f.endsWith('.woff2'))check(Object.hasOwn(prepared,f),'RESOURCE_UNKNOWN','Dependência não preparada.',f,'fatal');
  }
  function inspectCss(source,file,inline=false) {
    let ast;try{ast=css.parse(source,{context:inline?'declarationList':'stylesheet',onParseError:e=>{throw e;}});}catch(e){add('CSS_PARSE',e.message,file,'repair-first');return;}
    css.walk(ast,n=>{
      if(n.type==='Url') {
        if(n.value.startsWith('#'))return;
        const f=reference(css.ident.decode(n.value),file);
        if(paths.has(f)){used.add(paths.get(f).asset.assetId);backgrounds.push({file,path:f,assetId:paths.get(f).asset.assetId});}
      }
      if(n.type==='Atrule'&&n.name.toLowerCase()==='import'&&n.prelude)css.walk(n.prelude,v=>{if(v.type==='String')reference(v.value,file,'repair-first');});
      if(n.type==='Function'&&/^(?:-webkit-)?image-set$/i.test(n.name))css.walk(n,v=>{if(v.type==='String'){const f=reference(v.value,file);if(paths.has(f)){used.add(paths.get(f).asset.assetId);backgrounds.push({file,path:f,assetId:paths.get(f).asset.assetId});}}});
      if(n.type==='Declaration'&&n.property==='content')copy.push({file,kind:'css-content',text:css.generate(n.value)});
    });
  }
  for(const [file,bytes] of Object.entries(files)) {
    const content=bytes.toString();
    if(file.endsWith('.css'))inspectCss(content,file);
    if(file.endsWith('.js')&&!file.startsWith('lib/')) {
      let ast;try{ast=parseJS(content,{ecmaVersion:'latest',sourceType:'module'});}catch(e){add('JS_PARSE',e.message,file,'repair-first');continue;}
      const visit=n=>{
        if(!n||typeof n!=='object')return;
        if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(n.type)&&n.source) {
          if(n.source.type==='Literal'&&typeof n.source.value==='string')reference(n.source.value,file,'repair-first');else add('JS_DYNAMIC_IMPORT','Import deve apontar para módulo local explícito.',file,'repair-first');
        }
        if(n.type==='CallExpression'&&n.callee?.type==='Identifier'&&n.callee.name==='eval'||n.type==='NewExpression'&&n.callee?.name==='Function')add('JS_DYNAMIC_CODE','Execução dinâmica não é necessária; entregue JavaScript auditável.',file,'repair-first');
        if(n.type==='Literal'&&typeof n.value==='string'&&/^(https?:|mailto:|tel:)/.test(n.value))check(brief.links.some(l=>l.url===n.value)||n.value==='http://www.w3.org/2000/svg','JS_EXTERNAL','Destino em JavaScript não consta dos links aprovados.',file,'repair-first');
        for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);
      };visit(ast);
    }
    if(!/\.(html|svg)$/.test(file))continue;
    const isHtml=file.endsWith('.html'),parseErrors=[];
    if(isHtml)check(/^<!doctype html>/i.test(content.trim())&&/<\/html>\s*$/i.test(content)&&/<\/head>/i.test(content)&&/<\/body>/i.test(content),'HTML_INCOMPLETE','Estrutura incompleta; não reconstruir resposta truncada.',file,'fatal');
    if(!isHtml)check(/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(content)&&/<\/svg>\s*$/.test(content),'SVG_INCOMPLETE','SVG incompleto.',file,'repair-first');
    const doc=isHtml?parse(content,{onParseError:e=>parseErrors.push(e.code)}):parseFragment(content.replace(/^\s*<\?xml[^>]*>/,''));
    for(const error of parseErrors)add('HTML_PARSE',error,file);
    const nodes=[];walk(doc,n=>{if(n.tagName)nodes.push(n);});const ids=new Map();
    for(const n of nodes) {
      const tag=n.tagName.toLowerCase(),id=attr(n,'id');
      if(id){check(!ids.has(id),'DUPLICATE_ID','ID repetido.',file,'renderable',id);ids.set(id,n);}
      check(!['iframe','object','embed','base'].includes(tag),'ACTIVE_EMBED','Recurso ativo externo não pertence ao site estático.',file,'repair-first',tag);
      if(tag==='script') {
        if(attr(n,'type')==='application/ld+json') {
          try{check(hash(JSON.parse(textOf(n)))===hash(structuredData(brief,brief.publication?.url)),'JSONLD','Dados estruturados divergentes da evidência.',file);}catch{add('JSONLD','JSON-LD inválido.',file);}
        }else {check(isHtml&&!!attr(n,'src')&&!textOf(n).trim(),'SCRIPT_INLINE','Entregue script autoral em arquivo local; SVG não pode executar scripts.',file,'repair-first');if(attr(n,'src'))reference(attr(n,'src'),file,'repair-first');}
      }
      for(const a of n.attrs||[]) {
        check(!/^on/i.test(a.name)&&!['srcdoc','ping'].includes(a.name),'EXEC_ATTRIBUTE','Evento inline/recurso ativo não auditável; use JS local.',file,'repair-first',tag);
        if(a.name==='style')inspectCss(a.value,file,true);
        if(['src','poster'].includes(a.name))reference(a.value,file);
        if(a.name==='srcset')for(const part of a.value.split(','))reference(part.trim().split(/\s+/)[0],file);
        if(a.name==='href'&&n.namespaceURI==='http://www.w3.org/2000/svg'&&!a.value.startsWith('#'))reference(a.value,file,'repair-first');
        if(/url\(/i.test(a.value)&&a.name!=='style')inspectCss(`x{fill:${a.value}}`,file);
      }
      if(tag==='style')inspectCss(textOf(n),file);
      if(tag==='link') {
        if(attr(n,'rel')==='canonical'){if(brief.publication?.url)check(attr(n,'href')===(file==='index.html'?brief.publication.url:new URL(file,brief.publication.url).href),'CANONICAL','Canonical diferente da URL final.',file);}
        else reference(attr(n,'href'),file);
      }
      if(tag==='meta'&&attr(n,'http-equiv'))check(attr(n,'http-equiv').toLowerCase()==='content-security-policy'&&attr(n,'content')===SITE_CSP,'META_EXEC','Meta executável fora da política.',file,'repair-first');
      if(tag==='img') {
        const f=reference(attr(n,'src'),file),entry=paths.get(f);
        if(entry){used.add(entry.asset.assetId);check(attr(n,'alt')!==undefined,'IMAGE_ALT','Imagem sem alternativa semântica.',file,'renderable',f);check(Number(attr(n,'width'))===entry.variant.width&&Number(attr(n,'height'))===entry.variant.height,'IMAGE_DIMENSIONS','Dimensões intrínsecas incorretas.',file,'renderable',f);}
        else check(f?.endsWith('.svg'),'IMAGE_UNKNOWN','Imagem fora do manifesto.',file,'renderable',f||'');
      }
      if(tag==='a') {
        const href=attr(n,'href')||'';check(href&&href!=='#','ANCHOR','Link vazio.',file);
        if(/^(?:https?:|mailto:|tel:)/.test(href)) {
          const approved=brief.links.find(l=>l.url===href);check(approved,'CTA','Contato/destino não comprovado.',file,'repair-first',href);
          if(approved&&attr(n,'data-link-id'))check(approved.id===attr(n,'data-link-id'),'CTA_ID','Identificador de destino incorreto.',file);
          copy.push({file,kind:'link',text:textOf(n),channel:approved?.channel,destination:href});
        }else if(href&&!href.startsWith('#'))reference(href,file);
        if(attr(n,'target')==='_blank')check(/\bnoopener\b/.test(attr(n,'rel')||''),'LINK_REL','Link em nova aba sem noopener.',file);
      }
      if(tag==='button'||attr(n,'role')==='button') {
        const testId=attr(n,'data-interaction');check(testId&&interactions.some(t=>t.id===testId),'INTERACTION_TEST','Controle autoral sem cenário de teste declarado.',file,'renderable',id||tag);
      }
      if(attr(n,'data-asset-id')) {
        const asset=brief.assets.find(a=>a.assetId===attr(n,'data-asset-id'));check(asset,'IMAGE_ID','ID de fundo/recorte desconhecido.',file);
        if(asset){used.add(asset.assetId);check(attr(n,'aria-hidden')==='true'||!!attr(n,'aria-label')||!!textOf(n).trim(),'BACKGROUND_ALT','Foto informativa precisa de alternativa semântica; decorativa deve ser aria-hidden.',file,'renderable',asset.assetId);}
      }
    }
    for(const n of nodes)if(attr(n,'href')?.startsWith('#')&&attr(n,'href')!=='#')check(ids.has(attr(n,'href').slice(1)),'ANCHOR_TARGET','Âncora inexistente.',file,'renderable',attr(n,'href'));
    if(isHtml) {
      check(nodes.filter(n=>n.tagName==='h1').length===1,'SEMANTICS','A página precisa de um h1.',file);
      check(nodes.some(n=>n.tagName==='html'&&attr(n,'lang')==='pt-BR'),'LANG','Idioma ausente.',file);
      check(nodes.some(n=>n.tagName==='main'&&attr(n,'id')==='main')&&nodes.some(n=>attr(n,'href')==='#main'),'SKIP_LINK','Link de salto/main ausente.',file);
      check(nodes.some(n=>attr(n,'name')==='viewport'&&/width=device-width/.test(attr(n,'content')||'')),'VIEWPORT','Viewport responsivo ausente.',file);
      check(nodes.some(n=>attr(n,'data-primary-cta')!==undefined),'CTA_MISSING','CTA principal não identificado.',file);
      if(brief.publication?.url){check(nodes.some(n=>attr(n,'rel')==='canonical'),'CANONICAL','Canonical ausente.',file);check(nodes.some(n=>attr(n,'property')==='og:url'),'OPEN_GRAPH','Open Graph ausente.',file);}
      walk(doc,n=>{if(n.nodeName==='#text'&&n.value.trim()&&!['script','style'].includes(n.parentNode?.tagName))copy.push({file,kind:'text',text:n.value.trim()});});
    }
  }
  const htmls=Object.entries(files).filter(([f])=>f.endsWith('.html')).map(([,b])=>b.toString());
  for(const b of backgrounds)check(htmls.some(s=>s.includes(`data-asset-id="${b.assetId}"`)||s.includes(`data-asset-id='${b.assetId}'`)),'BACKGROUND_SEMANTICS','Identifique a fotografia CSS com data-asset-id e alternativa semântica.',b.file,'renderable',b.assetId);
  for(const a of brief.assets||[])check(used.has(a.assetId),'IMAGE_MISSING','Asset selecionado não utilizado.','index.html','renderable',a.assetId);
  for(const t of interactions){check(t.minWidth<=t.maxWidth,'INTERACTION_RANGE','Intervalo de interação inválido.','interactions');check(new Set(t.paths.map(p=>p.input)).size===3,'INTERACTION_INPUTS','Declare teclado, mouse e toque para a interação implementada.','interactions','renderable',t.id);}
  return {passed:issues.length===0,safeToRender:!issues.some(i=>i.category!=='renderable'),fatal:issues.some(i=>i.category==='fatal'),issues,fileHashes:fileHashes(files),images:used.size,copy,backgrounds,semanticReviewRequired:true};
}
export function validateSite(files,brief,secrets=[],interactions=[]) {
  const r=diagnoseSite(files,brief,secrets,interactions);if(!r.passed)throw new Fault(r.issues[0].code,r.issues[0].message,{issues:r.issues});return r;
}
export function applyPatches(files,patches,config={}) {
  const original={...files},out={...files},changed={};
  for(const p of patches) {
    must(safePublicPath(p.file)&&/\.(html|css|js|svg)$/.test(p.file)&&!/^assets\/|^lib\//.test(p.file)&&original[p.file]&&hash(original[p.file])===p.expectedHash,'PATCH_HASH','Patch não corresponde à versão/arquivo autoral auditado.');
    const current=out[p.file].toString();must(p.find&&p.find!==p.replace&&current.split(p.find).length===2,'PATCH_ANCHOR','Âncora deve ser única, exata e alterar conteúdo.');
    changed[p.file]=(changed[p.file]||0)+Math.max(Buffer.byteLength(p.find),Buffer.byteLength(p.replace));
    must(changed[p.file]<=Math.max(500,original[p.file].length*(config.maxPatchFraction||.25))&&p.find.length<current.length*.5,'PATCH_SCOPE','Correção exige reconstrução ampla; publicação bloqueada.');
    out[p.file]=Buffer.from(current.replace(p.find,()=>p.replace));
  }
  return out;
}
