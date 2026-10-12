import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
let sequence=0;const randomUUID=()=>{const h=createHash('sha256').update('premium-v3:'+sequence++).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=existsSync(root+'CRIADOR_ Instagram para GitHub Pages (1).json')?root+'CRIADOR_ Instagram para GitHub Pages (1).json':existsSync(root+'workflow_instagram_site_premium.json')?root+'workflow_instagram_site_premium.json':fileURLToPath(new URL('../workflow_instagram_site_premium.json',import.meta.url));
const old=JSON.parse(readFileSync(source,'utf8'));
const telegram=old.nodes.find(n=>n.type==='n8n-nodes-base.telegramTrigger').credentials;
const nodes=[],connections={};
function add(name,type,parameters,x,y,extra={}) {nodes.push({parameters,id:randomUUID(),name,type:'n8n-nodes-base.'+type,typeVersion:({telegramTrigger:1.2,telegram:1.2,httpRequest:4.2,if:2.2,wait:1.1,code:2,stickyNote:1})[type],position:[x,y],...extra});return name;}
function link(from,to,branch=0){connections[from]||={main:[]};connections[from].main[branch]||=[];connections[from].main[branch].push({node:to,type:'main',index:0});}
function condition(name,expr,x,y){return add(name,'if',{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:randomUUID(),leftValue:expr,rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}},x,y);}
function http(name,url,method,x,y,body) {return add(name,'httpRequest',{method,url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',...(body?{sendBody:true,specifyBody:'json',jsonBody:body}:{}),options:{timeout:30000,response:{response:{responseFormat:'json',neverError:true}}}},x,y,{retryOnFail:false,onError:'continueRegularOutput',credentials:{httpHeaderAuth:{id:'CONFIGURE_WORKER_HEADER_AUTH',name:'Premium Worker — Authorization'}}});}
add('Telegram — receber perfil','telegramTrigger',{updates:['message'],additionalFields:{}},0,0,{credentials:telegram,webhookId:randomUUID()});
add('Contexto — um evento por execução','code',{jsCode:`if ($input.all().length !== 1) throw new Error('Esperado um evento Telegram por execução.');
const event = $input.item.json;
// Altere somente esta URL. n8n Cloud precisa de HTTPS acessível; localhost aponta para o próprio n8n.
const workerBaseUrl = 'http://host.docker.internal:8787';
return [{ json: { event, workerBaseUrl } }];`},240,0);
http('Worker — autorizar e recuperar job',"={{ $('Contexto — um evento por execução').item.json.workerBaseUrl + '/v1/jobs' }}",'POST',480,0,"={{ JSON.stringify($('Contexto — um evento por execução').item.json.event) }}");
condition('Trabalho autorizado?',"={{ $json.accepted === true && typeof $json.jobId === 'string' }}",720,0);
condition('Responder entrada inválida?',"={{ $json.notify === true && typeof $json.chatId === 'string' }}",960,340);
add('Telegram — entrada inválida','telegram',{chatId:'={{ $json.chatId }}',text:'={{ $json.message }}',additionalFields:{appendAttribution:false}},1200,340,{credentials:telegram});
link('Telegram — receber perfil','Contexto — um evento por execução');link('Contexto — um evento por execução','Worker — autorizar e recuperar job');link('Worker — autorizar e recuperar job','Trabalho autorizado?');link('Trabalho autorizado?','Responder entrada inválida?',1);link('Responder entrada inválida?','Telegram — entrada inválida');
const stages=[['preflight','Validar configuração e publicação'],['collect','Coletar e processar imagens'],['curate','Gemini — curadoria visual'],['brief','Gemini — direção, copy e briefing'],['generate','Claude — geração única protegida'],['audit','Gemini — auditoria renderizada'],['publish','GitHub — commit e Pages']];
let prev='Trabalho autorizado?';
for(const [i,[stage,label]]of stages.entries()) {
  const x=1020+i*1180,y=0;
  const start=http(label,"={{ $('Contexto — um evento por execução').item.json.workerBaseUrl + '/v1/jobs/' + $('Worker — autorizar e recuperar job').item.json.jobId + '/stages/"+stage+"' }}",'POST',x,y,'={{ {} }}');
  const normalize=add('Contexto '+stage,'code',{jsCode:`const raw = $input.item.json;
const job = $('Worker — autorizar e recuperar job').item.json;
return [{json: {...raw, jobId: job.jobId, chatId: job.chatId, stage: '${stage}', state: raw.state || 'failed', message: typeof raw.message === 'string' ? raw.message : 'Falha de comunicação com o worker. Use /retomar ' + job.jobId + ' após verificar a conexão.'}}];`},x+220,y);
  const fail=condition('Falhou '+stage+'?',"={{ $json.state === 'failed' || $json.state === 'interrupted' }}",x+440,y);
  const complete=condition('Concluiu '+stage+'?',"={{ $json.state === 'done' }}",x+650,y);
  const wait=add('Aguardar '+stage,'wait',{resume:'timeInterval',amount:10,unit:'seconds'},x+650,260,{webhookId:randomUUID()});
  const poll=http('Consultar '+stage,"={{ $('Contexto — um evento por execução').item.json.workerBaseUrl + '/v1/jobs/' + $('Worker — autorizar e recuperar job').item.json.jobId + '/stages/"+stage+"' }}",'GET',x+440,260);
  const notify=add('Progresso '+stage,'telegram',{chatId:"={{ $('Worker — autorizar e recuperar job').item.json.chatId }}",text:'={{ $json.message }}',additionalFields:{appendAttribution:false}},x, -240,{credentials:telegram,onError:'continueRegularOutput',retryOnFail:false});
  link(prev,start);link(start,normalize);link(start,notify);link(normalize,fail);link(fail,'Telegram — diagnóstico');link(fail,complete,1);link(complete,wait,1);link(wait,poll);link(poll,normalize);prev=complete;
}
add('Telegram — diagnóstico','telegram',{chatId:'={{ $json.chatId }}',text:"={{ 'Não foi possível concluir. Etapa: ' + $json.stage + '\\n' + $json.message + '\\nJob: ' + $json.jobId + '\\nRecuperação: /retomar ' + $json.jobId }}",additionalFields:{appendAttribution:false}},4400,600,{credentials:telegram,retryOnFail:false});
add('Telegram — resultado verificado','telegram',{chatId:'={{ $json.chatId }}',text:'={{ $json.message }}',additionalFields:{appendAttribution:false}},9500,0,{credentials:telegram,retryOnFail:false});link(prev,'Telegram — resultado verificado');
add('Leia antes de ativar','stickyNote',{content:'## Instagram → site verificado → GitHub Pages\nReferência: n8n 2.41.6; somente nós nativos. Configure URL no Contexto e credencial Header Auth Authorization: Bearer TOKEN. Worker completo na pasta instagram-site-premium. O único ponto Claude é o nó geração única protegida; o POST Anthropic ocorre no worker após reserva atômica SQLite. Não execute o workflow antigo com o mesmo bot. Use /retomar JOB para recuperação. Loops consultam status, nunca voltam à geração. Veja README antes de ativar.',height:280,width:900},0,-400);
nodes.find(n=>n.type==='n8n-nodes-base.stickyNote').parameters.content='## Versão 3 — identidade, recortes e qualidade visual\nFotografias reais do Apify. Gemini cura os pixels e aprova o briefing. Claude recebe fotos + manifesto e cria uma única vez; trava SQLite persiste entre retomadas. HTML/CSS/JS/SVG autorais, fontes locais e biblioteca opcional preparada. Auditoria normal + reduced motion em 320/390/768/1440, cenários de teclado/mouse/toque e patches delimitados. SEO finalizado antes do hash.\n\nInstale o worker 3.0 e o renderer conforme README. Configure URL do worker no nó Contexto, credencial Authorization: Bearer TOKEN e Telegram. JSON não é autossuficiente. Não deixe o fluxo antigo ativo com o mesmo bot. /retomar JOB recupera o trabalho sem repetir Claude. Ver VALIDACAO.md para testes e limitações desta entrega.';
nodes.find(n=>n.type==='n8n-nodes-base.stickyNote').parameters.height=420;
const workflow={id:'IGPremiumSingleClaudeV1',name:'Instagram → Site Premium v3 | fotos reais + criação única + revisão visual',nodes,connections,active:false,settings:{executionOrder:'v1',executionTimeout:4200,saveDataErrorExecution:'all',saveDataSuccessExecution:'none',saveExecutionProgress:true,timezone:'America/Sao_Paulo'},pinData:{},versionId:randomUUID(),tags:[]};
const output=JSON.stringify(workflow,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(new URL('../workflow_instagram_site_premium.json',import.meta.url),'utf8')!==output)throw Error('JSON exportado diverge do gerador.');process.stdout.write('Gerador e JSON idênticos.\n');process.exit(0);}
writeFileSync(root+'workflow_instagram_site_premium.json',output);
writeFileSync(new URL('../workflow_instagram_site_premium.json',import.meta.url),JSON.stringify(workflow,null,2)+'\n');
console.log(`Workflow gerado: ${nodes.length} nós.`);
