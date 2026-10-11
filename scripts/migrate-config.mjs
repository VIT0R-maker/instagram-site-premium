import { readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateConfig } from '../src/server.mjs';
const target=path.resolve(process.argv[2]||'config.json');
const old=JSON.parse(readFileSync(target,'utf8')),defaults=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
const migrated={...defaults,...old,schemaVersion:'2.0'};
delete migrated.enableAiDecorativeImages;delete migrated.geminiImageModel;
if(old.rendererImage==='instagram-site-renderer:1.0.0')migrated.rendererImage='instagram-site-renderer:2.0.0';
validateConfig(migrated);
if(JSON.stringify(old)===JSON.stringify(migrated)){console.log('Configuração já atualizada.');process.exit(0);}
const backup=target+'.backup-'+Date.now();copyFileSync(target,backup);writeFileSync(target,JSON.stringify(migrated,null,2)+'\n');
console.log('Configuração migrada. Backup: '+backup+'\nO banco e as reservas Claude não foram modificados.');
