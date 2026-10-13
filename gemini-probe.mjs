// Diagnóstico isolado do erro HTTP 400 do Gemini. Não imprime a chave.
// Uso (na pasta do projeto):  docker compose exec -T worker node --input-type=module < gemini-probe.mjs
import {readFileSync} from 'node:fs';
const key=process.env.GEMINI_API_KEY;
const cfg=JSON.parse(readFileSync('/app/config.json','utf8'));
const model=cfg.geminiAnalysisModel;
const base='https://generativelanguage.googleapis.com/v1beta/models/'+model;
const JPEG='/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAAHlhf//Z';
const clean=t=>String(t).replace(/(AIza|AQ\.)[A-Za-z0-9._-]+/g,'[redigido]').replace(/\s+/g,' ').slice(0,450);
async function call(name,url,body,method='POST'){
  try{
    const r=await fetch(url,{method,headers:{'x-goog-api-key':key,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    const t=await r.text();let m=t;try{const j=JSON.parse(t);m=j.error?.message??(j.totalTokens!==undefined?'totalTokens='+j.totalTokens:(j.candidates?'candidates ok':JSON.stringify(j).slice(0,200)));}catch{}
    console.log((r.ok?'OK  ':'FALHA ')+r.status+' | '+name+(r.ok?'':' | '+clean(m)));
  }catch(e){console.log('ERRO DE REDE | '+name+' | '+clean(e.message));}
}
const schemaMini={type:'object',properties:{ok:{type:'boolean'}},required:['ok']};
const textPart={text:'Responda apenas o JSON {"ok":true}.'};
const imgParts=[textPart,{text:'Pixels: teste'},{inlineData:{mimeType:'image/jpeg',data:JPEG}}];
const {schemas,apiSchema}=await import('/app/src/contracts.mjs');
const real=apiSchema(schemas.batch);
console.log('modelo:',model);
await call('1 metadados do modelo',base,null,'GET');
await call('2 texto simples, sem schema',base+':generateContent',{contents:[{role:'user',parts:[textPart]}]});
await call('3 JSON mode + schema mínimo',base+':generateContent',{contents:[{role:'user',parts:[textPart]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:schemaMini}});
await call('4 + systemInstruction + maxOutputTokens '+cfg.geminiOutputTokens,base+':generateContent',{systemInstruction:{parts:[{text:'Voce e um assistente.'}]},contents:[{role:'user',parts:[textPart]}],generationConfig:{temperature:0.4,maxOutputTokens:cfg.geminiOutputTokens,responseMimeType:'application/json',responseJsonSchema:schemaMini}});
await call('5 imagem inline + schema mínimo',base+':generateContent',{contents:[{role:'user',parts:imgParts}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:schemaMini}});
await call('6 schema REAL (batch), só texto',base+':generateContent',{contents:[{role:'user',parts:[textPart]}],generationConfig:{maxOutputTokens:cfg.geminiOutputTokens,responseMimeType:'application/json',responseJsonSchema:real}});
await call('7 countTokens simples',base+':countTokens',{generateContentRequest:{model:'models/'+model,contents:[{role:'user',parts:[textPart]}]}});
await call('8 countTokens com schema real + imagem',base+':countTokens',{generateContentRequest:{model:'models/'+model,systemInstruction:{parts:[{text:'x'}]},contents:[{role:'user',parts:imgParts}],generationConfig:{maxOutputTokens:cfg.geminiOutputTokens,responseMimeType:'application/json',responseJsonSchema:real}}});
