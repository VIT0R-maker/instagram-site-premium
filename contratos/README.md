# Contratos executáveis

Gerados de `src/contracts.mjs` por `node scripts/export-contracts.mjs`. Ajv aplica o contrato completo localmente. Para Gemini, somente a versão compatível de JSON Schema é enviada à API; a resposta continua sujeita à validação local integral.

O envelope de criação é v2: `files` com caminhos autorais explícitos e `interactions` privado. Requer `index.html`, ao menos um CSS e todos os JS/SVG/HTML utilizados. `assets/` e `lib/` são preparados pelo worker, não gerados livremente. O envelope factual conserva `schemaVersion=1.0`, com os novos tipos `product`, `offer` e `shop`.

Cada interação declara página, intervalo de largura e cenários keyboard/pointer/touch. Ações são dados (seletores, teclas e expectativas), nunca código de teste enviado para eval. `check` verifica estado/foco sem alterá-lo. Os scripts autorais da página são executados exclusivamente no renderer isolado de produção.

Fatos e fotos são acompanhados de proveniência no briefing privado. Os schemas não provam veracidade sozinhos: confirmação de fontes, hashes, inspeção visual e revisão semântica integram o gate de aprovação.
