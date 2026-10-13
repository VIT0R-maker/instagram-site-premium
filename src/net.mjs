import https from 'node:https';
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { must, Fault, sleep } from './core.mjs';

export function publicIP(address) {
  let ip = ipaddr.parse(address);
  if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
  return ip.range() === 'unicast';
}
export function allowedURL(raw, allowed) {
  const u = new URL(raw);
  must(u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && !u.hash, 'URL_POLICY', 'URL fora da política de rede.');
  must(allowed.some(h => h.startsWith('*.') ? u.hostname.endsWith(h.slice(1)) && u.hostname !== h.slice(2) : u.hostname === h), 'URL_HOST', 'Host fora da lista permitida.');
  return u;
}
export async function request(raw, { method='GET', headers={}, body, timeout=60000, maxBytes=22000000, hosts, signal } = {}) {
  const u = allowedURL(raw, hosts || []);
  const records = await dns.lookup(u.hostname,{ all: true });
  must(records.length && records.every(r => publicIP(r.address)), 'SSRF', 'Destino privado, local ou reservado bloqueado.');
  const pinned = records[0];
  const wire = body == null ? undefined : Buffer.from(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  return await new Promise((resolve,reject) => {
    const req = https.request(u,{ method, signal, headers: { 'User-Agent':'InstagramSitePremium/1.0', ...(wire ? {'Content-Type':'application/json','Content-Length':wire.length} : {}), ...headers },
      lookup: (_name, options, callback) => options.all ? callback(null,[pinned]) : callback(null,pinned.address,pinned.family) }, res => {
      let size=0; const chunks=[];
      res.on('data', chunk => { size += chunk.length; if (size > maxBytes) req.destroy(new Fault('PAYLOAD_LIMIT','Resposta excedeu o limite de bytes.')); else chunks.push(chunk); });
      res.on('error',reject);
      res.on('end',() => resolve({ status:res.statusCode, headers:res.headers, bytes:Buffer.concat(chunks), get text(){return this.bytes.toString('utf8');} }));
    });
    const timer=setTimeout(() => req.destroy(new Fault('HTTP_TIMEOUT','Prazo da requisição excedido.')),timeout);
    req.on('close',() => clearTimeout(timer)); req.on('error',reject); if(wire) req.write(wire); req.end();
  });
}
export function retryDelay(header, attempt) {
  const seconds=Number(header); const parsed=Date.parse(header);
  return Math.min(60000, Math.max(0, header ? (Number.isFinite(seconds) ? seconds*1000 : (Number.isFinite(parsed) ? parsed-Date.now() : 0)) : 0, 1000 * 2 ** attempt));
}
// Mensagem de erro devolvida pela API (curta e com segredos mascarados) para facilitar o diagnóstico.
function apiErrorDetail(r) {
  try {
    const j=JSON.parse(r.text);
    const m=j?.error?.message ?? j?.message ?? (typeof j?.error==='string' ? j.error : '');
    return String(m).replace(/(AIza|AQ\.|sk-ant-|ghp_|github_pat_|apify_api_|nvapi-)[A-Za-z0-9._-]+/g,'[redigido]').replace(/\s+/g,' ').slice(0,300);
  } catch { return ''; }
}
export async function api(raw, opts={},transport=request,wait=sleep) {
  const attempts=opts.attempts ?? (opts.method && opts.method !== 'GET' ? 1 : 3);
  for(let i=0;i<attempts;i++) {
    let r;
    try { r=await transport(raw,opts); } catch(e) { if(i+1===attempts || e instanceof Fault && e.code !== 'HTTP_TIMEOUT' || opts.signal?.aborted) throw e; await wait(retryDelay(null,i)); continue; }
    if(r.status >= 200 && r.status < 300) {
      if(!r.bytes.length) return {data:null,headers:r.headers,status:r.status};
      let data; try {data=JSON.parse(r.text);} catch {throw new Fault('API_JSON','A API devolveu JSON inválido.');}
      return {data,headers:r.headers,status:r.status};
    }
    if(opts.accept?.includes(r.status)) return {data:null,headers:r.headers,status:r.status};
    if(![429,500,502,503,504].includes(r.status) || i+1===attempts) {
      const d=apiErrorDetail(r);
      throw new Fault(`HTTP_${r.status}`,`A API ${new URL(raw).hostname} respondeu HTTP ${r.status}.${d?` Detalhe: ${d}`:''}`, {status:r.status});
    }
    await wait(retryDelay(r.headers['retry-after'],i));
  }
}
export async function download(raw,config,signal,hosts=['*.cdninstagram.com','*.fbcdn.net','instagram.com','www.instagram.com']) {
  let url=raw;
  for(let redirect=0;redirect<4;redirect++) {
    for(let i=0;i<config.apiAttempts;i++) {
      const r=await request(url,{hosts,signal,maxBytes:config.maxDownloadBytes,timeout:30000});
      if([301,302,303,307,308].includes(r.status)) { must(r.headers.location,'REDIRECT','Redirecionamento sem destino.'); url=new URL(r.headers.location,url).href; break; }
      if(r.status===200) return r.bytes;
      if(![429,500,502,503,504].includes(r.status) || i+1===config.apiAttempts) throw new Fault('DOWNLOAD',`Download respondeu HTTP ${r.status}.`);
      await sleep(retryDelay(r.headers['retry-after'],i));
    }
  }
  throw new Fault('REDIRECT_LIMIT','Redirecionamentos em excesso.');
}
