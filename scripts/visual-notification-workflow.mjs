// Also applied by build-workflow so a regenerated export retains the reporting policy.
export function installAuditNotifications(workflow) {
  for (const [kind, target, x] of [['resultado','Telegram — resultado verificado',9500],['diagnóstico','Telegram — diagnóstico',4400]]) {
    const prepare = `Preparar ${kind} e relatório`, loop = `Partes do ${kind}`, wait = `Intervalo do ${kind}`;
    if (workflow.nodes.some(n => n.name === prepare)) continue;
    const terminal = workflow.nodes.find(n => n.name === target);
    if (!terminal) throw Error(`Nó ausente: ${target}`);
    for (const connection of Object.values(workflow.connections)) for (const branch of connection.main || []) for (const edge of branch || []) if (edge.node === target) edge.node = prepare;
    const summary = kind === 'diagnóstico'
      ? "'Não foi possível concluir. Etapa: ' + j.stage + '\\n' + j.message + '\\nJob: ' + j.jobId + '\\nRecuperação: /retomar ' + j.jobId"
      : 'j.message';
    const code = `const j = $input.first().json;
const texts = [${summary}, ...(j.auditMessages || [])];
const out = [];
for (const text of texts) {
  let part = '';
  for(const char of String(text || '')){
    if(part.length + char.length > 3400){out.push({json:{chatId:j.chatId,message:part}});part='';}
    part += char;
  }
  if(part)out.push({json:{chatId:j.chatId,message:part}});
}
return out;`;
    workflow.nodes.push(
      {id:`audit-notes-${kind}`,name:prepare,type:'n8n-nodes-base.code',typeVersion:2,position:[x,700],parameters:{jsCode:code}},
      {id:`audit-parts-${kind}`,name:loop,type:'n8n-nodes-base.splitInBatches',typeVersion:3,position:[x+220,700],parameters:{batchSize:1,options:{}}},
      {id:`audit-wait-${kind}`,name:wait,type:'n8n-nodes-base.wait',typeVersion:1.1,position:[x+440,700],parameters:{resume:'timeInterval',amount:1,unit:'seconds'}}
    );
    const edge = node => ({node,type:'main',index:0});
    workflow.connections[prepare]={main:[[edge(loop)]]};
    workflow.connections[loop]={main:[[],[edge(wait)]]};
    workflow.connections[wait]={main:[[edge(target)]]};
    workflow.connections[target]={main:[[edge(loop)]]};
    terminal.parameters.text='={{ $json.message }}';
    terminal.position=[x+660,700];
  }
  // Explicit HTML with escaped dynamic content prevents Telegram entity errors.
  for (const node of workflow.nodes.filter(n => n.type === 'n8n-nodes-base.telegram')) {
    const text = node.parameters.text;
    if (node.parameters.additionalFields?.parse_mode === 'HTML' && text.includes("replace(/&/g")) continue;
    if (typeof text !== 'string' || !text.startsWith('={{') || !text.endsWith('}}')) continue;
    node.parameters.text = '={{ String((' + text.slice(3,-2).trim() + ') ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") }}';
    node.parameters.additionalFields = {...node.parameters.additionalFields,parse_mode:'HTML'};
  }
  return workflow;
}
