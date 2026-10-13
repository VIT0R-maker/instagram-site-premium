import { existsSync } from 'node:fs';
import path from 'node:path';
import { must, hash } from './core.mjs';

// Compatibility names retained for saved jobs. Apify is authoritative by policy.
export { adoptApifyFacts as verifyFacts, apifyLinks as confirmedLinks } from './apify-content.mjs';
function luminance(hex) {
  const v = hex
    .slice(1)
    .match(/../g)
    .map(s => parseInt(s, 16) / 255)
    .map(v =>
      v <= 0.04045
        ? v / 12.92
        : ((v + 0.055) / 1.055) ** 2.4
    );

  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);

  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function fixColors(colors) {
  for (const value of Object.values(colors)) {
    must(
      /^#[0-9a-fA-F]{6}$/.test(value),
      'COLOR',
      'Token de cor inválido.'
    );
  }

  const out = { ...colors };
  const repairs = [];

  for (const [fg, bg, min] of [
    ['text', 'background', 4.5],
    ['text', 'surface', 4.5],
    ['muted', 'background', 4.5],
    ['muted', 'surface', 4.5],
    ['onAccent', 'accent', 4.5],
    ['focus', 'background', 3]
  ]) {
    if (contrast(out[fg], out[bg]) < min) {
      out[fg] =
        contrast('#111111', out[bg]) >= min
          ? '#111111'
          : '#ffffff';

      repairs.push(`${fg}/${bg}`);
    }
  }

  if (
    contrast(out.text, out.background) < 4.5 ||
    contrast(out.text, out.surface) < 4.5 ||
    contrast(out.muted, out.background) < 4.5 ||
    contrast(out.muted, out.surface) < 4.5
  ) {
    out.surface = out.background;
    out.text =
      contrast('#111111', out.background) >= 4.5
        ? '#111111'
        : '#ffffff';
    out.muted = out.text;

    repairs.push('surface harmonizada para contraste');
  }

  return { colors: out, repairs };
}

export { installFonts } from './resources.mjs';

export function validateBrief(brief, dir, config) {
  must(
    brief.schemaVersion === '2.0' && brief.approved === true,
    'BRIEF_APPROVAL',
    'Briefing sem aprovação.'
  );

  must(
    brief.sections.length > 0,
    'BRIEF_CONTENT',
    'Briefing sem conteúdo. A narrativa não exige sequência universal.'
  );

  const sectionIds = new Set();
  const usedAssets = new Set();

  const claims = new Set(
    brief.evidence.claims
      .filter(c => c.status === 'verified')
      .map(c => c.id)
  );

  const assets = new Set(brief.assets.map(a => a.assetId));
  const links = new Set(brief.links.map(l => l.id));

  for (const s of brief.sections) {
    must(
      /^[a-z][a-z0-9-]{0,40}$/.test(s.id) &&
      !sectionIds.has(s.id),
      'SECTION_ID',
      'Seção com ID inválido/duplicado.'
    );

    sectionIds.add(s.id);

    must(
      s.claimIds.every(id => claims.has(id)) &&
      s.assetIds.every(id => assets.has(id)) &&
      (!s.ctaLinkId || links.has(s.ctaLinkId)),
      'BRIEF_REFERENCE',
      'Referência inexistente no briefing.'
    );

    for (const id of s.assetIds) {
      usedAssets.add(id);
    }
  }

  must(
    brief.navigation.every(n => sectionIds.has(n.sectionId)),
    'NAVIGATION',
    'Âncora de navegação inexistente.'
  );

  must(
    brief.sections.some(s => s.ctaLinkId),
    'CTA_MISSING',
    'Briefing sem CTA funcional.'
  );

  must(
    brief.assets.every(
      a =>
        a.priority !== 'essential' ||
        a.role === 'logo' ||
        usedAssets.has(a.assetId)
    ),
    'ASSET_UNUSED',
    'Recurso essencial sem destino; recomendados/opcionais podem ser dispensados.'
  );

  for (const a of brief.assets) {
    for (const v of a.variants) {
      must(
        existsSync(path.join(dir, 'site', v.path)),
        'ASSET_MISSING',
        'Arquivo selecionado ainda não existe.'
      );
    }
  }

  must(
    brief.assets.reduce(
      (n, a) =>
        n + a.variants.reduce((s, v) => s + (v.bytes || 0), 0),
      0
    ) < config.maxPublicBytes * 0.85,
    'ASSET_BUDGET',
    'Variantes selecionadas excedem orçamento público; reveja seleção antes da geração.'
  );

  const colors = brief.brand.colors;

  must(
    contrast(colors.text, colors.background) >= 4.5 &&
    contrast(colors.text, colors.surface) >= 4.5 &&
    contrast(colors.onAccent, colors.accent) >= 4.5,
    'CONTRAST',
    'Tokens sem contraste mínimo.'
  );

  must(
    brief.assets.length <= config.maxSiteImages,
    'ASSET_LIMIT',
    'Quantidade final excede o limite.'
  );

  must(
    Buffer.byteLength(JSON.stringify(brief)) <
      config.claudeInputBytes - 6000,
    'BRIEF_SIZE',
    'Briefing grande demais para a geração reservada.'
  );

  return hash(brief);
}
