import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProfile } from '../src/images.mjs';
import { verifyFacts, confirmedLinks } from '../src/brief.mjs';
import { apifyContent, ensureBioCopy, missingBioContent } from '../src/apify-content.mjs';
const bio='Viva essa experiência\n📍R. Padre Anchieta, 1956 - Centro (Loja 1)\n📍Av. Distrito Federal, 950 - Vl. Aparecida (Loja 2)\n☎️ (16)99167-6818\n👇🏻Agende aqui';
const job={username:'barberclubfranca',profile:'https://www.instagram.com/barberclubfranca/'};
const profile={username:job.username,fullName:'Barber Club',biography:bio,externalUrl:'https://cashbarber.com.br/barbeariabarberclub'};
const posts=[{id:'1',ownerUsername:'colaborador',caption:'Nossa barbearia de Franca. Whats: (16)99167-6818',displayUrl:'https://example.com/photo.jpg'}];
const fixture=()=>normalizeProfile([profile],posts,job,40);
const facts=()=>({schemaVersion:'1.0',business:{name:'Outro nome',niche:'barbearia',subniche:'',tone:'',inferences:[],unknowns:[]},claims:[{id:'city',kind:'city',original:'Franca - SP',normalized:'Franca',quote:'Franca',sourceId:'post:1',status:'conflict',date:null},{id:'w',kind:'whatsapp',original:'(16)99167-6818',normalized:'',quote:'☎️ (16)99167-6818',sourceId:'profile:bio',status:'unknown',date:null}],limitations:[]});
test('perfil e colaboração preservados; sem checagem literal/canal/conflito ou oferta obrigatória',()=>{
 const pack=fixture();assert.equal(pack.posts,1);assert(pack.sources.some(s=>s.id==='post:1'));
 const f=verifyFacts(facts(),pack);assert(f.claims.every(c=>c.status==='verified'));assert.equal(f.business.name,'Barber Club');
 assert(f.claims.some(c=>c.original===bio));assert.deepEqual(verifyFacts(f,pack),f);
});
test('dois endereços aceitos e dados de bio não dependem do resumo Gemini',()=>{
 const f=facts();f.claims.push(...['Loja 1','Loja 2'].map((s,i)=>({id:'address'+i,kind:'address',original:s,normalized:s,sourceId:'profile:bio',quote:s,status:'conflict'})));
 const out=verifyFacts(f,fixture());assert.equal(out.claims.filter(c=>c.kind==='address'&&c.status==='verified').length,2);
 const copy=ensureBioCopy({sections:[],navigation:[],limitations:[]},fixture(),out);
 assert.deepEqual(copy.sections[0].paragraphs,bio.split('\n'));assert.deepEqual(ensureBioCopy(copy,fixture(),out),copy);
});
test('telefone local, WhatsApp BR configurado e agendamento são aproveitados',()=>{
 const pack=fixture(),links=confirmedLinks(verifyFacts(facts(),pack),pack,{defaultPhoneCountryCode:'55'});
 assert(links.some(l=>l.url==='tel:16991676818'));
 assert(links.some(l=>l.url==='https://wa.me/5516991676818'));
 assert(links.some(l=>l.url===profile.externalUrl&&l.label==='Agendar atendimento'));
});
test('links da bio redirecionados são decodificados; esquemas executáveis não viram links',()=>{
 const pack=fixture();pack.sources.push({id:'profile:biolink:1',text:'https://l.instagram.com/?u='+encodeURIComponent('https://example.com/reserva')});
 const f=facts();f.claims.push({id:'x',kind:'website',original:'javascript:alert(1)'});
 const links=confirmedLinks(f,pack);assert(links.some(l=>l.url==='https://example.com/reserva'));assert(!links.some(l=>l.url.startsWith('javascript:')));
});
test('cobertura requer bio e links no HTML; script e conteúdo escondido não contam',()=>{
 const pack=fixture(),brief={authoritativeContent:apifyContent(pack),links:[{url:profile.externalUrl,sourceId:'profile:external'}]};
 const html='<html><body>'+bio.split('\n').map(l=>'<p>'+l+'</p>').join('')+'<a href="'+profile.externalUrl+'">Agendar</a></body></html>';
 assert.deepEqual(missingBioContent({'index.html':Buffer.from(html)},brief),[]);
 assert(missingBioContent({'index.html':Buffer.from('<html><body><div hidden>'+bio+'</div><script>'+bio+'</script></body></html>')},brief).length>0);
});
test('texto fonte maior que 6000 caracteres não é cortado',()=>{
 const long='A'.repeat(6500)+' FINAL';const p=normalizeProfile([{...profile,biography:long}],[],job,40);
 assert.equal(p.sources.find(s=>s.id==='profile:bio').text,long);
});
test('retomada recupera fontes da coleta salva sem chamada Apify nem Claude',async()=>{
 const {Pipeline}=await import('../src/pipeline.mjs');
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const root=mkdtempSync(join(tmpdir(),'apify-resume-'));
 const data=new Map([['collection',{...fixture(),sources:[],assets:[]}],['apify:details:1:dataset',[profile]],['apify:posts:40:dataset',posts]]);
 const store={checkpoint(_id,key,value){if(arguments.length===3)data.set(key,value);return data.get(key);}};
 const config={postsLimit:40,maxCandidateImages:40,expandedCandidateImages:40,maxSiteImages:10,maxFinalists:10};
 const p={gemini:async task=>{assert.equal(task,'facts');return facts();},apify:()=>assert.fail('Apify não deve ser chamado'),claude:()=>assert.fail('Claude não deve ser chamado')};
 try {await new Pipeline(config,{},store,root,{createProviders:()=>p}).run('curate',{...job,id:'resume-test'});assert(data.get('facts').claims.some(c=>c.original===bio));assert(data.get('collection').sources.some(s=>s.id==='post:1'));}finally{rmSync(root,{recursive:true,force:true});}
});
