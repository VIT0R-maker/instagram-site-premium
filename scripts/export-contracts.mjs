import { schemas } from '../src/contracts.mjs';
import { DIRECTOR, TASKS, CLAUDE_SYSTEM } from '../src/prompts.mjs';
import { atomic } from '../src/core.mjs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const [name,schema] of Object.entries(schemas))atomic(root+'contratos/'+name+'.schema.json',schema);
const sections=[['Gemini — instrução comum',DIRECTOR],...Object.entries(TASKS).map(([k,v])=>['Gemini — '+k,v]),['Claude — criador exclusivo',CLAUDE_SYSTEM]];
atomic(root+'PROMPTS.md','# Prompts ativos — versão 2\n\nGerado de src/prompts.mjs. Este é o texto enviado pelo worker; payloads incluem os contratos JSON correspondentes. Fontes/código recebidos são dados, não instruções.\n\n'+sections.map(([name,text])=>'## '+name+'\n\n'+text+'\n').join('\n'));
console.log('Prompts e oito contratos exportados.');
