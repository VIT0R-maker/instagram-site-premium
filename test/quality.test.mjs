import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hash, atomic } from '../src/core.mjs';
import { Store } from '../src/store.mjs';
import { Providers } from '../src/providers.mjs';
import { schemas, validate } from '../src/contracts.mjs';
import { diagnoseSite, validateSite, applyPatches, localRef, safePublicPath } from '../src/validate-site.mjs';
import { FONT_CATALOG, installFonts, installLibrary, verifyResources } from '../src/resources.mjs';
import { verifyFacts, confirmedLinks, validateBrief } from '../src/brief.mjs';
import { claudeReferences } from '../src/vision.mjs';
import { finalizeSeo, structuredData } from '../src/seo.mjs';
import { auditProject, progressEvidence } from '../src/audit.mjs';
import { validateConfig } from '../src/server.mjs';
import { Pipeline } from '../src/pipeline.mjs';
import { siteFixture, sourceFixture, factsFixture } from './fixtures.mjs';
import { visualFixture } from './visual-fixture.mjs';
import { normalizeProfile } from '../src/images.mjs';
const cfg=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
mkdirSync('test-output',{recursive:true});const temp=()=>mkdtempSync(path.resolve('test-output/quality-'));
const model={id:cfg.claudeModel,max_tokens:64000,max_input_tokens:200000,capabilities:{image_input:{supported:true}}};
const envelope=x=>({schemaVersion:'2.0',files:Object.entries(x.files).filter(([f])=>/\.(html|css|js|svg)$/.test(f)).map(([path,b])=>({path,content:b.toString()})),interactions:x.interactions});
const rubric=n=>Object.fromEntries(['identity','composition','spacing','typography','images','responsiveness'].map(k=>[k,n]));
const review=(score,more={})=>({score,rubric:rubric(score),semanticReview:{approved:true,unsupportedClaims:[],equivalentCopy:[]},observedImprovements:[],issues:[],patches:[],...more});

