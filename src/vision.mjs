import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hash, must } from './core.mjs';

export async function claudeReferences(brief,pack,dir,config) {
  must(brief.assets.length<=config.claudeMaxImages,'CLAUDE_IMAGES','Seleção excede o limite configurado; não serão omitidas imagens.');
  const originals=brief.assets.map(asset=>{
    const original=pack.assets.find(a=>a.assetId===asset.assetId&&a.status==='downloaded');
    must(original&&original.hash===asset.hash,'CLAUDE_IMAGE_ID','Referência não corresponde ao asset aprovado.');
    const bytes=readFileSync(path.join(dir,original.originalPath));
    must(hash(bytes)===asset.hash,'CLAUDE_IMAGE_HASH','Original alterado depois da curadoria.');
    return {asset,bytes};
  });
  for(let edge=config.claudeReferenceMaxEdge;;edge=Math.max(config.claudeReferenceMinEdge,Math.floor(edge*.8))) {
    const images=await Promise.all(originals.map(async({asset,bytes})=>{
      const {data,info}=await sharp(bytes).rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer({resolveWithObject:true});
      return {assetId:asset.assetId,mime:'image/webp',bytes:data,width:info.width,height:info.height,sourceHash:asset.hash,referenceHash:hash(data),originalWidth:asset.width,originalHeight:asset.height,referenceMaxEdge:edge};
    }));
    const base64=images.reduce((n,i)=>n+4*Math.ceil(i.bytes.length/3),0);
    if(base64+config.claudeInputBytes+50000<=config.claudeRequestBytes&&images.every(i=>4*Math.ceil(i.bytes.length/3)<=config.claudeImageBase64Bytes))return images;
    must(edge>config.claudeReferenceMinEdge,'CLAUDE_IMAGE_BUDGET','Referências não cabem no teto de bytes sem perda excessiva. Ajuste a seleção/configuração antes da geração.');
  }
}

export async function auditReferences(screenshots,config) {
  // Whole pages retain their detailed originals privately; section shots protect legibility.
  return Promise.all(screenshots.map(async s=>({label:s.label,mime:'image/jpeg',bytes:await sharp(Buffer.from(s.data,'base64')).resize({width:config.auditImageMaxEdge,height:config.auditImageMaxEdge,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer()})));
}
