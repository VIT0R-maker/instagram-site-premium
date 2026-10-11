import { randomBytes } from 'node:crypto';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import assert from 'node:assert/strict';
assert(!existsSync('.env'),'O .env já existe; nenhum segredo foi sobrescrito.');
const template=readFileSync('.env.example','utf8');
writeFileSync('.env',template.replace('WORKER_TOKEN=','WORKER_TOKEN='+randomBytes(32).toString('hex')).replace('JOB_HMAC_KEY=','JOB_HMAC_KEY='+randomBytes(32).toString('hex')),{mode:0o600,flag:'wx'});
console.log('.env criado. Preencha as credenciais e IDs no editor; segredos não foram impressos.');
