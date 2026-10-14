// The full collection and full briefing remain in private job checkpoints.
// This projection changes transport redundancy, never business values or assets.
export function compactBrief(full) {
  const brief=structuredClone(full);
  if(brief.evidence) {
    brief.evidence.sources=(brief.evidence.sources||[]).map(({id,url,date})=>({id,url,date}));
    brief.evidence.claims=(brief.evidence.claims||[]).map(c=>{
      const out={...c};
      delete out.quote;
      if(out.normalized===out.original)delete out.normalized;
      return out;
    });
  }
  if(brief.authoritativeContent) {
    // The complete bio and its line coverage remain. Profile values also live
    // in deterministic claims, so the copied source list is redundant here.
    delete brief.authoritativeContent.sources;
  }
  return brief;
}
export function briefSizeReport(full,compact,config) {
  const bytes=v=>Buffer.byteLength(JSON.stringify(v));
  return {fullBytes:bytes(full),compactBytes:bytes(compact),limitBytes:config.claudeInputBytes-6000,
    components:Object.fromEntries(Object.entries(compact).map(([key,value])=>[key,bytes(value)]).sort((a,b)=>b[1]-a[1]))};
}
