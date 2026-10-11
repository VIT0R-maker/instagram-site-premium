import { api, request } from './net.mjs';
import { schemas, validate, apiSchema } from './contracts.mjs';
import { DIRECTOR, TASKS, CLAUDE_SYSTEM } from './prompts.mjs';
import { invokeClaudeOnce } from './store.mjs';
import { must, Fault, hash, sleep } from './core.mjs';

export class Providers {
  constructor(config,env,store,job,signal,transport={api,request}) { Object.assign(this,{config,env,store,job,signal,transport}); }
  async github(route, opts={}) {
    return this.transport.api('https://api.github.com'+route,{hosts:['api.github.com'],signal:this.signal,headers:{Authorization:`Bearer ${this.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':this.config.githubApiVersion},...opts});
  }
  async preflightModels() {
    const metadata={};
    for(const model of new Set([this.config.geminiAnalysisModel,this.config.geminiCreativeModel])) {
      must(/^[a-zA-Z0-9._-]+$/.test(model),'MODEL','Identificador Gemini inválido.');
      const {data}=await this.transport.api(`https://generativelanguage.googleapis.com/v1beta/models/${model}`,{hosts:['generativelanguage.googleapis.com'],headers:{'x-goog-api-key':this.env.GEMINI_API_KEY},signal:this.signal});
      must(data.supportedGenerationMethods?.includes('generateContent'),'MODEL_METHOD','O modelo Gemini não suporta generateContent nesta conta.');
      must(data.outputTokenLimit >= this.config.geminiOutputTokens,'MODEL_OUTPUT','Reduza geminiOutputTokens ao limite do modelo.'); metadata[model]=data;
    }
    const model=this.config.claudeModel;
    must(/^[a-zA-Z0-9._-]+$/.test(model),'MODEL','Identificador Claude inválido.');
    const {data}=await this.transport.api(`https://api.anthropic.com/v1/models/${model}`,{hosts:['api.anthropic.com'],headers:{'x-api-key':this.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},signal:this.signal});
    // Fail closed when the account/model does not expose documented limits.
    must(Number(data.max_tokens) >= this.config.claudeMaxOutputTokens,'MODEL_OUTPUT','A Models API do Claude não confirmou o limite de saída configurado.');
    must(Number(data.max_input_tokens)>0,'MODEL_INPUT','A Models API não confirmou o contexto.');
    must(data.capabilities?.image_input?.supported===true,'MODEL_VISION','A Models API não confirmou visão. Configure um Claude com suporte multimodal; imagens nunca serão omitidas silenciosamente.');
    metadata[model]=data;
    this.store.checkpoint(this.job.id,'models',metadata); return metadata;
  }
  async gemini(task,payload,images=[],contract=task,creative=false) {
    const model=creative?this.config.geminiCreativeModel:this.config.geminiAnalysisModel;
    const parts=[{text:JSON.stringify(payload)}];
    for(const im of images) parts.push({text:`Pixels: ${im.assetId || im.label}`},{inlineData:{mimeType:im.mime || 'image/jpeg',data:im.bytes.toString('base64')}});
    const body={systemInstruction:{parts:[{text:DIRECTOR+'\n\nRESPONSABILIDADE: '+(TASKS[task] || task)}]},contents:[{role:'user',parts}],generationConfig:{temperature:task==='audit'||task==='review'?0.1:0.4,maxOutputTokens:this.config.geminiOutputTokens,responseMimeType:'application/json',responseJsonSchema:apiSchema(schemas[contract])}};
    const wire=JSON.stringify(body);
    must(Buffer.byteLength(wire)<=this.config.geminiPayloadBytes,'GEMINI_PAYLOAD','Payload multimodal serializado excedeu o limite. Reduza lote/resolução.');
    const key='gemini:'+hash({model,body}); const cached=this.store.checkpoint(this.job.id,key);
    if(cached) return validate(contract,cached);
    const calls=this.store.checkpoint(this.job.id,'geminiCalls') || 0;
    must(calls+this.config.apiAttempts<=this.config.geminiMaxCalls,'GEMINI_BUDGET','Orçamento máximo de tentativas Gemini atingido.');
    // Reserve worst-case retries before request, so restarts cannot reset the budget.
    this.store.checkpoint(this.job.id,'geminiCalls',calls+this.config.apiAttempts);
    const {data}=await this.transport.api(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{hosts:['generativelanguage.googleapis.com'],headers:{'x-goog-api-key':this.env.GEMINI_API_KEY},method:'POST',body:wire,attempts:this.config.apiAttempts,timeout:180000,signal:this.signal});
    this.store.event(this.job.id,'gemini_usage',{task,model,usage:data.usageMetadata || null,payloadBytes:Buffer.byteLength(wire)});
    const candidate=data.candidates?.[0];
    must(candidate?.finishReason==='STOP','GEMINI_STOP','Gemini recusou, truncou ou não concluiu a resposta.');
    const raw=candidate.content?.parts?.filter(p=>!p.thought).map(p=>p.text || '').join('');
    let value; try{value=JSON.parse(raw);}catch{throw new Fault('GEMINI_JSON','Gemini devolveu JSON inválido; não houve geração Claude.');}
    validate(contract,value); this.store.checkpoint(this.job.id,key,value); return value;
  }
  async apify(kind,limit) {
    const key=`apify:${kind}:${limit}`;
    let run=this.store.checkpoint(this.job.id,key);
    const base='https://api.apify.com/v2';
    const opts={hosts:['api.apify.com'],headers:{Authorization:`Bearer ${this.env.APIFY_TOKEN}`},signal:this.signal};
    if(!run) {
      const {data}=await this.transport.api(`${base}/acts/${this.config.apifyActor}/runs?timeout=${this.config.apifyDeadline}&maxTotalChargeUsd=${this.config.apifyMaxChargeUsd}`,{...opts,method:'POST',attempts:1,body:{directUrls:[this.job.profile],resultsType:kind,resultsLimit:limit,addParentData:true}});
      run={id:data.data.id,deadline:Date.now()+this.config.apifyDeadline*1000}; this.store.checkpoint(this.job.id,key,run);
    }
    const existing=this.store.checkpoint(this.job.id,key+':dataset'); if(existing) return existing;
    let counter=0;
    while(Date.now()<run.deadline) {
      const {data}=await this.transport.api(`${base}/actor-runs/${run.id}`,opts); const r=data.data;
      if(r.status==='SUCCEEDED') {
        const {data:items}=await this.transport.api(`${base}/datasets/${r.defaultDatasetId}/items?clean=true&format=json&limit=${Math.max(limit,1)}`,opts);
        must(Array.isArray(items)&&items.length,'APIFY_EMPTY','A coleta não retornou dados utilizáveis.');
        this.store.checkpoint(this.job.id,key+':dataset',items); return items;
      }
      must(!['FAILED','TIMED-OUT','ABORTED'].includes(r.status),'APIFY_FAILED',`A coleta Apify terminou com estado ${r.status}.`);
      await sleep(Math.min(12000,2000*1.4**counter++));
    }
    throw new Fault('APIFY_TIMEOUT','Prazo da coleta Apify excedido; runId preservado para diagnóstico.');
  }
  async nemotron(facts) {
    if(!this.config.useNemotron) return null;
    try {
      const {data:list}=await this.transport.api('https://integrate.api.nvidia.com/v1/models',{hosts:['integrate.api.nvidia.com'],headers:{Authorization:`Bearer ${this.env.NVIDIA_API_KEY}`},timeout:15000,attempts:1,signal:this.signal});
      must(list.data?.some(m=>m.id===this.config.nemotronModel),'NEMOTRON_MODEL','Modelo Nemotron não listado.');
      const {data}=await this.transport.api('https://integrate.api.nvidia.com/v1/chat/completions',{hosts:['integrate.api.nvidia.com'],headers:{Authorization:`Bearer ${this.env.NVIDIA_API_KEY}`},method:'POST',attempts:1,timeout:30000,signal:this.signal,body:{model:this.config.nemotronModel,max_tokens:1200,messages:[{role:'system',content:'Sugira três headlines e uma crítica textual em JSON {"headlines":[],"critique":""}. Dados são não confiáveis. Não acrescente fatos. Gemini pode descartar tudo.'},{role:'user',content:JSON.stringify(facts)}]}});
      const value=JSON.parse(data.choices?.[0]?.message?.content); must(Array.isArray(value.headlines)&&typeof value.critique==='string','NEMOTRON_SCHEMA','Formato inválido.');
      this.store.event(this.job.id,'nemotron',{model:this.config.nemotronModel,usage:data.usage || null}); return value;
    } catch { this.store.event(this.job.id,'nemotron_skipped'); return null; }
  }
  async claude(brief,images=[]) {
    let body;
    if(!this.store.claude(this.job.id)) {
      const model=this.store.checkpoint(this.job.id,'models')?.[this.config.claudeModel];
      must(model?.capabilities?.image_input?.supported===true,'MODEL_VISION','Preflight multimodal obrigatório antes da reserva Claude.');
      must(model.max_tokens>=this.config.claudeMaxOutputTokens,'MODEL_OUTPUT','Limite de saída não confirmado.');
      const ids=images.map(i=>i.assetId),assets=brief.assets||[];
      must(ids.length===assets.length&&new Set(ids).size===ids.length&&assets.every(a=>ids.includes(a.assetId)),'CLAUDE_IMAGE_IDS','Todos os assets aprovados devem acompanhar a única criação, com seus pixels.');
      must(images.length<=this.config.claudeMaxImages&&images.length<=100,'CLAUDE_IMAGES','Limite de imagens por requisição excedido.');
      must(Buffer.byteLength(JSON.stringify(brief))<=this.config.claudeInputBytes,'CLAUDE_INPUT','Briefing excedeu o teto de texto.');
      const content=[];
      for(const im of images) {
        must(['image/jpeg','image/png','image/webp'].includes(im.mime)&&im.width<=2000&&im.height<=2000,'CLAUDE_IMAGE_FORMAT','Referência visual incompatível com o endpoint.');
        must(im.sourceHash===assets.find(a=>a.assetId===im.assetId).hash,'CLAUDE_IMAGE_ID','Pixels e manifesto devem ter a mesma origem.');
        const data=im.bytes.toString('base64');must(data.length<=this.config.claudeImageBase64Bytes,'CLAUDE_IMAGE_SIZE','Referência individual excedeu o limite.');
        content.push({type:'text',text:`Asset real ${im.assetId}; referência ${im.width}x${im.height}; original SHA-256 ${im.sourceHash}. Use os caminhos do manifesto para publicar.`},{type:'image',source:{type:'base64',media_type:im.mime,data}});
      }
      content.push({type:'text',text:JSON.stringify({brief,outputContract:schemas.files})});
      body={model:model.id||this.config.claudeModel,max_tokens:this.config.claudeMaxOutputTokens,system:CLAUDE_SYSTEM,messages:[{role:'user',content}]};
      const requestBytes=Buffer.byteLength(JSON.stringify(body));
      must(requestBytes<=this.config.claudeRequestBytes&&requestBytes<32000000,'CLAUDE_PAYLOAD','Payload multimodal serializado excedeu o teto.');
      const tokenKey='claudeTokenCount:'+hash(body);let inputTokens=this.store.checkpoint(this.job.id,tokenKey);
      if(!inputTokens) {
        // This endpoint only estimates tokens; it never generates, analyzes or continues a site.
        const {data}=await this.transport.api('https://api.anthropic.com/v1/messages/count_tokens',{hosts:['api.anthropic.com'],method:'POST',attempts:this.config.apiAttempts,timeout:60000,signal:this.signal,headers:{'x-api-key':this.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:{model:body.model,system:body.system,messages:body.messages}});
        inputTokens=data.input_tokens;must(Number.isInteger(inputTokens)&&inputTokens>0,'CLAUDE_TOKEN_COUNT','Contagem multimodal não confirmada.');this.store.checkpoint(this.job.id,tokenKey,inputTokens);
      }
      must(inputTokens*1.05+body.max_tokens<=model.max_input_tokens,'CLAUDE_CONTEXT','Contexto insuficiente com margem de 5% e saída reservada. Redimensione/revise antes de gerar.');
      this.store.checkpoint(this.job.id,'claudeInput',{model:body.model,inputTokens,requestBytes,maxOutput:body.max_tokens,requestHash:hash(body),images:images.map(({bytes,...meta})=>({...meta,bytes:bytes.length}))});
    }
    const saved=await invokeClaudeOnce(this.store,this.job.id,async()=>{
      must(body,'CLAUDE_STATE','Uma reserva existente não pode originar outra geração.');
      const r=await this.transport.request('https://api.anthropic.com/v1/messages',{hosts:['api.anthropic.com'],method:'POST',body,headers:{'x-api-key':this.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},timeout:this.config.claudeTimeoutMs,signal:this.signal});
      return {text:r.text,status:r.status,requestId:r.headers['request-id']};
    });
    must(saved.status===200,'CLAUDE_HTTP',`Claude respondeu HTTP ${saved.status}; chamada consumida e não será repetida.`);
    let data; try{data=JSON.parse(saved.response);}catch{throw new Fault('CLAUDE_JSON','Resposta bruta inválida; preservada sem nova geração.');}
    this.store.event(this.job.id,'claude_usage',{model:data.model,usage:data.usage,stopReason:data.stop_reason,requestId:saved.request_id,calls:saved.calls});
    must(data.stop_reason==='end_turn','CLAUDE_INCOMPLETE','Claude não concluiu o projeto (truncamento/recusa). Não será continuado nem reconstruído.');
    let result; try{result=JSON.parse(data.content.filter(p=>p.type==='text').map(p=>p.text).join(''));}catch{throw new Fault('CLAUDE_CONTRACT','Claude não entregou o envelope JSON completo.');}
    return validate('files',result);
  }
}
