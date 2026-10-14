import test from 'node:test';
import assert from 'node:assert/strict';
import { compactBrief, briefSizeReport } from '../src/brief-package.mjs';
test('compactação preserva valores, IDs, bio, links, imagens e desenho; não altera original',()=>{
 const full={evidence:{sources:[{id:'post:1',text:'Histórico '.repeat(20000)}],claims:[{id:'x',kind:'address',status:'verified',original:'Loja 1, rua 10',normalized:'Loja 1, rua 10',quote:'Legenda '.repeat(5000),sourceId:'post:1'},{id:'y',kind:'phone',original:'(16)99167-6818',normalized:'+5516991676818',quote:'Telefone'}]},authoritativeContent:{bio:'BIO INTEGRAL',lines:['BIO INTEGRAL'],sources:[{id:'profile:bio',text:'BIO INTEGRAL'}]},assets:[{assetId:'a',hash:'h',variants:[{path:'assets/a.jpg'}]}],sections:[{claimIds:['x','y'],paragraphs:['Texto']}],links:[{url:'https://example.com'}],creativeDirection:{grid:'autoral'}};
 const snapshot=structuredClone(full),out=compactBrief(full),report=briefSizeReport(full,out,{claudeInputBytes:120000});
 assert.deepEqual(full,snapshot);assert.equal(out.evidence.claims[0].original,full.evidence.claims[0].original);assert.equal(out.evidence.claims[1].normalized,'+5516991676818');assert.equal(out.authoritativeContent.bio,'BIO INTEGRAL');
 for(const key of ['assets','sections','links','creativeDirection'])assert.deepEqual(out[key],full[key]);
 assert.equal(out.evidence.claims[0].id,'x');assert(report.fullBytes>114000);assert(report.compactBytes<114000);assert.deepEqual(compactBrief(out),out);
});
