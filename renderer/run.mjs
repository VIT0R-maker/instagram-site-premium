import { chromium } from 'playwright';
import axe from 'axe-core';
import { observedCrop } from '../src/crops.mjs';
import http from 'node:http';
import path from 'node:path';
const input=[];for await(const c of process.stdin)input.push(c);
const payload=JSON.parse(Buffer.concat(input));
const files=Object.fromEntries(Object.entries(payload.files).map(([p,b])=>[p,Buffer.from(b,'base64')]));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.png':'image/png','.woff2':'font/woff2'};
const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'";
const server=http.createServer((req,res)=>{
  let file;try{const u=new URL(req.url,'http://127.0.0.1');file=decodeURIComponent(u.pathname);if(!file.startsWith(payload.basePath))throw Error();file=file.slice(payload.basePath.length)||'index.html';}catch{res.writeHead(404).end();return;}
  if(!files[file]){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Security-Policy':csp});res.end(files[file]);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,base=origin+payload.basePath;
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
const report={engine:'Chromium '+browser.version(),conditions:{deviceScaleFactor:1,locale:'pt-BR',timezoneId:'America/Sao_Paulo',network:'none; assets locais',motion:['no-preference','reduce'],limitations:['rAF em ambiente virtualizado é diagnóstico, não benchmark de fluidez em dispositivos reais.','axe não mede com exatidão todo contraste sobre fotografias; inspeção visual também é obrigatória.']},tests:[],screenshots:[]};
const pages=Object.keys(files).filter(f=>f.endsWith('.html'));
const shot=async(page,info,opts={})=>{const capture=await page.evaluate(()=>({scrollX,scrollY,viewportWidth:innerWidth,viewportHeight:innerHeight}));if(info.kind==='fold'&&Math.abs(capture.scrollY)>1)throw Error('Primeira dobra fora da origem');const data=(await page.screenshot({type:'jpeg',quality:85,animations:'allow',...opts})).toString('base64');const after=await page.evaluate(()=>({scrollX,scrollY}));if(info.kind==='fold'&&Math.abs(after.scrollY)>1)throw Error('Enquadramento da dobra mudou durante captura');report.screenshots.push({...info,capture,after,data});};
async function settle(page){await page.evaluate(async timeout=>{let timer;try{await Promise.race([document.fonts.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('FONT_TIMEOUT: fontes não concluíram carregamento')),timeout);})]);}finally{clearTimeout(timer);}const failed=[...document.fonts].filter(f=>f.status==='error');if(failed.length)throw Error('FONT_ERROR: '+failed.map(f=>f.family).join(', '));},payload.fontReadyTimeoutMs||12000);await page.waitForTimeout(100);}
async function top(page){await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));await page.waitForTimeout(200);await page.waitForFunction(()=>Math.abs(scrollY)<1,{},{timeout:3000});}
async function visibleState(locator,name){return locator.evaluate((n,key)=>key?getComputedStyle(n)[key]||n.getAttribute(key):n.innerHTML,name);}
async function assertStep(page,step,before){
  const e=step.expect,l=page.locator(e.selector).first();
  if(e.condition==='visible')await l.waitFor({state:'visible',timeout:2500});
  else if(e.condition==='hidden')await l.waitFor({state:'hidden',timeout:2500});
  else {
    let ok=false;
    for(let i=0;i<20&&!ok;i++) {
      if(e.condition==='attribute')ok=await l.getAttribute(e.name)===e.value;
      if(e.condition==='text')ok=(await l.innerText()).includes(e.value);
      if(e.condition==='focused')ok=await l.evaluate(n=>document.activeElement===n);
      if(e.condition==='changed')ok=await visibleState(l,e.name)!==before;
      if(!ok)await page.waitForTimeout(75);
    }
    if(!ok)throw Error(`Expectativa ${e.condition} falhou: ${e.selector} ${e.name}=${e.value}`);
  }
}
try {
  for(const file of pages)for(const width of payload.viewports||[320,390,768,1440])for(const motion of ['no-preference','reduce']) {
    const height=width<768?844:900,url=new URL(file,base).href;
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,hasTouch:width<768,isMobile:width<768,locale:'pt-BR',timezoneId:'America/Sao_Paulo',reducedMotion:motion,serviceWorkers:'block'});
    let page=await context.newPage();page.setDefaultTimeout(4000);const errors=[],interactionResults=[],focusEvidence=[];
    await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    page.on('pageerror',e=>errors.push('JS: '+e.message.slice(0,180)));
    page.on('console',m=>{if(m.type()==='error')errors.push('Console: '+m.text().slice(0,180));});
    page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+new URL(r.url()).pathname);});
    try {
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await settle(page);
      const animationStart=await page.evaluate(()=>document.getAnimations().map(a=>({target:a.effect?.target?.id||a.effect?.target?.tagName,duration:a.effect?.getTiming().duration,state:a.playState})));
      if(motion==='no-preference'&&file==='index.html'&&[320,1440].includes(width)&&payload.maxTemporalShots>0) {
        await shot(page,{page:file,width,height,motion,kind:'temporal',timeMs:100,label:`${file} ${width} normal início (~100ms após DOM/fontes)`});
      }
      const timing=await page.evaluate(async()=>{
        const deltas=[];let last=performance.now(),start=last;
        await new Promise(resolve=>{function frame(now){deltas.push(now-last);last=now;if(now-start<700)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
        deltas.sort((a,b)=>a-b);return {sampleMs:last-start,frames:deltas.length,p95FrameMs:deltas[Math.floor(deltas.length*.95)]||0,maxFrameMs:deltas.at(-1)||0};
      });
      const activeReduced=await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&Number(a.effect?.getTiming().duration)>100).length);
      if(motion==='reduce'&&activeReduced)errors.push('Movimento reduzido mantém animação longa ativa');
      const scrollHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
      for(let y=0;y<Math.min(scrollHeight,payload.maxHeight);y+=600){await page.mouse.wheel(0,600);await page.waitForTimeout(100);}
      await top(page);
      await page.waitForTimeout(600);
      const metrics=await page.evaluate(()=>{
        const visible=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
        const bounds=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
        const overflowText=[...document.querySelectorAll('h1,h2,h3,p,a,button')].filter(visible).filter(n=>{const r=n.getBoundingClientRect();return r.left<-1||r.right>innerWidth+1;}).map(n=>({text:n.textContent.slice(0,100),bounds:bounds(n)}));
        const images=[...document.images].filter(visible).map(n=>({src:n.getAttribute('src'),currentSrc:n.currentSrc,naturalWidth:n.naturalWidth,naturalHeight:n.naturalHeight,alt:n.alt,bounds:bounds(n),objectFit:getComputedStyle(n).objectFit,objectPosition:getComputedStyle(n).objectPosition}));
        const backgrounds=[...document.querySelectorAll('[data-asset-id]')].filter(visible).map(n=>({assetId:n.dataset.assetId,bounds:bounds(n),backgroundImage:getComputedStyle(n).backgroundImage,backgroundSize:getComputedStyle(n).backgroundSize,backgroundPosition:getComputedStyle(n).backgroundPosition,maskImage:getComputedStyle(n).maskImage,alternative:n.getAttribute('aria-label')||n.textContent.slice(0,180)}));
        return {overflow:document.documentElement.scrollWidth>innerWidth+1,height:document.documentElement.scrollHeight,overflowText,images,backgrounds,headings:[...document.querySelectorAll('h1,h2')].filter(visible).map(n=>({text:n.textContent,bounds:bounds(n),font:getComputedStyle(n).fontFamily,fontSize:getComputedStyle(n).fontSize})),fonts:[...document.fonts].map(f=>({family:f.family,weight:f.weight,style:f.style,status:f.status})),hiddenMainContent:[...document.querySelectorAll('main h1,main h2,main p')].filter(n=>{const s=getComputedStyle(n);return s.opacity==='0'||s.visibility==='hidden'||s.display==='none';}).map(n=>({tag:n.tagName,text:n.textContent.slice(0,160),explicitCollapse:!!n.closest('[hidden],[aria-hidden=true],details:not([open])')})),renderedText:document.body.innerText.slice(0,30000)};
      });
      if(await page.evaluate(()=>innerWidth>screen.width+1)&&width<768)errors.push('Viewport mobile ampliado por conteúdo que não cabe');
      if(metrics.overflow)errors.push('Overflow horizontal');if(metrics.overflowText.length)errors.push('Texto fora da tela');
      if(metrics.images.some(i=>!i.naturalWidth))errors.push('Imagens quebradas');if(metrics.height>payload.maxHeight)errors.push('Página excede altura máxima auditável');
      for(const c of await page.locator('[data-primary-cta]').all())if(await c.isVisible()) {
        await c.scrollIntoViewIfNeeded();await page.waitForTimeout(100);
        const hit=await c.evaluate(n=>{const r=n.getBoundingClientRect(),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {blocked:!at||!n.contains(at),small:r.width<44||r.height<44};});
        if(hit.blocked)errors.push('CTA obstruído');if(hit.small)errors.push('CTA menor que 44px');
      }
      const cropChecks=[];
      for(const a of payload.assets||[]){for(const m of [...metrics.backgrounds.filter(m=>m.assetId===a.assetId),...metrics.images.filter(m=>a.variants.some(v=>new URL(v.path,base).href===m.currentSrc))]){const c=observedCrop(a,m);if(c){cropChecks.push(c);if(c.assessed&&!c.fits)errors.push('Recorte remove região protegida: '+a.assetId);}}}
      metrics.cropChecks=cropChecks;
      await top(page);
      await shot(page,{page:file,width,height,motion,kind:'fold',label:`${file} ${width}x${height} ${motion} primeira dobra`});
      if(metrics.height<=payload.maxHeight)await shot(page,{page:file,width,height:metrics.height,motion,kind:'full',label:`${file} ${width} ${motion} página inteira; altura ${metrics.height}`},{fullPage:true});
      // Legible, contiguous tiles include EVERY section and the footer in both modes.
      // Full-page overview may shrink for the model; these captures never do.
      const coverage={height:metrics.height,coveredTo:0,complete:false,tiles:[]};
      const tileHeight=payload.auditTileHeight||1200;
      if(metrics.height<=payload.maxHeight)for(let y=0;y<metrics.height;y+=tileHeight){
        const h=Math.min(tileHeight,metrics.height-y),coverageId=[file,width,motion,y].join(':');
        await top(page);await shot(page,{page:file,width,height:h,motion,kind:'detail',coverageId,y,label:`${file} ${width} ${motion} faixa ${y}–${y+h}`},{fullPage:true,clip:{x:0,y,width,height:h}});
        coverage.tiles.push(coverageId);coverage.coveredTo=y+h;
      }
      coverage.complete=coverage.coveredTo>=metrics.height;
      if(!coverage.complete)errors.push('Cobertura visual incompleta até o rodapé');
      // Manifest actions are data, never JS/eval. Reset between input paths to avoid false passes.
      for(const interaction of payload.interactions||[])if(width>=interaction.minWidth&&width<=interaction.maxWidth)for(const scenario of interaction.paths) {
        if(interaction.page&&interaction.page!==file)continue;
        const originalPage=page;let touchContext;
        try {
          if(scenario.input==='touch'&&width>=768){touchContext=await browser.newContext({viewport:{width,height},hasTouch:true,reducedMotion:motion,locale:'pt-BR',timezoneId:'America/Sao_Paulo',serviceWorkers:'block'});await touchContext.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());page=await touchContext.newPage();page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push('JS toque: '+e.message.slice(0,180)));}
          await page.goto(url,{waitUntil:'domcontentloaded'});await settle(page);
          for(const [stepIndex,step] of scenario.steps.entries()) {
            const l=page.locator(step.selector).first(),before=step.expect.condition==='changed'?await visibleState(page.locator(step.expect.selector).first(),step.expect.name):null;
            if(['click','tap','press'].includes(step.action)) {
              const href=await l.getAttribute('href');if(href&&/^(https?:|mailto:|tel:)/.test(href))throw Error('Cenário não deve seguir contato externo');
            }
            if(step.action==='press'){await l.focus();await l.press(step.value);}
            else if(step.action==='scroll')await l.scrollIntoViewIfNeeded();
            else if(step.action==='focus')await l.focus();
            else if(step.action==='hover')await l.hover();
            else if(step.action==='tap')await l.tap();
            else if(step.action==='click')await l.click();
            await assertStep(page,step,before);
            if(scenario.input==='keyboard') {
              focusEvidence.push({interaction:interaction.id,step:stepIndex,...await page.evaluate(()=>{const n=document.activeElement,s=getComputedStyle(n);return {tag:n.tagName,id:n.id,label:(n.getAttribute('aria-label')||n.textContent||'').slice(0,100),outline:s.outline,boxShadow:s.boxShadow,color:s.color,background:s.backgroundColor};})});
              if(stepIndex===0&&motion==='no-preference'&&[320,1440].includes(width))await shot(page,{page:file,width,height,motion,kind:'interaction',label:`${file} ${width} normal ${interaction.kind}/${interaction.id} teclado após abrir`});
            }
          }
          interactionResults.push({id:interaction.id,input:scenario.input,passed:true,steps:scenario.steps.length});
        }catch(e){const msg=`Interação ${interaction.id}/${scenario.input}: ${e.message.slice(0,220)}`;errors.push(msg);interactionResults.push({id:interaction.id,input:scenario.input,passed:false,error:msg});}finally{if(touchContext)await touchContext.close();page=originalPage;}
      }
      await page.goto(url,{waitUntil:'domcontentloaded'});await settle(page);
      for(const a of await page.locator('a[href^="#"]').all()) {
        if(!await a.isVisible())continue;const href=await a.getAttribute('href');if(href==='#')continue;
        try{await a.focus();await a.press('Enter');if(new URL(page.url()).hash!==href)errors.push('Âncora não navegou: '+href);}catch{errors.push('Âncora inacessível: '+href);}
      }
      // Let finite entry transitions finish before stable-state contrast checks;
      // normal-motion timing and early screenshots above remain recorded, not disabled.
      await page.waitForTimeout(800);
      await page.evaluate(axe.source);
      const accessibility=await page.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}));
      const axeIssues=accessibility.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}));
      if(axeIssues.some(v=>['serious','critical'].includes(v.impact)))errors.push('axe: violação séria/crítica');
      report.tests.push({page:file,width,height,motion,inputContext:{hasTouch:width<768,isMobile:width<768,hover:width>=768?'hover':'none',touchPathsAtDesktop:'contexto auxiliar com toque'},coverage,passed:errors.length===0,errors:[...new Set(errors)],metrics,animation:{start:animationStart,activeReduced,timing},interactions:interactionResults,focusEvidence,axe:axeIssues});
    }catch(e){report.tests.push({page:file,width,height,motion,passed:false,errors:[...errors,'Render: '+e.message.slice(0,300)],interactions:interactionResults});}
    await context.close();
  }
  for(const file of pages) {
    const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844},serviceWorkers:'block'});
    await nojs.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    const p=await nojs.newPage();await p.goto(new URL(file,base).href,{waitUntil:'domcontentloaded'});
    const visible=await p.locator('h1').isVisible()&&await p.locator('[data-primary-cta]').first().isVisible();
    report.tests.push({page:file,mode:'no-js',passed:visible,errors:visible?[]:['Conteúdo principal indisponível sem JS']});await nojs.close();
  }
  report.passed=report.tests.every(t=>t.passed);process.stdout.write(JSON.stringify(report));
} finally {await browser.close();await new Promise(r=>server.close(r));}
