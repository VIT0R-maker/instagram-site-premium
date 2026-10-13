import Ajv from 'ajv';
import { must, Fault } from './core.mjs';
const str={type:'string'}, num={type:'number'}, bool={type:'boolean'};
const arr=(items,maxItems=100) => ({type:'array',items,maxItems});
const obj=properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const en=(...values) => ({type:'string',enum:values});
const point={...arr({type:'number',minimum:0,maximum:1},2),minItems:2};
const score={type:'number',minimum:0,maximum:100};
const claim=obj({id:str,kind:en('service','product','offer','name','phone','whatsapp','email','website','shop','address','city','hours','other'),original:str,normalized:str,sourceId:str,quote:str,date:{type:['string','null']},status:en('verified','unknown','conflict')});
const codePath={type:'string',pattern:'^(?!assets/|lib/)(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+\\.(html|css|js|svg)$',maxLength:160};
const step=obj({action:en('click','tap','press','hover','focus','scroll','check'),selector:str,value:str,expect:obj({selector:str,condition:en('visible','hidden','attribute','text','focused','changed'),name:str,value:str})});
export const interactionsSchema=arr(obj({id:str,page:{type:'string',pattern:'^(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+\\.html$'},kind:en('menu','gallery','lightbox','accordion','tabs','card','custom'),description:str,minWidth:{type:'integer',minimum:0},maxWidth:{type:'integer',maximum:4000},paths:arr(obj({input:en('keyboard','pointer','touch'),steps:{...arr(step,16),minItems:1}}),3)}),16);
export const schemas={
  facts:obj({schemaVersion:{type:'string',const:'1.0'},business:obj({name:str,niche:str,subniche:str,tone:str,inferences:arr(str),unknowns:arr(str)}),claims:arr(claim),limitations:arr(str)}),
  batch:obj({images:arr(obj({assetId:str,observable:str,quality:score,lighting:str,sharpness:str,composition:str,brandFit:str,textOrFlyer:bool,redundancy:str,protectedElements:arr(str),safeTextArea:str,roles:{...arr(en('hero','about','service','gallery','logo','reject')),minItems:1},reason:str,confidence:{type:'number',minimum:0,maximum:1},limitations:arr(str),alt:str,focalDesktop:point,focalMobile:point,protectedBox:{...arr({type:'number',minimum:0,maximum:1},4),minItems:4},cropDesktop:str,cropMobile:str}))}),
  selection:obj({heroMode:en('photo','typographic'),assets:arr(obj({assetId:str,role:en('hero','about','service','gallery','logo'),priority:en('essential','recommended','optional'),reason:str,componentRatioDesktop:str,componentRatioMobile:str,cutRestrictions:str}),100),identity:obj({logoAssetId:{type:['string','null']},logoReason:str,colors:obj({background:str,surface:str,text:str,muted:str,accent:str,onAccent:str,border:str,focus:str}),colorEvidence:str}),limitations:arr(str)}),
  directions:obj({directions:{...arr(obj({id:str,concept:str,desktopHero:str,mobileHero:str,textImageRelation:str,grid:str,typography:str,spacing:str,imageTreatment:str,details:str,header:str,motion:str,antiPatterns:arr(str),fonts:obj({heading:str,body:str}),library:en('native','animejs'),libraryReason:str,scores:obj({brand:score,hero:score,mobile:score,clarity:score,feasibility:score,distinctiveness:score}),reason:str}),3),minItems:3},chosenId:str,acceptable:bool,reason:str}),
  copy:obj({sections:arr(obj({id:str,purpose:str,desktop:str,mobile:str,heading:str,paragraphs:arr(str),claimIds:arr(str),assetIds:arr(str),ctaLinkId:{type:['string','null']}}),24),navigation:arr(obj({label:str,sectionId:str}),24),seo:obj({title:str,description:str}),limitations:arr(str)}),
  review:obj({approved:bool,repairTargets:arr(en('facts','selection','crops','fonts','direction','structure','copy','links'),8),issues:arr(obj({severity:en('low','medium','high','critical'),component:str,evidence:str,description:str,fix:str})),reason:str}),
  audit:obj({score,rubric:obj({identity:score,composition:score,spacing:score,typography:score,images:score,responsiveness:score}),semanticReview:obj({approved:bool,unsupportedClaims:arr(obj({text:str,reason:str})),equivalentCopy:arr(str)}),observedImprovements:arr(str),issues:arr(obj({severity:en('low','medium','high','critical'),viewport:str,component:str,evidence:str,description:str,fix:str})),patches:arr(obj({file:codePath,expectedHash:str,find:{type:'string',minLength:1,maxLength:3000},replace:{type:'string',maxLength:4000},reason:str}),12)}),
  files:obj({schemaVersion:{type:'string',const:'2.0'},files:{...arr(obj({path:codePath,content:{type:'string',minLength:1,maxLength:180000}}),16),minItems:2},interactions:interactionsSchema})
};
schemas.auditPart=obj({coverageIds:arr(str,100),score,rubric:schemas.audit.properties.rubric,issues:schemas.audit.properties.issues,observations:arr(str)});
const auditExtra={manifestRepairs:arr(obj({id:str,reason:str,expectedHash:str,paths:interactionsSchema.items.properties.paths}),8),scopeJustification:str};
Object.assign(schemas.audit.properties,auditExtra);
// Optional fields preserve persisted v2 responses; new models see explicit repair instructions.
const ajv=new Ajv({allErrors:true,strict:false});
const validators=Object.fromEntries(Object.entries(schemas).map(([k,v])=>[k,ajv.compile(v)]));
export function validate(kind,value) {
  const fn=validators[kind]; must(fn,'CONTRACT','Contrato desconhecido.');
  if(!fn(value)) throw new Fault('SCHEMA',`Contrato ${kind} inválido: ${ajv.errorsText(fn.errors).slice(0,400)}`);
  return value;
}
export function apiSchema(schema) {
  if (schema === null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(apiSchema);

  // Estas restricoes continuam obrigatorias no Ajv.
  // Na requisicao ao Gemini, passam a ser orientacoes textuais.
  const localOnly = new Set([
    'minItems', 'maxItems', 'minLength', 'maxLength',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
    'multipleOf', 'pattern', 'uniqueItems'
  ]);

  const out = {};
  const hints = [];

  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema' || key === 'additionalProperties') continue;

    if (localOnly.has(key)) {
      hints.push(key + '=' + JSON.stringify(value));
      continue;
    }

    if (key === 'const') {
      out.enum = [value];
    } else if (
      key === 'properties' ||
      key === '$defs' ||
      key === 'definitions'
    ) {
      // Nomes de campos nao devem ser tratados como palavras-chave.
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          apiSchema(child)
        ])
      );
    } else if (key === 'items' || key === 'not') {
      out[key] = apiSchema(value);
    } else if (
      ['anyOf', 'oneOf', 'allOf', 'prefixItems'].includes(key)
    ) {
      out[key] = value.map(apiSchema);
    } else {
      out[key] = structuredClone(value);
    }
  }

  if (hints.length) {
    out.description = [
      out.description,
      'Regras verificadas pelo aplicativo: ' + hints.join('; ') + '.'
    ].filter(Boolean).join(' ');
  }

  return out;
}
