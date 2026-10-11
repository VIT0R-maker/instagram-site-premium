import { chromium } from 'playwright';
import axe from 'axe-core';
import http from 'node:http';
import path from 'node:path';
const input=[];for await(const c of process.stdin)input.push(c);
const payload=JSON.parse(Buffer.concat(input));
const files=Object.fromEntries(Object.entries(payload.files).map(([p,b])=>[p,Buffer.from(b,'base64')]));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
  let file;try{const u=new URL(req.url,'http://127.0.0.1');file=decodeURIComponent(u.pathname);if(!file.startsWith(payload.basePath))throw Error();file=file.slice(payload.basePath.length)||'index.html';}catch{res.writeHead(404).end();return;}
  if(!files[file]){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"});res.end(files[file]);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,url=origin+payload.basePath;
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
const report={engine:'Chromium '+browser.version(),conditions:{deviceScaleFactor:1,locale:'pt-BR',timezoneId:'America/Sao_Paulo',network:'none; local fixture only'},tests:[],screenshots:[]};
try {
  for(const width of [360,390,768,1440]) {
    const height=width<768?844:900;
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'pt-BR',timezoneId:'America/Sao_Paulo',reducedMotion:'reduce',serviceWorkers:'block'});
    const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    page.on('pageerror',e=>errors.push('JS: '+e.message.slice(0,160)));
    page.on('console',msg=>{if(msg.type()==='error')errors.push('Console: '+msg.text().slice(0,160));});
    page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+new URL(r.url()).pathname);});
    await page.goto(url,{waitUntil:'networkidle',timeout:30000});await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){scrollTo(0,y);await new Promise(r=>setTimeout(r,25));}scrollTo(0,0);});
    const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,height:document.documentElement.scrollHeight,brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.getAttribute('src')),hiddenImages:[...document.images].filter(i=>{const r=i.getBoundingClientRect();return r.width<1||r.height<1;}).map(i=>i.getAttribute('src'))}));
    if(metrics.overflow)errors.push('Overflow horizontal');if(metrics.height>payload.maxHeight)errors.push('Página excede altura máxima auditável');
    if(metrics.brokenImages.length)errors.push('Imagens quebradas');if(metrics.hiddenImages.length)errors.push('Imagens aprovadas ocultas');
    const toggle=page.locator('[data-menu-toggle]');
    if(await toggle.count()&&await toggle.isVisible()) {
      await toggle.click();if(await toggle.getAttribute('aria-expanded')!=='true')errors.push('Menu não abriu');
      const controlled=await toggle.getAttribute('aria-controls');if(!await page.locator(`[id="${controlled}"]`).isVisible())errors.push('Nav não visível');
      await page.keyboard.press('Escape');if(await toggle.getAttribute('aria-expanded')!=='false')errors.push('Escape não fechou menu');
      if(!await toggle.evaluate(n=>document.activeElement===n))errors.push('Foco não devolvido ao menu');
    }
    // Check targets and actual hit testing without following external contacts.
    const ct=await page.locator('[data-primary-cta]').all();
    for(const c of ct) {
      await c.scrollIntoViewIfNeeded();
      const blocked=await c.evaluate(n=>{const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return {bad:!hit||!n.contains(hit),small:r.width<44||r.height<44};});
      if(blocked.bad)errors.push('CTA obstruído');if(blocked.small)errors.push('CTA menor que 44px');
    }
    for(const a of await page.locator('a[href^="#"]').all()) {
      if(!await a.isVisible())continue;
      if(await a.getAttribute('href')==='#main')await a.focus();
      await a.click();const href=await a.getAttribute('href');
      if(new URL(page.url()).hash!==href)errors.push('Âncora não navegou: '+href);
    }
    await page.evaluate(axe.source);
    const accessibility=await page.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));
    const axeIssues=accessibility.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}));
    if(axeIssues.some(v=>['serious','critical'].includes(v.impact)))errors.push('axe: violação séria/crítica');
    await page.evaluate(()=>scrollTo(0,0));
    report.screenshots.push({label:`${width}x${height} primeira dobra`,width,height,kind:'fold',data:(await page.screenshot({type:'jpeg',quality:80})).toString('base64')});
    if(metrics.height<=payload.maxHeight)report.screenshots.push({label:`${width}x${height} página inteira; altura ${metrics.height}`,width,height:metrics.height,kind:'full',data:(await page.screenshot({type:'jpeg',quality:78,fullPage:true})).toString('base64')});
    report.tests.push({width,height,passed:errors.length===0,errors,metrics,axe:axeIssues});await context.close();
  }
  const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844},serviceWorkers:'block'});
  await nojs.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const p=await nojs.newPage();await p.goto(url,{waitUntil:'networkidle'});
  const visible=await p.locator('h1').isVisible()&&await p.locator('[data-primary-cta]').first().isVisible();
  report.tests.push({mode:'no-js',passed:visible,errors:visible?[]:['Conteúdo principal indisponível sem JS']});await nojs.close();
  report.passed=report.tests.every(t=>t.passed);
  process.stdout.write(JSON.stringify(report));
} finally {await browser.close();await new Promise(r=>server.close(r));}
