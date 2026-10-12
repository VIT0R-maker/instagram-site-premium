// Explicit, repository-owned fixture. Never imported by production renderer calls.
import { spawn } from 'node:child_process';
import { readFileSync,mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { atomic } from '../src/core.mjs';
const cfg=JSON.parse(readFileSync('config.json'));
const page=long=>`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixture de cobertura</title><link rel="stylesheet" href="./styles.css"></head><body><a href="#main">Pular para conteúdo</a><main id="main"><h1>${long?'Acervo extenso':'Página adicional'}</h1><a data-primary-cta href="https://example.org/">Visitar referência de teste</a>${long?Array.from({length:14},(_,i)=>`<section id="parte-${i}"><h2>Seção ${i+1}</h2><p>Conteúdo controlado de teste. Esta faixa precisa chegar à auditoria.</p></section>`).join(''):'<p>Conteúdo essencial da segunda página.</p>'}</main><footer>FIM REAL DA PÁGINA</footer></body></html>`;
const files={'index.html':page(true),'detalhes.html':page(false),'styles.css':'*{box-sizing:border-box}body{margin:0;padding:24px;background:#fff;color:#181818;font:18px/1.6 Arial,sans-serif}h1{font-size:30px}section{min-height:680px;padding:24px 0;border-top:1px solid #555}a{display:inline-block;min-height:48px;padding:12px 0;color:#164b75}footer{padding:40px 0}'};
const input={files:Object.fromEntries(Object.entries(files).map(([f,s])=>[f,Buffer.from(s).toString('base64')])),basePath:'/coverage/',maxHeight:cfg.maxScreenshotHeight,viewports:[320,1440],auditTileHeight:cfg.auditTileHeight,maxTemporalShots:2,fontReadyTimeoutMs:cfg.fontReadyTimeoutMs,interactions:[],assets:[]};
const env=Object.fromEntries(['PATH','SystemRoot','TEMP','TMP','LOCALAPPDATA','USERPROFILE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const report=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['renderer/run.mjs'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});const out=[],err=[];const timer=setTimeout(()=>child.kill(),cfg.rendererTimeoutMs);child.stdout.on('data',x=>out.push(x));child.stderr.on('data',x=>err.push(x));child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code)reject(Error(Buffer.concat(err).toString()));else try{resolve(JSON.parse(Buffer.concat(out)));}catch(e){reject(e);}});child.stdin.end(JSON.stringify(input));});
mkdirSync('test-output/coverage-screenshots',{recursive:true});
for(const [i,s]of report.screenshots.entries()){atomic(`test-output/coverage-screenshots/${i}.jpg`,Buffer.from(s.data,'base64'));delete s.data;}
atomic('test-output/coverage-report.json',report);
assert(report.passed,JSON.stringify(report.tests.filter(t=>!t.passed)));
for(const t of report.tests.filter(t=>t.width)){assert(t.coverage.complete);assert(t.coverage.coveredTo>=t.metrics.height);if(t.page==='index.html'){assert(t.metrics.height>9000);assert(t.coverage.tiles.length>=8);}assert.equal(t.inputContext.hasTouch,t.width<768);}
assert.equal(report.tests.filter(t=>t.page==='detalhes.html').length,5);
console.log(JSON.stringify({passed:true,pages:2,tests:report.tests.length,longPageHeights:report.tests.filter(t=>t.page==='index.html'&&t.width).map(t=>t.metrics.height),screenshots:report.screenshots.length,models:'nenhum',engine:report.engine}));
