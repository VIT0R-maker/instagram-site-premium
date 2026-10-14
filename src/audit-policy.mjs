export const AUDIT_POLICY = 'visual-score-v1';
// Never publish credentials or allow paths outside the public package.
export const unsafePublication = diagnostic => diagnostic.issues.some(i => ['SECRET', 'PUBLIC_PATH'].includes(i.code));
const criteria = ['identity', 'composition', 'spacing', 'typography', 'images', 'responsiveness'];

export function visualScore(audit) {
  const values = criteria.map(k => audit?.rubric?.[k]);
  return values.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)
    ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// Old reports are reusable only with their exact saved file hashes. Approval itself
// verifies every snapshot byte before copying that version to the publication folder.
export function savedVisualCandidates(cp, config) {
  const result = [];
  for (let round = 0; round <= 8; round++) {
    const report = cp(`audit-${round}`), score = visualScore(report?.audit);
    if (score !== null && score >= config.qualityThreshold && report?.deterministic?.fileHashes)
      result.push({round, report, score});
  }
  return result.sort((a, b) => b.score - a.score || b.round - a.round);
}

export function auditNotes(report, round, threshold, limitations = []) {
  const a = report.audit, score = visualScore(a);
  const lines = [`RELATÓRIO DA AUDITORIA — rodada ${round}`, `Nota visual: ${score?.toFixed(2) ?? 'indisponível'}/100. Mínimo: ${threshold}.`,
    'Política: somente a nota visual decide a aprovação de qualidade. As observações abaixo são recomendações; não são vetos.',
    `Critérios: ${criteria.map(k => `${k}: ${a.rubric[k]}`).join('; ')}.`,
    `Testes do navegador: ${report.render?.skipped ? 'não executados: ' + report.render.skipped : report.render?.passed ? 'aprovados' : 'com pendências'}.`,
    `Avaliação semântica: ${a.semanticReview?.approved ? 'aprovada' : 'com observações (não bloqueia)'}.`];
  const details = [];
  for (const i of a.issues || []) details.push(`[${i.severity}] ${i.component} — ${i.viewport}\n${i.description}\nEvidência: ${i.evidence}\nSugestão: ${i.fix}`);
  for (const i of report.deterministic?.issues || []) details.push(`[${i.code}] ${i.file || ''} / ${i.component || ''}\n${i.message}`);
  for (const t of report.render?.tests || []) {
    for (const e of t.errors || []) details.push(`[Navegador ${t.width}px / ${t.motion || ''} / ${t.page || ''}] ${typeof e === 'string' ? e : JSON.stringify(e)}`);
  }
  for (const c of a.semanticReview?.unsupportedClaims || []) details.push('[Observação de conteúdo] ' + JSON.stringify(c));
  for (const c of a.semanticReview?.equivalentCopy || []) details.push('[Conteúdo preservado] ' + c);
  for (const l of limitations) details.push('[Limitação informada] ' + l);
  const unique = new Map();
  for (const d of details) unique.set(d, (unique.get(d) || 0) + 1);
  lines.push(...[...unique].map(([d, count]) => d + (count > 1 ? `\nRepetições no relatório: ${count}.` : '')));
  if (!details.length) lines.push('Nenhuma observação adicional registrada.');
  return lines.join('\n\n');
}

// Plain text chunks; n8n escapes HTML only after splitting. No dropped details.
export function telegramChunks(text, max = 3400) {
  const chunks = [];let part='';
  for(const char of String(text)){if(part.length+char.length>max){chunks.push(part);part='';}part+=char;}
  if(part)chunks.push(part);
  return chunks.map((part, i) => `Auditoria — parte ${i + 1}/${chunks.length}\n${part}`);
}
