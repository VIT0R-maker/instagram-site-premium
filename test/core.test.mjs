import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { profileUrl, jobIdentity, hash, Fault } from '../src/core.mjs';
import { Store, invokeClaudeOnce } from '../src/store.mjs';
import { publicIP, allowedURL, retryDelay, api } from '../src/net.mjs';
import { normalizeProfile, decodeImage, processCandidates } from '../src/images.mjs';
import { verifyFacts, confirmedLinks, fixColors, contrast, installFonts } from '../src/brief.mjs';
import { validateSite, applyPatches } from '../src/validate-site.mjs';
import { sourceFixture, factsFixture, siteFixture, niches } from './fixtures.mjs';
import { Providers } from '../src/providers.mjs';
import { publicationPreflight } from '../src/publish.mjs';
const cfg=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
mkdirSync(new URL('../test-output/',import.meta.url),{recursive:true});
const temp=()=>mkdtempSync(path.resolve('test-output/unit-'));

test('URL exata: perfil canônico; rejeita posts, prefixos enganosos e localhost',()=>{
  assert.equal(profileUrl('https://www.instagram.com/Empresa_1/?igsh=abc').username,'empresa_1');
  for(const url of ['https://evilinstagram.com/abc','https://instagram.com.evil.test/abc','https://instagram.com/p/abc','http://instagram.com/abc','https://x@instagram.com/abc','https://127.0.0.1/abc'])assert.throws(()=>profileUrl(url));
});
test('jobId estável por mensagem; reentrega update diferente não cria novo job',()=>{
  assert.equal(jobIdentity('1','2','3','secret'),jobIdentity('1','2','3','secret'));
  assert.notEqual(jobIdentity('1','2','3','secret'),jobIdentity('1','2','4','secret'));
});
test('barreira concorrente: 40 tentativas, uma chamada real simulada; resposta recuperada',async()=>{
  const dir=temp(),s=new Store(dir);let calls=0;
  const send=async()=>{calls++;await new Promise(r=>setTimeout(r,15));return {text:'response',status:200,requestId:'request-1'};};
  const results=await Promise.allSettled(Array.from({length:40},()=>invokeClaudeOnce(s,'job',send)));
  assert.equal(calls,1);assert.equal(s.claude('job').calls,1);assert(results.some(r=>r.status==='fulfilled'));s.close();
  const restarted=new Store(dir);assert.equal((await invokeClaudeOnce(restarted,'job',send)).response,'response');assert.equal(calls,1);restarted.close();
});
test('reserva antes do envio e timeout ambíguo jamais liberam nova geração',async()=>{
  const s=new Store(temp());s.reserveClaude('crash');let calls=0;
  await assert.rejects(invokeClaudeOnce(s,'crash',async()=>{calls++;}),e=>e.code==='CLAUDE_AMBIGUOUS');assert.equal(calls,0);
  const send=async()=>{calls++;throw new Fault('HTTP_TIMEOUT','timeout');};
  await assert.rejects(invokeClaudeOnce(s,'timeout',send));await assert.rejects(invokeClaudeOnce(s,'timeout',send),e=>e.code==='CLAUDE_AMBIGUOUS');assert.equal(calls,1);s.close();
});
test('três nichos preservam evidências/identidade diferentes e mais de dez candidatos',()=>{
  for(let n=0;n<niches.length;n++){const f=sourceFixture(n),pack=normalizeProfile(f.details,f.posts,f.job,60);assert.equal(pack.candidates.length,60);assert.equal(verifyFacts(factsFixture(n),pack).business.niche,niches[n].niche);assert(pack.candidates.some(c=>c.carouselIndex===4));}
});
test('privado, inexistente, username divergente ou sem evidências falham cedo',()=>{
  const f=sourceFixture();assert.throws(()=>normalizeProfile([{...f.details[0],isPrivate:true}],f.posts,f.job,60));
  assert.throws(()=>normalizeProfile([],[],f.job,60));assert.throws(()=>normalizeProfile([{username:'other'}],[],f.job,60));
  assert.throws(()=>normalizeProfile([{username:f.job.username}],[],f.job,60));
});
test('não concatena números de evidências nem inventa WhatsApp ou DDI',()=>{
  const f=sourceFixture(),pack=normalizeProfile(f.details,f.posts,f.job,60),facts=factsFixture();
  assert.deepEqual(confirmedLinks(facts,pack).map(l=>l.id),['instagram']);
  facts.claims.push({id:'phone',kind:'phone',original:'11999998888',normalized:'11999998888',sourceId:'profile:bio',quote:'11999998888',status:'verified'});
  pack.sources.push({id:'one',text:'11 9999'},{id:'two',text:'98888'});assert.throws(()=>verifyFacts(facts,pack));
});
test('WhatsApp exige URL exata comprovada; conflito remove ambos',()=>{
  const f=sourceFixture(),pack=normalizeProfile(f.details,f.posts,f.job,60),facts=factsFixture();
  pack.sources.push({id:'profile:external',text:'https://wa.me/5511999998888'});assert(confirmedLinks(facts,pack).some(l=>l.id==='whatsapp'));
  pack.sources.push({id:'post:contradiction',text:'https://wa.me/5521999998888'});assert(!confirmedLinks(facts,pack).some(l=>l.id==='whatsapp'));
});
test('logo pequena é válida; HTML/corrupção rejeitados; vertical preservada',async()=>{
  const logo=await sharp({create:{width:64,height:64,channels:4,background:'#ff000088'}}).png().toBuffer();assert(logo.length<4000);assert.equal((await decodeImage(logo,cfg)).meta.width,64);
  const vertical=await sharp({create:{width:120,height:400,channels:3,background:'#aaaaaa'}}).jpeg().toBuffer();assert.equal((await decodeImage(vertical,cfg)).meta.height,400);
  await assert.rejects(decodeImage(Buffer.from('<html>expired</html>'),cfg));await assert.rejects(decodeImage(Buffer.from([0xff,0xd8,0x01]),cfg));
});
test('downloads parciais e duplicatas não trocam ID/legenda; hash deduplica',async()=>{
  const image=await sharp({create:{width:64,height:64,channels:3,background:'#888'}}).png().toBuffer();
  const f=sourceFixture(0,1),pack=normalizeProfile(f.details,f.posts,f.job,60);
  const result=await processCandidates(pack,temp(),cfg,null,async url=>{if(url.includes('0-0'))throw Error('expired');if(url.includes('0-1'))return Buffer.from('invalid');return image;});
  assert.equal(result.assets[1].status,'rejected');assert.equal(result.assets[2].status,'rejected');assert(result.assets.some(a=>a.status==='duplicate'));
  for(const a of result.assets)assert.equal(a.caption,pack.candidates.find(c=>c.assetId===a.assetId).caption);
});
test('SSRF: IPs privados, metadata, IPv4 mapeado e host semelhante bloqueados',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.17.0.1','192.168.0.1','::1','::ffff:127.0.0.1','fe80::1'])assert.equal(publicIP(ip),false,ip);
  assert(publicIP('8.8.8.8'));assert.throws(()=>allowedURL('https://api.github.com.evil.test/x',['api.github.com']));assert.throws(()=>allowedURL('http://api.github.com/x',['api.github.com']));
});
test('contraste corrigido e fontes locais com licença e acentos',()=>{
  const colors={background:'#fffafa',surface:'#f8f8f8',text:'#eeeeee',muted:'#cccccc',accent:'#fffaaa',onAccent:'#fffffe',border:'#dddddd',focus:'#fffafa'};
  const result=fixColors(colors);assert(contrast(result.colors.text,result.colors.background)>=4.5);assert(contrast(result.colors.onAccent,result.colors.accent)>=4.5);
  for(const pair of ['editorial','modern','technical']){const dir=temp(),fonts=installFonts(dir,pair);assert.equal(fonts.files.length,6);assert(fonts.files.some(f=>f.includes('latin-ext')));assert(existsSync(path.join(dir,'site',fonts.files[0])));}
});
test('contrato estático válido e hero tipográfico sem fallback para imagem rejeitada',()=>{
  const {files,brief,interactions}=siteFixture();assert(validateSite(files,brief,[],interactions).passed);assert.equal(brief.assets.length,0);
});
test('bloqueia execução inline, truncamento, caminho absoluto e contato inventado',()=>{
  const {files,brief,interactions}=siteFixture();for(const [from,to]of [
    ['</body>','<script>alert(1)</script></body>'],['</html>',''],['./styles.css','/styles.css'],
    ['href="https://www.instagram.com/atelier_ceramica/"','href="https://wa.me/5511000000000"']
  ])assert.throws(()=>validateSite({...files,'index.html':Buffer.from(files['index.html'].toString().replace(from,to))},brief,[],interactions));
});
test('patch exige hash/âncora exatos; rejeita reconstrução; aplica ajuste local',()=>{
  const {files}=siteFixture();const p={file:'styles.css',expectedHash:hash(files['styles.css']),find:'padding:70px 0',replace:'padding:72px 0',reason:'ritmo'};
  assert(applyPatches(files,[p])['styles.css'].toString().includes('padding:72px 0'));
  assert.throws(()=>applyPatches(files,[{...p,expectedHash:'wrong'}]));assert.throws(()=>applyPatches(files,[{...p,find:'missing'}]));assert.throws(()=>applyPatches(files,[{...p,find:files['styles.css'].toString()}]));
});
test('Gemini inválido/truncado é bloqueado; payload serializado e budget limitados',async()=>{
  const s=new Store(temp()),job={id:'g'},env={};
  let reason='MAX_TOKENS',text='{}';
  const p=new Providers(cfg,env,s,job,null,{api:async()=>({data:{candidates:[{finishReason:reason,content:{parts:[{text}]}}]}})});
  await assert.rejects(p.gemini('review',{}),e=>e.code==='GEMINI_STOP');reason='STOP';text='not JSON';await assert.rejects(p.gemini('review',{}),e=>e.code==='GEMINI_JSON');
  await assert.rejects(p.gemini('review',{data:'x'.repeat(cfg.geminiPayloadBytes)}),e=>e.code==='GEMINI_PAYLOAD');assert.equal(retryDelay('7',0),7000);assert(retryDelay(undefined,2)>=4000);s.close();
});
test('Nemotron desligado não chama endpoint; indisponível/JSON ruim não interrompe',async()=>{
  const s=new Store(temp());let calls=0;const transport={api:async()=>{calls++;throw Error('offline');}};
  let p=new Providers(cfg,{},s,{id:'n'},null,transport);assert.equal(await p.nemotron({}),null);assert.equal(calls,0);
  p=new Providers({...cfg,useNemotron:true},{},s,{id:'n'},null,transport);assert.equal(await p.nemotron({}),null);assert.equal(calls,1);s.close();
});
test('GitHub inválido falha antes da reserva Claude',async()=>{
  const s=new Store(temp());const p=new Providers(cfg,{},s,{id:'g'},null,{api:async()=>{throw new Fault('HTTP_401','Unauthorized');}});
  await assert.rejects(publicationPreflight(p));assert.equal(s.claude('g'),undefined);s.close();
});
test('Claude truncado ou JSON inválido fica persistido e nunca gera novamente',async()=>{
  const s=new Store(temp());let calls=0;s.checkpoint('c','models',{[cfg.claudeModel]:{id:cfg.claudeModel,max_tokens:64000,max_input_tokens:200000,capabilities:{image_input:{supported:true}}}});
  const p=new Providers(cfg,{},s,{id:'c'},null,{api:async()=>({data:{input_tokens:1000}}),request:async()=>{calls++;return {status:200,headers:{'request-id':'fixture'},text:JSON.stringify({stop_reason:'max_tokens',content:[{type:'text',text:'{"partial":'}]})};}});
  await assert.rejects(p.claude({}),e=>e.code==='CLAUDE_INCOMPLETE');await assert.rejects(p.claude({}),e=>e.code==='CLAUDE_INCOMPLETE');assert.equal(calls,1);assert(s.claude('c').response);s.close();
});
test('HTTP simulado: 429 respeita Retry-After; autenticação e mutação não repetem cegamente',async()=>{
  let calls=0;const waits=[];
  const result=await api('https://example.test', {method:'POST',attempts:3},async()=>++calls===1?{status:429,headers:{'retry-after':'7'}}:{status:200,headers:{},bytes:Buffer.from('{}'),text:'{}'},async ms=>waits.push(ms));
  assert.equal(calls,2);assert.equal(waits[0],7000);assert.deepEqual(result.data,{});
  calls=0;await assert.rejects(api('https://example.test',{attempts:3},async()=>{calls++;return {status:401,headers:{}};},async()=>{}));assert.equal(calls,1);
  calls=0;await assert.rejects(api('https://example.test',{method:'POST'},async()=>{calls++;return {status:503,headers:{}};},async()=>{}));assert.equal(calls,1);
});