test('configuração remove imagens IA; limites de visão e rodadas são validados',()=>{
  assert.equal(validateConfig(cfg),cfg);assert(!Object.hasOwn(cfg,'enableAiDecorativeImages'));assert(!Object.hasOwn(cfg,'geminiImageModel'));
  assert.throws(()=>validateConfig({...cfg,schemaVersion:'1.0'}));assert.throws(()=>validateConfig({...cfg,claudeRequestBytes:40000000}));assert.throws(()=>validateConfig({...cfg,maxAuditRounds:100}));
});
test('produtos e outras ofertas verificadas são válidos; website e loja têm canais distintos',()=>{
  const f=sourceFixture(),pack=normalizeProfile(f.details,f.posts,f.job,60),facts=factsFixture();
  facts.claims[0].kind='product';assert.equal(verifyFacts(facts,pack).claims[0].kind,'product');facts.claims[0].kind='offer';verifyFacts(facts,pack);
  for(const [kind,url] of [['website','https://example.org/sobre'],['shop','https://shop.example.org/colecao']]){pack.sources.push({id:kind,text:url});facts.claims.push({id:kind,kind,sourceId:kind,original:url,normalized:url,quote:url,date:null,status:'verified'});}
  const links=confirmedLinks(verifyFacts(facts,pack),pack);assert.equal(links.find(l=>l.channel==='website').label,'Visitar o site');assert.equal(links.find(l=>l.channel==='shop').label,'Acessar a loja');assert.equal(links[0].label,'Ver perfil no Instagram');
});
test('vinte famílias preparadas com licença, acentos e pesos; biblioteca é opcional e fixada',()=>{
  verifyResources();assert.equal(Object.keys(FONT_CATALOG).length,20);
  for(const name of Object.keys(FONT_CATALOG)){const fonts=installFonts(temp(),{heading:name,body:name});assert.equal(fonts.files.length,FONT_CATALOG[name].styles.length*2+1);assert(fonts.css.includes('unicode-range'));assert(fonts.css.includes(FONT_CATALOG[name].weights));}
  assert.equal(installLibrary(temp(),'native').files.length,0);assert.throws(()=>installLibrary(temp(),'unknown','anything'));assert.throws(()=>installLibrary(temp(),'animejs','curto'));
  const lib=installLibrary(temp(),'animejs','Timeline de múltiplos elementos sincronizados.');assert.equal(lib.version,'3.2.2');assert(lib.hashes['lib/anime.min.js']);
});
test('contrato aceita múltiplos HTML/CSS/JS/SVG; rejeita caminhos reservados e travessia',()=>{
  const x=visualFixture();assert(validate('files',envelope(x)));assert(!safePublicPath('../escape.js'));assert(!safePublicPath('C:/data.js'));assert(!safePublicPath('.env'));assert(!safePublicPath('con.js'));
  for(const p of ['../escape.js','/root.js','assets/fake.svg','lib/injected.js'])assert.throws(()=>validate('files',{...envelope(x),files:[...envelope(x).files,{path:p,content:'complete'}]}));
  assert.equal(localRef('../styles.css',new Set(['styles.css']),'css/page.css'),'styles.css');assert.throws(()=>localRef('../../../secret.css',new Set(['styles.css']),'css/page.css'));
});
test('SVG, JS autoral, backgrounds e reuso funcional passam; dimensões erradas viram diagnóstico reparável',()=>{
  const x=visualFixture();assert(validateSite(x.files,x.brief,[],x.interactions).passed);
  const files={...x.files,'index.html':Buffer.from(x.files['index.html'].toString().replace('width="1928"','width="999"'))};
  const r=diagnoseSite(files,x.brief,[],x.interactions);assert(!r.passed);assert(r.safeToRender);assert(r.issues.some(i=>i.code==='IMAGE_DIMENSIONS'));assert(!r.fatal);
});
test('escapes CSS e imports locais são aceitos; SVG externo/script e JS incompleto exigem reparo antes do browser',()=>{
  const x=visualFixture(),files={...x.files,'styles.css':Buffer.concat([x.files['styles.css'],Buffer.from('.\\31 23{color:#28231e}@import url("./extra.css");')]),'extra.css':Buffer.from('body{--fixture:1}')};
  assert(validateSite(files,x.brief,[],x.interactions).passed);
  for(const [file,content] of [['icons/expand.svg','<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],['js/gallery.js','const x = {']]){const r=diagnoseSite({...x.files,[file]:Buffer.from(content)},x.brief,[],x.interactions);assert(!r.safeToRender);assert(!r.fatal);}
});
test('segredo ou resposta incompleta é fatal; microcopy equivalente segue para revisão semântica',()=>{
  const x=siteFixture();let files={...x.files,'index.html':Buffer.from(x.files['index.html'].toString().replace('</html>',''))};assert(diagnoseSite(files,x.brief,[],x.interactions).fatal);
  files={...x.files,'js/secret.js':Buffer.from('const bad="fixture-api-secret-123456789"')};assert(diagnoseSite(files,x.brief,['fixture-api-secret-123456789'],x.interactions).fatal);
  files={...x.files,'index.html':Buffer.from(x.files['index.html'].toString().replace('Vamos conversar','Conheça mais detalhes'))};const r=diagnoseSite(files,x.brief,[],x.interactions);assert(r.passed);assert(r.semanticReviewRequired);assert(r.copy.some(c=>c.text==='Conheça mais detalhes'));
});
test('SEO finalizado antes do hash é idempotente, usa URL final e Organization factual',()=>{
  const x=visualFixture(),first=finalizeSeo(x.files,x.brief,x.brief.publication.url),second=finalizeSeo(first,x.brief,x.brief.publication.url);
  assert.equal(hash(first['index.html']),hash(second['index.html']));const html=first['index.html'].toString();assert(html.includes('rel="canonical"'));assert(html.includes('og:image'));assert(html.includes('application/ld+json'));assert(!html.includes('LocalBusiness'));
  const ld=structuredData(x.brief,x.brief.publication.url);assert.equal(ld.url,x.brief.publication.url);assert(!ld.address);assert(!ld.aggregateRating);
  assert(html.indexOf('Content-Security-Policy')<html.indexOf('<script src='));
});
test('referências visuais preservam assetId/hash, usam pixels e acompanham a única geração',async()=>{
  const dir=temp(),store=new Store(dir),x=visualFixture(),photo=x.files['assets/fixture-jomon.jpg'];
  atomic(path.join(dir,'originals','photo'),photo);const pack={assets:[{...x.brief.assets[0],status:'downloaded',originalPath:'originals/photo'}]};
  const refs=await claudeReferences(x.brief,pack,dir,cfg);assert.equal(refs.length,1);assert(refs[0].bytes.length>10000);assert(refs[0].width<=1280);assert.equal(refs[0].sourceHash,hash(photo));
  let generations=0,counts=0,request;
  store.checkpoint('job','models',{[cfg.claudeModel]:model});
  const p=new Providers(cfg,{},store,{id:'job'},null,{api:async(url,o)=>{assert(url.endsWith('/count_tokens'));counts++;assert(o.body.messages[0].content.some(b=>b.type==='image'));return {data:{input_tokens:4000}};},request:async(url,o)=>{assert(url.endsWith('/messages'));generations++;request=o.body;return {status:200,headers:{},text:JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(envelope(x))}]})};}});
  await p.claude(x.brief,refs);await p.claude(x.brief,[]);assert.equal(generations,1);assert.equal(counts,1);assert(request.messages[0].content.some(b=>b.type==='text'&&b.text.includes('fixture_jomon')));assert(request.messages[0].content.some(b=>b.type==='image'&&b.source.type==='base64'));store.close();
});
test('visão ausente, imagens omitidas e contexto insuficiente falham antes da reserva',async()=>{
  const s=new Store(temp()),x=visualFixture(),p=new Providers(cfg,{},s,{id:'job'},null,{api:async()=>({data:{input_tokens:190000}}),request:async()=>{throw Error('Não deve gerar');}});
  await assert.rejects(p.claude(x.brief,[]),e=>e.code==='MODEL_VISION');s.checkpoint('job','models',{[cfg.claudeModel]:model});await assert.rejects(p.claude(x.brief,[]),e=>e.code==='CLAUDE_IMAGE_IDS');
  await assert.rejects(p.claude({...x.brief,assets:[]},[]),e=>e.code==='CLAUDE_CONTEXT');assert(!s.claude('job'));s.close();
});
test('patch JS/SVG usa versão e âncora exata; não permite alterar assets preparados',()=>{
  const x=visualFixture(),file='js/gallery.js',p={file,expectedHash:hash(x.files[file]),find:"dialog.showModal()",replace:"dialog.showModal();closer.focus()",reason:'foco'};
  assert(applyPatches(x.files,[p])[file].toString().includes('closer.focus'));assert.throws(()=>applyPatches(x.files,[{...p,expectedHash:'wrong'}]));assert.throws(()=>applyPatches(x.files,[{...p,file:'assets/fixture-jomon.jpg'}]));
});
test('queda pequena de nota não reverte correção comprovada',()=>{
  const p=progressEvidence({score:94,technical:['overflow']},{score:92,technical:[],observedImprovements:[]});assert(p.progress);assert.deepEqual(p.regressions,[]);assert.equal(p.scoreDelta,-2);
});

