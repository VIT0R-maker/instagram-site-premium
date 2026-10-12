# Validação atual — versão 3, 12/10/2026

**57 testes automatizados aprovados, zero falhas.** Renderer exercitado em Chromium real com fixtures controladas. Não foram realizadas chamadas reais Apify/Gemini/Claude, mensagens Telegram ou publicações GitHub nesta revisão. As notas e propostas de patch das fixtures são mocks, não uma avaliação estética real dos modelos.

## Resultados atuais

| Verificação | Resultado e evidência |
|---|---|
| Suíte de código | 57/57 aprovados: `evidencias/v3/testes.tap`. |
| Workflow e sintaxe | 58 nós, 47 origens de conexão, um nó Claude sem retry/ciclo de retorno; `evidencias/v3/estrutura.json`. |
| JSON versus gerador | Igualdade byte a byte por `node scripts/build-workflow.mjs --check`, incluída em `npm run check`. IDs determinísticos e finais de linha controlados. |
| Concorrência | 40 promessas e oito processos inicializando o mesmo banco novo; contador simulado de geração = 1. O erro anterior `database is locked` não ocorreu após o ajuste. |
| Estado e recuperação | Retomada torna a primeira etapa recuperável executável; concluídas ficam intactas. Testes de publicação falha, geração com resposta salva, ambiguidade e queda de processo. |
| Referências | Payload multimodal inspecionado nos testes, todas as imagens selecionadas exigidas por ID/hash; logo/essenciais preservados pela seleção. |
| Stream/JSON | SSE completo aceito; erro explícito e resposta parcial bloqueados sem segunda geração. Gemini JSON inválido tem um reparo limitado. |
| Curadoria/briefing | 11→10 recursos sem esvaziar galeria; logo preservada; rejeitadas bloqueadas; crops mobile/desktop; direção inválida reavaliada; estrutura sem sequência universal; revisão de dependências. |
| Fontes | Vinte famílias verificadas/instaladas no teste com licença, subconjuntos, pesos e estilos reais. |
| Browser comparativo | Chromium 156.0.8078.4 local, DPR 1, pt-BR, America/Sao_Paulo. 320/390/768/1440, normal e reduced; desktop sem toque como contexto principal. |
| Antes/depois | Mesma fixture e job: baseline reprovada; seis patches fixos simulados; final aprovada pelo navegador. 37 capturas iniciais e 35 finais, 9 verificações por versão e 36 caminhos de interação na final. |
| Página longa/adicional | Duas páginas, 10 verificações, 58 capturas. Página principal com 14 seções e 9.871 px, faixas contíguas até o rodapé em 320/1440 e ambos os modos. `evidencias/v3/pagina-longa.json`. |
| Gate visual/semântico | Falha high impede nota 97; afirmação sem fonte impede sucesso técnico; nota baixa pode gerar patch e nova avaliação. Problema no último lote visual não é apagado pela consolidação. |
| Publicação | APIs simuladas verificam commit, bytes, fontes/JS/SVG/imagens, subcaminho, build, propagação, 404 e retomada sem novo repo/Claude. |
| Dependências | Instalação com versões fixadas/lockfile; npm reportou zero vulnerabilidades na instalação realizada. |
| Build worker/renderer v3 | **Não concluído:** ambos retornaram exit 1 porque `dockerDesktopLinuxEngine` está indisponível. Saída em `evidencias/v3/build-docker.json`. |
| n8n atual | Validação estrutural realizada; importação/execução v3 no contêiner e na instância do usuário permanecem pendentes. |

O teste de SQLite foi realizado no Windows/Node 24.14.1 disponível. A implantação suportada continua sendo um worker por volume local Docker/Linux. Os oito processos testam contenção e reserva; não autorizam múltiplos servidores por volume. A confirmação no ambiente Linux de implantação permanece pendente junto do build.

## O que as capturas mostram

Abra [a comparação interativa](evidencias/v3/comparacao.html). O título mobile deixa de ampliar o viewport; o CTA passa de 32 para 48 px; o recipiente e sua tampa aparecem sem o corte anterior; a lightbox mantém o foco. Dobra inicial tem scroll zero verificado antes/depois da captura. Todas as larguras finais passaram pelos checks aplicáveis, incluindo axe e movimento reduzido.

O Chromium executou código real de fixture, mouse, teclado e toque. A fotografia é CC0, de BabelStone/Wikimedia, usada somente como material de teste e nunca como foto de produção ou fallback. A versão inicial recebeu 80 e a final 91 **no mock**; esses números não provam melhoria estética. As alterações observáveis nos screenshots e os defeitos detectados pelo browser são a evidência técnica.

As faixas são pareadas por página/largura/modo/y, e não por índice arbitrário. Uma versão mais curta pode não ter a última faixa da anterior. DPR/dispositivo são iguais; a baseline com overflow pode provocar zoom automático no browser mobile, registrado nos metadados. O teste não esconde essa falha ajustando o layout antes de capturar.

Medições rAF/animação são diagnósticas em ambiente virtualizado. Não certificam fluidez de todo aparelho nem substituem observação de movimento em uso real. Axe não resolve sozinho contraste sobre fotografias ou toda a acessibilidade.

## Pendências externas exatas

1. Fazer o daemon Docker Linux funcionar no host escolhido e executar os dois builds, renderer isolado e smoke de importação/orquestração n8n. Não foi feito reset do Docker, exclusão de volumes nem substituição de configuração global.
2. Configurar `.env`, credenciais Telegram/Header Auth no n8n, URL do worker, IDs autorizados e repositório descartável de prova. Confirmar modelos/cotas reais no preflight.
3. Executar um pedido intencional com um perfil público real, avaliando seleção, briefing, a única criação Claude e a auditoria Gemini. Não há avaliação artística real do sistema multínicho nesta sessão.
4. Confirmar as URLs reais de repositório/Pages e a inspeção pública complementar. Nenhuma URL de site gerado é inventada nesta entrega; o workflow produz esses valores durante execução bem-sucedida.

O caminho nativo `--local-fixture` nunca é usado como fallback de produção para código gerado. A ausência de Docker não foi contornada removendo isolamento do caminho principal.

## Reprodução

```powershell
npm ci
npm test
npm run check
node scripts/render-comparison.mjs --local-fixture
node scripts/render-coverage.mjs
node scripts/collect-evidence.mjs
```

Com Docker disponível: `docker compose --profile build build renderer-image worker`, `npm run test:render`, `npm run test:n8n`. Depois siga o README para ativação e `AVALIACAO_VISUAL.md` para avaliação real autorizada.

Arquivos em `evidencias/` fora de `v3/` são **históricos**. A prova antiga de importação n8n/Docker v1 e a suíte intermediária v2 com 41/42 não são apresentadas como validação do pacote atual.
