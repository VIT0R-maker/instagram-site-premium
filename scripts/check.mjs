import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const f=JSON.parse(readFileSync(path.join(root,'../workflow_instagram_site_premium.json'),'utf8'));
const names=new Set(f.nodes.map(n=>n.name)),ids=new Set(f.nodes.map(n=>n.id));
assert.equal(names.size,f.nodes.length);assert.equal(ids.size,f.nodes.length);
const byName=new Map(f.nodes.map(n=>[n.name,n]));
for(const [from,outputs]of Object.entries(f.connections)) {
  assert(names.has(from));for(const branch of outputs.main)for(const edge of branch||[]) {assert(names.has(edge.node));assert.equal(edge.index,0);}
}
const generation=f.nodes.filter(n=>n.name.startsWith('Claude —'));assert.equal(generation.length,1);assert.equal(generation[0].retryOnFail,false);
const reach=(from,to,seen=new Set())=>{if(seen.has(from))return false;seen.add(from);for(const b of f.connections[from]?.main||[])for(const e of b||[])if(e.node===to||reach(e.node,to,seen))return true;return false;};
assert(!reach(generation[0].name,generation[0].name),'Loop pode voltar à geração');
for(const n of f.nodes) {
  assert(['telegramTrigger','telegram','code','if','wait','httpRequest','stickyNote'].some(t=>n.type==='n8n-nodes-base.'+t));
  if(n.type==='n8n-nodes-base.code')new Function(n.parameters.jsCode);
  const content=JSON.stringify(n.parameters);
  for(const hit of content.matchAll(/\$\('([^']+)'\)/g))assert(names.has(hit[1]),'Referência a nó inexistente: '+hit[1]);
}
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of [...files(path.join(root,'src')),...files(path.join(root,'renderer')),...files(path.join(root,'scripts'))].filter(f=>/\.m?js$/.test(f))) {
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
}
const provider=readFileSync(path.join(root,'src/providers.mjs'),'utf8');assert.equal((provider.match(/https:\/\/api\.anthropic\.com\/v1\/messages/g)||[]).length,1);
console.log(JSON.stringify({nodes:f.nodes.length,connections:Object.keys(f.connections).length,claudeNodes:1,noReturnLoop:true,syntax:'passed',n8nReference:'2.41.6',importedIntoUserInstance:false},null,2));