function auditHarness(x=temp()) {
  const store=new Store(x),job={id:'audit-fixture-job',repo:'site-fixture-subpath'};
  return {store,dir:x,job,cp:(k,v)=>v===undefined?store.checkpoint(job.id,k):store.checkpoint(job.id,k,v),save:(k,v)=>{store.checkpoint(job.id,k,v);return v;}};
}
test('diagnóstico repair-first chega ao Gemini; patch JS revalida e renderiza sem regeneração',async()=>{
  const x=siteFixture(),h=auditHarness();let renders=0,reviews=0;const valid='const example={ready:true};',invalid='const example={ready:true;';
  const files={...x.files,'js/check.js':Buffer.from(invalid+'\n// '+'.'.repeat(100))};
  const result=await auditProject({...h,files,brief:x.brief,interactions:x.interactions,config:cfg,p:{env:{},gemini:async(_t,payload)=>{
    reviews++;if(reviews===1){assert.equal(payload.mode,'repair-first');assert(payload.diagnostics.issues.some(i=>i.code==='JS_PARSE'));return review(70,{patches:[{file:'js/check.js',expectedHash:payload.fileHashes['js/check.js'],find:invalid,replace:valid,reason:'Sintaxe local'}]});}
    return review(90,{observedImprovements:['Sintaxe JS corrigida e browser executado.']});
  }},render:async()=>{renders++;return {passed:true,engine:'mock Chromium',tests:[],screenshots:[]};}});
  assert(result.approved);assert.equal(reviews,2);assert.equal(renders,1);assert(!h.store.claude(h.job.id));h.store.close();
});
test('afirmação comercial sem fonte bloqueia publicação mesmo com navegador verde',async()=>{
  const x=siteFixture(),h=auditHarness();let calls=0;
  const args={...h,files:x.files,brief:x.brief,interactions:x.interactions,config:cfg,p:{env:{},gemini:async()=>{calls++;return review(95,{semanticReview:{approved:false,unsupportedClaims:[{text:'Garantia de dez anos',reason:'Sem evidência'}],equivalentCopy:[]}});}},render:async()=>({passed:true,tests:[],screenshots:[]})};
  await assert.rejects(auditProject(args),e=>e.code==='AUDIT_REJECTED');await assert.rejects(auditProject(args),e=>e.code==='AUDIT_REJECTED');assert.equal(calls,1);assert(!h.cp('approval'));h.store.close();
});
test('fracionar reconstrução em patches pequenos não contorna o limite de preservação',()=>{
  const files={'small.js':Buffer.from('A'.repeat(90)+'B'.repeat(90)+'C'.repeat(90))},expectedHash=hash(files['small.js']);
  assert.throws(()=>applyPatches(files,[{file:'small.js',expectedHash,find:'A'.repeat(90),replace:'X'},{file:'small.js',expectedHash,find:'B'.repeat(90),replace:'Y'}]),e=>e.code==='PATCH_SCOPE');
});
test('coleta expandida reinterpreta fatos com as novas fontes textuais',async()=>{
  const root=temp(),store=new Store(root),f=sourceFixture(0,1),initial=normalizeProfile(f.details,[],f.job,1);initial.assets=[];store.checkpoint(f.job.id,'collection',initial);const factsInputs=[];
  const provider={apify:async kind=>kind==='details'?f.details:f.posts,gemini:async(task,payload)=>{
    if(task==='facts'){factsInputs.push(payload.sources);return factsFixture();}
    if(task==='batch')return {images:payload.images.map(a=>({assetId:a.assetId,roles:['reject'],quality:10,protectedBox:[0,0,1,1]}))};
    throw Error(task);
  }};
  const pipeline=new Pipeline({...cfg,maxCandidateImages:1,expandedCandidateImages:2},{},store,root,{createProviders:()=>provider,fetchImage:async()=>readFileSync(new URL('./assets/jomon-cc0.jpg',import.meta.url))});
  await pipeline.run('curate',f.job);assert.equal(factsInputs.length,2);assert(!factsInputs[0].some(s=>s.id.startsWith('post:')));assert(factsInputs[1].some(s=>s.id.startsWith('post:')));assert(store.checkpoint(f.job.id,'facts'));store.close();
});
