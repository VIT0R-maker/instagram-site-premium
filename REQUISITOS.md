# Atendimento ao documento de correções

Esta matriz distingue implementação de comprovação em produção. “Implementado” não significa que um site real foi gerado com contas externas nesta sessão.

| Requisito | Implementação e verificação |
|---|---|
| Fotos reais; sem geração raster IA | Removidas opções da configuração ativa e propostas antigas. Coleta/curadoria só usam Apify. SVG/CSS decorativos continuam válidos. Migração com backup disponível. |
| Liberdade criativa | `contracts`, `prompts`, `validate-site`, renderer e publicação aceitam HTML/CSS/JS/SVG, fundos, máscaras, reuso funcional e múltiplos arquivos. Fixture comprova JS, SVG, foto CSS, thumbnail/lightbox e fontes. |
| Uma criação Claude | Ledger SQLite, reserva antes de enviar, sem retry, sem continuação e recuperação de resposta persistida mantidos. Testes concorrentes e de timeout passaram. Models/count_tokens não geram conteúdo. |
| Arquitetura necessária | Matriz em `ARQUITETURA.md`, com inspeção local e limites do ambiente. Nenhuma migração de componentes sem ganho comprovado. |
| Coleta e curadoria amplas | IDs, carrosséis, deduplicação, lotes e finais preservados. Expansão agora reinterpreta fatos com as novas fontes; teste cobre a regressão. |
| Claude recebe pixels | `vision.mjs` prepara referências reais por ID/hash. `Providers.claude` exige todas, usa base64 no mesmo `/messages`, valida visão, bytes, contagem de tokens e saída antes da reserva. Testes inspecionam o corpo multimodal simulado. |
| Briefing com três classes | `constraints.immutable`, `qualityRequired`, `creativeFreedom`; direção não obriga template/contagem de seções. |
| Tipografia e biblioteca | Oito famílias OFL, combinações flexíveis, subconjuntos latinos/acentos, pesos e fallback. Anime.js 3.2.2/MIT opcional e justificado, instalado previamente. Hashes de recursos preservados. |
| Segurança proporcional | Caminhos/segredos/origem e recursos externos são controlados. Execução em navegador isolado; não há proibição genérica de estética/tags como substituto de avaliação visual. |
| Produto/oferta | Schema factual e `verifyFacts` aceitam product/service/offer comprovados; teste. |
| Site/loja comprovados | `confirmedLinks` inclui websites/shops verificados com URLs exatas e rótulos próprios; teste. |
| SEO efetivo | Canonical, OG e Organization factual finalizados por página antes de inspeção/hash; idempotência e ausência de endereço/classificação inventados testadas. |
| Erros recuperáveis | Diagnósticos estruturados chegam à auditoria. JS/CSS que não podem executar são reparados primeiro; dimensões/atributos podem ser vistos no browser. Segredo/estrutura truncada não entram num pedido de reconstrução. |
| Texto flexível | Sem whitelist de frases literais. Extração de copy e texto renderizado alimentam revisão semântica obrigatória com evidências. Teste comprova bloqueio quando o auditor reporta afirmação sem fonte. |
| Browser útil | Quatro larguras × dois modos, screenshots de dobra/página/detalhe, início de movimento e rAF, axe, âncoras, CTA, imagens e cenários reais de teclado/mouse/toque. Fixture com defeitos é recusada e a versão corrigida é retestada. |
| Reparos delimitados | Arquivo/âncora/hash, orçamento por rodada/acumulado, snapshots privados e rodadas persistidas. Sem retorno ao Claude e sem rollback por pequena oscilação de nota. |
| Comparação honesta | Mesma fixture/job, uma geração simulada, baseline sem patch e final. Fotografias reais CC0 somente de teste. Notas/patches de Gemini são mocks; capturas e comportamento Chromium são reais. Ver `VALIDACAO.md`. |
| Prompts completos | Reescritos em `src/prompts.mjs`, exportados em `PROMPTS.md`; schemas em `contratos/`. |
| Publicação de todos os arquivos | Pacote aprovado inclui JS/SVG/fontes/recursos; hashes/paths mantidos no commit e verificação Pages. Retomada não altera o pacote. Provedor GitHub foi simulado nos testes. |

## Confirmações que ainda exigem o ambiente do usuário

- Construir e executar imagens Docker v2 após o daemon voltar a funcionar.
- Importar e executar o JSON revisado na instância n8n do usuário. A estrutura foi checada localmente; a importação v1 em n8n 2.41.6 é evidência histórica, não nova execução v2.
- Executar um perfil real com Apify/Gemini/Claude e verificar o resultado visual, o repositório e Pages nas contas configuradas. Nenhum crédito ou publicação real foi usado nesta revisão.
- A qualidade artística e a revisão semântica continuam dependendo do acervo e das respostas reais dos modelos. Suíte verde não certifica “site excepcional” para todo perfil.
