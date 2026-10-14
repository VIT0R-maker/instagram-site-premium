import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync } from 'node:fs';
import path from 'node:path';
import { cropFit,planCrops,observedCrop } from '../src/crops.mjs';
import { chooseFinalists,normalizeSelection } from '../src/curation.mjs';
import { repairDependencies,chooseDirection,buildBrief } from '../src/briefing.mjs';
import { reviewRendered,repairManifest } from '../src/audit-review.mjs';
import { parseClaudeSse } from '../src/claude-stream.mjs';
import { Store,invokeClaudeOnce } from '../src/store.mjs';
import { resumeJob } from '../src/resume.mjs';
import { Providers } from '../src/providers.mjs';
import { hash,atomic,STAGES } from '../src/core.mjs';
import { auditProject } from '../src/audit.mjs';
import { diagnoseSite } from '../src/validate-site.mjs';
import { siteFixture,menuInteraction,factsFixture,sourceFixture } from './fixtures.mjs';
import { visualFixture } from './visual-fixture.mjs';
import { normalizeProfile } from '../src/images.mjs';
const cfg=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
mkdirSync('test-output',{recursive:true});const temp=()=>mkdtempSync(path.resolve('test-output/integration-'));
const asset=(id,role='gallery',quality=80)=>({assetId:id,postId:id,status:'downloaded',origin:role==='logo'?'profile':'post',visual:{assetId:id,roles:[role],quality}});
const choice=(a,priority='recommended')=>({assetId:a.assetId,role:a.visual.roles[0],priority,reason:'Contexto comprovado',componentRatioDesktop:'3:2',componentRatioMobile:'native',cutRestrictions:'Preservar assunto'});
const selection=assets=>({heroMode:assets.some(a=>a.visual.roles.includes('hero'))?'photo':'typographic',assets:assets.map(a=>choice(a)),identity:{logoAssetId:assets.find(a=>a.visual.roles.includes('logo'))?.assetId||null},limitations:[]});
const scores=n=>Object.fromEntries(['identity','composition','spacing','typography','images','responsiveness'].map(k=>[k,n]));
test('reduz onze recursos para dez sem esvaziar galeria; preserva logo e essenciais',()=>{
  const candidates=[asset('logo','logo',20),asset('hero','hero'),...Array.from({length:9},(_,i)=>asset('g'+i))];const raw=selection(candidates);raw.assets[2].priority='essential';const result=normalizeSelection(raw,candidates,10);
  assert.equal(result.assets.length,10);assert.equal(result.assets.filter(a=>a.role==='gallery').length,8);for(const id of ['logo','hero','g0'])assert(result.assets.some(a=>a.assetId===id));
  assert.throws(()=>normalizeSelection(raw,candidates,2),e=>e.code==='SELECTION_ESSENTIAL');
});
test('logo institucional não perde para nota fotográfica; rejeitada não retorna',()=>{
  const logo=asset('logo','logo',10),bad=asset('bad','reject',99),candidates=[...Array.from({length:15},(_,i)=>asset('g'+i)),bad,logo];const finalists=chooseFinalists(candidates,5);assert(finalists.includes(logo));assert(!finalists.includes(bad));assert.throws(()=>normalizeSelection({heroMode:'typographic',assets:[{...choice(bad),role:'gallery'}],identity:{logoAssetId:null},limitations:[]},candidates,5));
});
test('crop ajusta ponto focal sem cortar assunto e distingue mobile/desktop',()=>{
  const image={width:2000,height:1000},box=[.7,.2,.2,.4],fit=cropFit(image,box,1,[.5,.5]);assert(fit.fits);assert(fit.adjusted);assert.equal(cropFit(image,[0,0,1,1],.8).fits,false);
  const plan=planCrops({...image,visual:{focalDesktop:[.8,.5],focalMobile:[.7,.5],protectedBox:box,protectedElements:['produto']}},{componentRatioDesktop:'2:1',componentRatioMobile:'1:1'});assert.equal(plan.desktop.suggestedAspect,2);assert.equal(plan.mobile.suggestedAspect,1);assert(plan.mobile.fits);
  assert.equal(observedCrop({...image,assetId:'a',protectedBox:box},{bounds:{width:500,height:500},objectFit:'cover',objectPosition:'0% 50%'}).fits,false);
});
test('recursos opcionais não são obrigatórios no DOM; logo essencial continua exigida',()=>{
  const x=visualFixture(),brief=structuredClone(x.brief),extra={...brief.assets[0],assetId:'optional-unused',priority:'optional',variants:[]};brief.assets.push(extra);assert(!diagnoseSite(x.files,brief,[],x.interactions).issues.some(i=>i.code==='IMAGE_MISSING'));extra.role='logo';assert(diagnoseSite(x.files,brief,[],x.interactions).issues.some(i=>i.code==='IMAGE_MISSING'));
});
const directions=()=>({acceptable:true,chosenId:'b',reason:'Compatibilidade com acervo',directions:['a','b','c'].map((id,i)=>({id,grid:'grid '+i,desktopHero:'composição '+i,textImageRelation:'ritmo '+i,typography:'escala '+i,fonts:{heading:'lora',body:'dm-sans'},library:'native',libraryReason:'APIs nativas',motion:'entrada discreta'}))});
test('escolha inválida é reavaliada com pixels; não usa primeira direção',async()=>{
  let n=0;const answer=await chooseDirection({gemini:async(_t,_p,images)=>{assert.equal(images.length,1);const d=directions();if(n++===0)d.chosenId='inexistente';return d;}},{business:'fixture'},[{assetId:'pixel'}]);assert.equal(n,2);assert.equal(answer.chosenId,'b');
  await assert.rejects(chooseDirection({gemini:async()=>({...directions(),chosenId:'inexistente'})},{},[]),e=>e.code==='DIRECTION_REJECTED');
});
test('revisão de fontes refaz direção/copy, preservando coleta e fatos; seções variáveis',async()=>{
  assert.deepEqual([...repairDependencies(['links'])].sort(),['copy','links']);const dir=temp(),map=new Map([['preflight',{owner:'fixture'}]]),cp=(k,v)=>v===undefined?map.get(k):(map.set(k,v),v),save=(k,v)=>cp(k,v),src=sourceFixture(),pack=normalizeProfile(src.details,src.posts,src.job,5);pack.assets=[];
  const x=siteFixture(),calls=[],p={nemotron:async()=>null,gemini:async(task,payload)=>{calls.push(task);if(task==='directions')return directions();if(task==='copy')return {sections:[{id:'colecao',purpose:'oferta',heading:'Coleção',paragraphs:['Peças em cerâmica feitas à mão'],claimIds:['service-1'],assetIds:[],ctaLinkId:'instagram'}],navigation:[{label:'Coleção',sectionId:'colecao'}],seo:x.brief.seo,limitations:[]};if(task==='review'){assert(payload.brief.evidence.sources.length);return {approved:calls.filter(t=>t==='review').length>1,repairTargets:['fonts'],issues:[],reason:'Refinar combinação tipográfica'};}throw Error(task);}};
  const brief=await buildBrief({p,pack,facts:factsFixture(),selection:{heroMode:'typographic',assets:[],identity:{colors:x.brief.brand.colors},limitations:[]},dir,cfg,job:src.job,cp,save});assert.equal(brief.sections[0].id,'colecao');assert.equal(calls.filter(t=>t==='directions').length,2);assert(!calls.includes('facts'));assert(!calls.includes('selection'));
});
test('auditoria dividida cobre todas as faixas; defeito no último lote impede aprovação alta',async()=>{
  const shots=Array.from({length:7},(_,i)=>({label:'faixa '+i,bytes:Buffer.alloc(200)})),seen=[],p={gemini:async(task,payload)=>{if(task==='auditPart'){seen.push(...payload.captures.map(s=>s.label));return {coverageIds:payload.captures.map(s=>s.coverageId),score:95,rubric:scores(95),issues:payload.part===3?[{severity:'high',component:'rodapé',evidence:'Texto invisível',viewport:'320',description:'Contraste',fix:'Ajustar cor'}]:[],observations:[]};}return {score:95,rubric:scores(95),issues:[],patches:[],semanticReview:{approved:true,unsupportedClaims:[]}};}};
  const out=await reviewRendered(p,{brief:{},tests:[]},shots,{...cfg,auditBatchImages:3});assert.equal(seen.length,7);assert(out.issues.some(i=>i.component==='rodapé'));assert.equal(out.coverage.allReviewed,true);
});
test('manifesto aceita corrigir seletor, sem apagar fechamento, tecla ou expectativa',()=>{
  const old=structuredClone(menuInteraction),paths=structuredClone(old.paths);paths[0].steps[0].selector='#menu-real';const r={id:old.id,reason:'Seletor anterior divergente do ID presente no HTML auditado.',expectedHash:hash(old),paths};assert.equal(repairManifest([old],[r])[0].paths[0].steps[0].selector,'#menu-real');r.paths[0].steps.pop();assert.throws(()=>repairManifest([old],[r]),e=>e.code==='MANIFEST_OBLIGATION');
});
const event=(type,data={})=>`event: ${type}\r\ndata: ${JSON.stringify({type,...data})}\r\n\r\n`;
const stream=()=>event('message_start',{message:{model:'fixture',usage:{input_tokens:1}}})+event('content_block_start',{index:0,content_block:{type:'text',text:''}})+event('content_block_delta',{index:0,delta:{type:'text_delta',text:'{"complete":true}'}})+event('content_block_stop',{index:0})+event('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:9}})+event('message_stop');
test('stream completo é inequívoco; erro explícito e encerramento parcial nunca passam',()=>{
  assert.equal(parseClaudeSse(stream()).content[0].text,'{"complete":true}');assert.throws(()=>parseClaudeSse(stream().replace(event('message_stop'),'')),e=>e.code==='CLAUDE_INCOMPLETE');assert.throws(()=>parseClaudeSse(stream()+event('error',{error:{message:'overloaded'}})),e=>e.code==='CLAUDE_STREAM_ERROR');
});
test('erro de stream persistido nunca autoriza segunda geração',async()=>{
  const store=new Store(temp());let calls=0;const response=await invokeClaudeOnce(store,'job',async()=>{calls++;return {status:200,text:stream()+event('error'),requestId:'mock'};});assert.throws(()=>parseClaudeSse(response.response));await invokeClaudeOnce(store,'job',async()=>{calls++;throw Error();});assert.equal(calls,1);store.close();
});
test('Gemini recupera JSON uma vez; preserva schema e não chama Claude',async()=>{
  const store=new Store(temp());let calls=0;const p=new Providers(cfg,{},store,{id:'job'},null,{api:async()=>({data:{candidates:[{finishReason:'STOP',content:{parts:[{text:++calls===1?'JSON inválido':JSON.stringify({approved:true,repairTargets:[],issues:[],reason:'Completo'})}]}}]}})});assert((await p.gemini('review',{evidence:[]})).approved);assert.equal(calls,2);assert(!store.claude('job'));store.close();
});
test('retomada restaura somente primeira etapa pendente, mantém geração e renova polling',async()=>{
  const store=new Store(temp()),job={id:'job',chat:'1'};for(const s of STAGES.slice(0,6)){store.claimStage(job.id,s);store.finish(job.id,s,'done',{});}await invokeClaudeOnce(store,job.id,async()=>({text:'persistido',status:200}));store.claimStage(job.id,'publish');store.finish(job.id,'publish','failed',{code:'PAGES_PENDING'});
  assert.equal(resumeJob(store,job,'1',cfg).stage,'publish');assert.equal(store.stage(job.id,'publish').state,'interrupted');assert(store.claimStage(job.id,'publish'));assert.equal(store.stage(job.id,'generate').state,'done');assert.equal(store.claude(job.id).calls,1);assert.throws(()=>resumeJob(store,job,'2',cfg),e=>e.code==='JOB_OWNER');store.close();
});
test('retomada de geração recupera resposta recebida; ambiguidade permanece bloqueada',async()=>{
  const store=new Store(temp()),job={id:'job',chat:'1'};for(const s of STAGES.slice(0,4)){store.claimStage(job.id,s);store.finish(job.id,s,'done',{});}store.claimStage(job.id,'generate');store.finish(job.id,'generate','failed',{});store.reserveClaude(job.id);assert.throws(()=>resumeJob(store,job,'1',cfg),e=>e.code==='CLAUDE_AMBIGUOUS');store.saveClaude(job.id,'resposta completa',200,'mock');assert.equal(resumeJob(store,job,'1',cfg).stage,'generate');let sends=0;assert.equal((await invokeClaudeOnce(store,job.id,async()=>{sends++;})).response,'resposta completa');assert.equal(sends,0);store.close();
});
test('nota baixa permite patch e reavaliação; severidade high vira relatório com média alta',async()=>{
  const dir=temp(),store=new Store(dir),x=siteFixture(),job={id:'quality',repo:'fixture'},cp=(k,v)=>v===undefined?store.checkpoint(job.id,k):store.checkpoint(job.id,k,v),save=(k,v)=>cp(k,v);x.brief.publication={url:'https://fixture.github.io/fixture/'};let calls=0,renders=0;
  const answer=n=>({score:n,rubric:scores(n),semanticReview:{approved:true,unsupportedClaims:[],equivalentCopy:[]},observedImprovements:n>=90?['Espaçamento corrigido no mesmo artefato']:[],issues:[],patches:[]});
  const p={env:{},gemini:async(_t,payload)=>{calls++;const r=answer(calls===1?80:92);if(calls===1)r.patches=[{file:'styles.css',expectedHash:payload.fileHashes['styles.css'],find:'margin:0;',replace:'margin:0;--reviewed-spacing:1;',reason:'Ajuste local de fixture'}];return r;}};
  const render=async()=>{renders++;return {passed:true,tests:[],screenshots:[],engine:'mock'};};
  assert((await auditProject({files:x.files,brief:x.brief,interactions:x.interactions,config:cfg,p,dir,job,cp,save,render})).approved);assert.equal(renders,2);assert.equal(calls,2);store.close();
  const map=new Map(),cp2=(k,v)=>v===undefined?map.get(k):(map.set(k,v),v),save2=(k,v)=>cp2(k,v);const p2={env:{},gemini:async()=>({...answer(97),issues:[{severity:'high',component:'hero',description:'Texto ilegível',evidence:'Foto cobre o título',viewport:'320',fix:'Corrigir contraste'}]})};
  assert((await auditProject({files:x.files,brief:x.brief,interactions:x.interactions,config:cfg,p:p2,dir:temp(),job,cp:cp2,save:save2,render})).approved);assert(map.get('auditNotes').includes('Texto ilegível'));
});
test('queda do processo recupera estágio, sem liberar reserva enviada',()=>{
  const dir=temp(),job={id:'crash',chat:'1'};let store=new Store(dir);for(const s of STAGES.slice(0,4)){store.claimStage(job.id,s);store.finish(job.id,s,'done',{});}store.claimStage(job.id,'generate');store.reserveClaude(job.id);store.sentClaude(job.id);store.close();store=new Store(dir);store.recover();assert.equal(store.stage(job.id,'generate').state,'interrupted');assert.throws(()=>resumeJob(store,job,'1',cfg),e=>e.code==='CLAUDE_AMBIGUOUS');assert.equal(store.claude(job.id).calls,1);store.close();
});

