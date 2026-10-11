import { randomUUID } from 'node:crypto';
import { request } from './net.mjs';
import { must, Fault, hash, sleep } from './core.mjs';

export async function publicationPreflight(p) {
  const {data:user,headers}=await p.github('/user');
  must(user.type==='User'&&/^[a-zA-Z0-9-]+$/.test(user.login),'GITHUB_OWNER','É necessária uma conta pessoal GitHub autenticada.');
  const scopes=String(headers['x-oauth-scopes']||'').split(',').map(x=>x.trim());
  must(scopes.includes('public_repo')||scopes.includes('repo'),'GITHUB_SCOPE','Use PAT clássico com public_repo (ou repo). Acesso com token fine-grained não foi habilitado nesta versão.');
  const name=p.env.GITHUB_PROBE_REPO;
  must(/^[a-zA-Z0-9_.-]+$/.test(name||''),'GITHUB_PROBE','Configure o repositório descartável GITHUB_PROBE_REPO antes da geração.');
  const base=`/repos/${user.login}/${name}`;const {data:repo}=await p.github(base);
  must(repo.owner.login===user.login&&!repo.private&&repo.description==='instagram-site-premium permission probe'&&repo.permissions?.admin&&repo.permissions?.push,'GITHUB_PROBE','Repositório de prova sem marcador/permissões exigidos.');
  const old=await p.github(base+'/contents/permission-check.txt',{accept:[404]});
  await p.github(base+'/contents/permission-check.txt',{method:'PUT',body:{message:'chore: verify publisher permission',content:Buffer.from('Permission check '+new Date().toISOString()+'\n').toString('base64'),...(old.data?.sha?{sha:old.data.sha}:{})}});
  const current=await p.github(base+'/pages',{accept:[404]});
  if(current.status===404)await p.github(base+'/pages',{method:'POST',body:{build_type:'legacy',source:{branch:repo.default_branch,path:'/'}}});
  else await p.github(base+'/pages',{method:'PUT',body:{build_type:'legacy',source:{branch:repo.default_branch,path:'/'}}});
  const confirmed=await p.github(base+'/pages');must(confirmed.data?.html_url,'GITHUB_PAGES_PERMISSION','Permissão Pages não confirmada.');
  return {owner:user.login,credentialMode:'classic-pat',scopes,probe:name};
}

