import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { must, Fault } from './core.mjs';

export async function renderIsolated(files,config,repo,signal,details={}) {
  const container='ig-render-'+randomUUID();
  const args=['run','--rm','--name',container,'-i','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','1536m','--cpus','1.5','--pids-limit','128','--shm-size','256m','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--user','1000:1000',config.rendererImage];
  const input=JSON.stringify({files:Object.fromEntries(Object.entries(files).map(([p,b])=>[p,b.toString('base64')])),basePath:`/${repo}/`,maxHeight:config.maxScreenshotHeight,viewports:config.renderViewports,auditTileHeight:config.auditTileHeight,fontReadyTimeoutMs:config.fontReadyTimeoutMs,maxTemporalShots:config.maxTemporalShots,...details});
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe'],windowsHide:true,signal});
    const chunks=[];let size=0;const errs=[];
    const timer=setTimeout(()=>child.kill(),config.rendererTimeoutMs);
    child.stdout.on('data',d=>{size+=d.length;if(size>96000000)child.kill();else chunks.push(d);});
    child.stderr.on('data',d=>{if(errs.length<4)errs.push(d.toString().slice(0,1000));});
    child.on('error',()=>{clearTimeout(timer);reject(new Fault('RENDER_RUNTIME','Não foi possível iniciar o renderer Docker isolado.'));});
    child.on('close',async code=>{
      clearTimeout(timer);
      // Killing the CLI is insufficient if an authored script stalls Chromium.
      // Remove only the exact ephemeral container created by this invocation.
      await new Promise(r=>execFile('docker',['rm','--force',container],{timeout:10000,windowsHide:true},()=>r()));
      try {if(code!==0)throw new Fault('RENDER_FAILED','Renderização isolada falhou; publicação bloqueada.',{exitCode:code,stderr:errs.join('')});const value=JSON.parse(Buffer.concat(chunks));must(Array.isArray(value.screenshots)&&value.screenshots.length>=8,'SCREENSHOT_MISSING','Screenshots obrigatórios ausentes.');resolve(value);}catch(e){reject(e);}
    });
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
