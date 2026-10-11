import Ajv from 'ajv';
import { must, Fault } from './core.mjs';
const str={type:'string'}, num={type:'number'}, bool={type:'boolean'};
const arr=(items,maxItems=100) => ({type:'array',items,maxItems});
const obj=properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const en=(...values) => ({type:'string',enum:values});
const point={...arr({type:'number',minimum:0,maximum:1},2),minItems:2};
const score={type:'number',minimum:0,maximum:100};
const claim=obj({id:str,kind:en('service','name','phone','whatsapp','email','website','address','city','hours','other'),original:str,normalized:str,sourceId:str,quote:str,date:{type:['string','null']},status:en('verified','unknown','conflict')});
export const schemas={
  facts:obj({schemaVersion:{type:'string',const:'1.0'},business:obj({name:str,niche:str,subniche:str,tone:str,inferences:arr(str),unknowns:arr(str)}),claims:arr(claim),limitations:arr(str)}),
  batch:obj({images:arr(obj({assetId:str,observable:str,quality:score,lighting:str,sharpness:str,composition:str,brandFit:str,textOrFlyer:bool,redundancy:str,protectedElements:arr(str),safeTextArea:str,roles:{...arr(en('hero','about','service','gallery','logo','reject')),minItems:1},reason:str,confidence:{type:'number',minimum:0,maximum:1},limitations:arr(str),alt:str,focalDesktop:point,focalMobile:point,protectedBox:{...arr({type:'number',minimum:0,maximum:1},4),minItems:4},cropDesktop:str,cropMobile:str}))}),
  selection:obj({heroMode:en('photo','typographic'),assets:arr(obj({assetId:str,role:en('hero','about','service','gallery','logo'),reason:str,componentRatioDesktop:str,componentRatioMobile:str,cutRestrictions:str}),20),identity:obj({logoAssetId:{type:['string','null']},logoReason:str,colors:obj({background:str,surface:str,text:str,muted:str,accent:str,onAccent:str,border:str,focus:str}),colorEvidence:str}),limitations:arr(str)}),
  directions:obj({directions:{...arr(obj({id:str,concept:str,desktopHero:str,mobileHero:str,textImageRelation:str,grid:str,typography:str,spacing:str,imageTreatment:str,details:str,header:str,motion:str,antiPatterns:arr(str),fontPair:en('editorial','modern','technical'),scores:obj({brand:score,hero:score,mobile:score,clarity:score,feasibility:score,distinctiveness:score}),reason:str}),3),minItems:3},chosenId:str,acceptable:bool,reason:str}),
  copy:obj({sections:arr(obj({id:str,purpose:str,desktop:str,mobile:str,heading:str,paragraphs:arr(str),claimIds:arr(str),assetIds:arr(str),ctaLinkId:{type:['string','null']}}),9),navigation:arr(obj({label:str,sectionId:str}),9),seo:obj({title:str,description:str}),limitations:arr(str)}),
  review:obj({approved:bool,issues:arr(obj({severity:en('low','medium','high','critical'),component:str,evidence:str,description:str,fix:str})),reason:str}),
  audit:obj({score,rubric:obj({identity:score,composition:score,spacing:score,typography:score,images:score,responsiveness:score}),issues:arr(obj({severity:en('low','medium','high','critical'),viewport:str,component:str,evidence:str,description:str,fix:str})),patches:arr(obj({file:en('index.html','styles.css'),expectedHash:str,find:{type:'string',minLength:1,maxLength:1200},replace:{type:'string',maxLength:1600},reason:str}),6)}),
  files:obj({schemaVersion:{type:'string',const:'1.0'},files:{...arr(obj({path:en('index.html','styles.css'),content:{type:'string',minLength:40,maxLength:160000}}),2),minItems:2}})
};
const ajv=new Ajv({allErrors:true,strict:false});
const validators=Object.fromEntries(Object.entries(schemas).map(([k,v])=>[k,ajv.compile(v)]));
export function validate(kind,value) {
  const fn=validators[kind]; must(fn,'CONTRACT','Contrato desconhecido.');
  if(!fn(value)) throw new Fault('SCHEMA',`Contrato ${kind} inválido: ${ajv.errorsText(fn.errors).slice(0,400)}`);
  return value;
}
export function apiSchema(schema) {
  // Only the documented Gemini JSON Schema subset is sent; Ajv enforces the full one locally.
  if(Array.isArray(schema)) return schema.map(apiSchema);
  if(schema && typeof schema==='object') return Object.fromEntries(Object.entries(schema).filter(([k])=> !['additionalProperties','$schema'].includes(k)).map(([k,v])=>[k,k==='const'?v:apiSchema(v)]));
  return schema;
}