export async function publishSite(p,files,approval,publicRequest=request,wait=sleep) {
  const {store,job,config}=p;
  const fileHashes=Object.fromEntries(Object.entries(files).map(([f,b])=>[f,hash(b)]));
  must(approval?.approved&&hash(fileHashes)===approval.filesHash,'QUALITY_GATE','Arquivos diferem da versão aprovada.');
  const owner=store.checkpoint(job.id,'preflight').owner,repo=job.repo;
  const base=`/repos/${owner}/${repo}`;
  let intent=store.checkpoint(job.id,'repoIntent');
  if(!intent){intent={marker:randomUUID()};store.checkpoint(job.id,'repoIntent',intent);}
  const description=`Site de @${job.username} | managed-site:${intent.marker}`;
  let result=await p.github(base,{accept:[404]});
  if(result.status===404) {
    try { result=await p.github('/user/repos',{method:'POST',body:{name:repo,description,private:false,auto_init:true,has_issues:false,has_projects:false,has_wiki:false}}); }
    catch(e) {const reconciled=await p.github(base,{accept:[404]});if(reconciled.status===404)throw e;result=reconciled;}
  }
  must(result.data?.owner?.login===owner&&result.data?.description===description,'REPO_CONFLICT','Repositório existente não pertence a este trabalho; nenhuma sobrescrita foi feita.');
  const branch=result.data.default_branch;
  const repoInfo={url:result.data.html_url,owner,repo,branch};store.checkpoint(job.id,'repository',repoInfo);
  const refRoute=base+'/git/ref/heads/'+encodeURIComponent(branch);
  const current=(await p.github(refRoute)).data.object.sha;
  let origin=store.checkpoint(job.id,'baseCommit');if(!origin){origin=current;store.checkpoint(job.id,'baseCommit',origin);}
  let commit=store.checkpoint(job.id,'siteCommit');
  if(!commit) {
    must(current===origin,'REPO_CHANGED','Branch alterada externamente antes da publicação.');
    const tree=[];
    for(const [file,bytes] of Object.entries(files)) {
      const key='blob:'+hash(bytes);let sha=store.checkpoint(job.id,key);
      if(!sha){sha=(await p.github(base+'/git/blobs',{method:'POST',body:{content:bytes.toString('base64'),encoding:'base64'}})).data.sha;store.checkpoint(job.id,key,sha);}
      tree.push({path:file,mode:'100644',type:'blob',sha});
    }
    // Deliberately no base_tree: the resulting tree contains only approved public files.
    let treeSha=store.checkpoint(job.id,'siteTree');
    if(!treeSha){treeSha=(await p.github(base+'/git/trees',{method:'POST',body:{tree}})).data.sha;store.checkpoint(job.id,'siteTree',treeSha);}
    commit=(await p.github(base+'/git/commits',{method:'POST',body:{message:'feat: publish verified website',tree:treeSha,parents:[origin]}})).data.sha;
    store.checkpoint(job.id,'siteCommit',commit);
  }
  if(current!==commit) {
    must(current===origin,'REPO_CHANGED','Branch alterada; publicação interrompida sem force push.');
    try{await p.github(base+'/git/refs/heads/'+encodeURIComponent(branch),{method:'PATCH',body:{sha:commit,force:false}});}
    catch(e){const check=(await p.github(refRoute)).data.object.sha;if(check!==commit)throw e;}
  }
  const pg=await p.github(base+'/pages',{accept:[404]});
  if(pg.status===404) {
    try{await p.github(base+'/pages',{method:'POST',body:{build_type:'legacy',source:{branch,path:'/'}}});}
    catch(e){if((await p.github(base+'/pages',{accept:[404]})).status===404)throw e;}
  } else must(pg.data.source?.branch===branch&&pg.data.source?.path==='/','PAGES_CONFIG','Pages existente usa outra origem.');
  const deadline=Date.now()+config.pagesPollingDeadline*1000;let attempts=0,last='pending';
  while(Date.now()<deadline) {
    attempts++;
    const pages=(await p.github(base+'/pages')).data;
    const build=await p.github(base+'/pages/builds/latest',{accept:[404]});
    const built=build.data?.commit===commit&&build.data?.status==='built';
    if(build.data?.commit===commit&&build.data?.status==='errored')throw new Fault('PAGES_BUILD','Arquivos publicados no repositório, mas o build Pages falhou.');
    if(built) {
      const u=new URL(pages.html_url);
      must(u.protocol==='https:'&&u.hostname===owner.toLowerCase()+'.github.io'&&u.pathname===`/${repo}/`,'PAGES_URL','Pages retornou URL inesperada; domínio personalizado não é suportado nesta versão.');
      let complete=true;
      for(const [file,bytes]of Object.entries(files)) {
        if(file==='.nojekyll'||file==='README.md'||file.endsWith('.txt'))continue;
        const response=await publicRequest(new URL(file,u).href,{hosts:[u.hostname],maxBytes:config.maxPublicBytes,timeout:20000,signal:p.signal});
        if(response.status!==200||hash(response.bytes)!==hash(bytes)){complete=false;last=`propagating:${file}`;break;}
      }
      if(complete) {
        const final={status:'published',repoUrl:repoInfo.url,siteUrl:u.href,commit,attempts,verifiedAt:new Date().toISOString(),filesVerified:Object.keys(files).length};
        store.checkpoint(job.id,'publication',final);return final;
      }
    }else last=build.data?.status || 'pending';
    store.event(job.id,'pages_poll',{attempt:attempts,status:last,commit});await wait(Math.min(15000,2000*1.5**Math.min(attempts,5)));
  }
  throw new Fault('PAGES_PENDING','O repositório está pronto, mas build/propagação/verificação Pages não concluiu no prazo. Retome somente a publicação.');
}
