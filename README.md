# Instagram → Site Premium — versão 3

Sistema n8n + worker Node.js + Chromium isolado que transforma um perfil público em um site específico para o negócio. Gemini prepara fatos, curadoria visual, direção e briefing; Claude recebe os pixels selecionados e cria **uma única vez**; o site passa por renderização, auditoria, correções e publicação verificada no GitHub Pages.

**O JSON não é autossuficiente:** importe o workflow e instale o worker e o renderer deste mesmo pacote. A configuração exige suas credenciais. A execução real com provedores e o build Docker final ainda precisam ser validados no host de implantação; veja [VALIDACAO.md](VALIDACAO.md).

## Instalar e iniciar

1. Instale Node.js 24.14 ou superior dentro da linha 24 para os utilitários locais e Docker com contêineres Linux. O export usa somente nós nativos, com n8n 2.41.6 como referência. Reserve aproximadamente 4 GB além dos recursos do n8n.
2. Abra um terminal nesta pasta e execute `node scripts/init-env.mjs`. Ele cria `.env` e dois segredos aleatórios sem imprimi-los; não sobrescreve um arquivo existente.
3. Preencha as credenciais da tabela abaixo e prepare o repositório descartável de prova de publicação.
4. Construa os componentes e inicie o worker:

```powershell
docker compose --profile build build renderer-image worker
docker compose up -d worker
docker compose logs --tail 30 worker
```

5. Importe [workflow_instagram_site_premium.json](workflow_instagram_site_premium.json) no n8n. Em **Contexto — um evento por execução**, ajuste `workerBaseUrl`. O padrão `http://host.docker.internal:8787` atende Docker Desktop. n8n em outro host/Cloud exige URL HTTPS acessível e proxy autenticado.
6. Cadastre **Header Auth** com Name `Authorization` e Value `Bearer <WORKER_TOKEN>`. Associe a credencial aos nós HTTP e selecione a credencial Telegram nos nós correspondentes. As referências de credenciais do export não incluem os segredos.
7. Desative o workflow antigo do mesmo bot antes de ativar este. Envie ao bot o link HTTPS de um perfil público. Para recuperar um trabalho existente, envie `/retomar JOB`.

O workflow foi exportado inativo. O ID `IGPremiumSingleClaudeV1` permanece estável para reimportação, embora a implementação seja v3. Não há subworkflow adicional.

| Variável em `.env` | Configuração |
|---|---|
| `WORKER_TOKEN` | Segredo n8n → worker, criado pelo utilitário. |
| `JOB_HMAC_KEY` | Identidade persistente dos eventos. Preserve junto do banco. |
| `ALLOWED_CHAT_IDS` | IDs de chats autorizados, separados por vírgula. |
| `TELEGRAM_BOT_ID` | ID numérico estável do bot; seu token fica no n8n. |
| `GEMINI_API_KEY` | Fatos, imagens, direção, revisão e correções. |
| `ANTHROPIC_API_KEY` | Metadados, contagem de tokens e geração única. |
| `APIFY_TOKEN` | Actor `apify/instagram-scraper`. |
| `GITHUB_TOKEN` | PAT clássico pessoal com `public_repo` ou `repo`. |
| `GITHUB_PROBE_REPO` | Repositório público descartável para comprovar Contents/Pages. |
| `NVIDIA_API_KEY` | Opcional; Nemotron está desligado por padrão. |

O repositório de prova deve pertencer à conta do PAT, ter uma branch inicial e descrição exata `instagram-site-premium permission probe`. O preflight escreve `permission-check.txt` e configura Pages nele antes de consumir Claude. Use um repositório descartável. Organização, GitHub App, PAT fine-grained e domínio personalizado não são suportados nesta edição.

## Como a qualidade é tratada

- Fotografias reais do Apify, carrosséis expandidos, downloads verificados, SHA para duplicatas exatas e sem descarte automático por semelhança perceptual. A expansão atualiza fatos e reutiliza avaliações visuais ainda válidas.
- Curadoria recebe pixels e contexto. Logo tem tratamento institucional; seleção global preserva essenciais e pode remover opcionais sem esvaziar a galeria. Hero tipográfico é permitido.
- Regiões protegidas e geometria de recorte chegam ao briefing com propostas distintas para desktop/mobile, alternativas por proporção e variantes locais. O layout pode melhorar as sugestões.
- Três direções precisam diferir estruturalmente. Escolha inválida tem uma reavaliação fundamentada, nunca fallback silencioso para a primeira opção.
- Vinte famílias locais OFL, com pesos e estilos reais, português, fallback e licenças. Apenas as famílias escolhidas são publicadas. O catálogo é extensível em `src/resources.mjs`; não há fonte remota montada por URL.
- Estrutura, ordem de seções, Grid/Flexbox, múltiplas páginas, JS local, SVG, máscaras, fundos, galerias e movimento são permitidos. Anime.js 3.2.2/MIT é opcional e precisa de justificativa. Não existe template HTML universal de produção.
- A revisão pode corrigir fatos, links, seleção, recortes, fontes, direção, estrutura e copy. Refaz somente dependências afetadas antes de Claude.
- O navegador verifica 320/390/768/1440 px, movimento normal/reduzido, contextos mobile e desktop adequados, cenários de teclado/mouse/toque, fontes, foco, CTA, âncoras, imagens e axe. Capturas legíveis cobrem a página até o rodapé, incluindo páginas adicionais; lotes Gemini são consolidados sem ignorar defeitos finais.
- Patches ficam ligados a hash e trecho exato, com histórico e nova renderização. Correção maior pode usar orçamento excepcional justificado; não pode substituir indiscriminadamente o projeto. Manifesto permite corrigir seletores sem apagar obrigações funcionais.
- Publicar exige aprovação técnica, semântica, visual e nota suficiente. Média alta não compensa problema high/critical. Observações menores não geram bloqueio por si só. Sem progresso ou orçamento, os artefatos são preservados e o resultado não é anunciado como sucesso.

Fatos comerciais exigem evidência. Produtos, serviços e outras ofertas são aceitos; Instagram, site, loja e WhatsApp mantêm rótulos e destinos próprios. Não são inventados depoimentos, preços, endereços, resultados, contatos ou logos. Fotografias ausentes não são substituídas por IA.

## Limites configuráveis

| Configuração padrão | Valor |
|---|---|
| Posts inicial/ampliado | 40 / 80 |
| Candidatos inicial/ampliado | 60 / 100 |
| Imagens por lote / finalistas / máximo selecionado | 12 / 32 / 16; valores independentes |
| Referências Claude | Todas as selecionadas, inclusive logo; teto operacional configurável até 64 |
| Referências visuais | WebP até 1280 px, redução controlada até 768 px |
| Corpo Claude / base64 individual | 24 MB / 8 MB |
| Briefing textual / saída | 120 KB / 48.000 tokens; há estimativa por complexidade e confirmação do modelo |
| Claude | Streaming, 300 s, um envio, zero retries/continuações |
| Gemini | 16 MB por requisição, um reparo de JSON, até 180 reservas de tentativas |
| Auditoria visual dividida | Até 12 imagens/lote e 32 lotes por avaliação; nenhuma faixa omitida silenciosamente |
| Cobertura | Faixas de 1200 px; página até 18.000 px por limite operacional explícito |
| Revisões briefing / rodadas de patches | 2 / 4 |
| Aprovação | Média mínima 85 e ausência de impedimentos técnicos/semânticos/visuais |
| Patches regulares | 25% por arquivo/rodada, 45% acumulados, com pequenos pisos absolutos |
| Exceção justificada | Até 75%/rodada e 90% acumulados, preservando fatos, recursos e funcionalidades |
| Prazo/retenção | 3600 s por janela do job / 14 dias de artefatos privados |

São limites operacionais, não limites universais dos provedores nem metas de quantidade. APIs confirmam modelo/capacidades/contexto; a contagem multimodal ocorre antes de gerar. Se o contexto, as referências essenciais ou a saída não couberem, o fluxo interrompe antes de reservar Claude. Pode-se ajustar a configuração antes de um novo trabalho, sem remover silenciosamente fotos essenciais. Não altere modelo/configuração durante um job ativo.

## Geração única, publicação e retomada

SQLite local usa WAL/FULL, `busy_timeout` instalado antes de WAL/DDL e recuperação limitada de contenção na inicialização. A chave HMAC do evento bot/chat/mensagem e a reserva atômica antecedem o único POST de geração. Resposta bruta é persistida antes de interpretar JSON/SSE. `message_stop`, fechamento de blocos e `stop_reason=end_turn` são obrigatórios. Erros explícitos do stream, timeout, truncamento e ambiguidade não autorizam segunda geração.

`/retomar JOB` verifica dono, estado e retenção, torna a primeira etapa recuperável executável, mantém as concluídas e preserva o ledger Claude. Renova a janela operacional e, se apropriado, somente o polling do mesmo run Apify. Não cria outro job, actor run ou oportunidade Claude. Auditoria terminal não ganha novas rodadas; o diagnóstico explica o impedimento.

SEO final (canonical, OG e Organization factual) e CSP entram antes da auditoria/hash. O pacote aprovado é publicado num único commit de conteúdo, incluindo páginas, CSS, JS, SVG, fotos, fontes e recursos preparados. A verificação exige o build do commit correto e compara os bytes públicos dos recursos funcionais, em seu subcaminho. Licenças/README fazem parte do commit, mas não são sondados por HTTP. Falha de Pages preserva repositório e artefato para retomar a publicação.

O retorno do worker/Telegram informa repositório, site quando verificado, estado real e limitações. Este pacote não contém um site comercial já publicado nem URLs fictícias de resultado.

## Modelo operacional e atualização

Use **um worker por volume local**, fora de OneDrive/NFS. O volume nomeado Docker do compose atende esse modelo. O worker confiável usa o socket Docker; o renderer de produção não recebe socket, credenciais, mounts do host ou rede. Tem usuário sem privilégios, filesystem somente leitura e limites. Timeout remove somente seu contêiner efêmero.

Depois de queda abrupta, confirme que não há outro worker vivo antes de remover `worker.lock` obsoleto do volume. Preserve `jobs.sqlite`, WAL/SHM quando houver, `JOB_HMAC_KEY` e reservas. O processo recupera etapas interrompidas ao iniciar. Nunca apague o banco para permitir nova tentativa Claude.

Para atualizar: interrompa novas entradas, faça backup do volume e rode `node scripts/migrate-config.mjs caminho/config.json`. O comando cria backup, incorpora campos atuais, remove opções obsoletas e atualiza a imagem padrão para 3.0.0. Construa as imagens novas e reimporte o JSON. Aprovações históricas continuam ligadas aos bytes originais. Jobs v1 gerados e ainda não aprovados precisam da versão anterior ou migração manual de artefatos, sem nova geração. Conclua jobs ativos antes de trocar a versão.

## Verificar a instalação

```powershell
npm ci
npm test
npm run build:workflow
npm run check
npm run test:render
npm run test:n8n
```

Sem Docker, apenas fixtures controladas podem usar `node scripts/render-comparison.mjs --local-fixture` e `node scripts/render-coverage.mjs`. Não são fallback para código gerado. Para consolidar evidências locais: `node scripts/collect-evidence.mjs` depois das duas renderizações.

Veja [VALIDACAO.md](VALIDACAO.md) para resultados atuais; [REQUISITOS.md](REQUISITOS.md) para rastreabilidade; [INTEGRACAO.md](INTEGRACAO.md) para comparação dos repositórios; [AVALIACAO_VISUAL.md](AVALIACAO_VISUAL.md) para casos reais de diferentes nichos. Prompts ativos em [PROMPTS.md](PROMPTS.md), exportados de `src/prompts.mjs`; contratos em `src/contracts.mjs` e `contratos/`.

Referências oficiais consultadas: [streaming Claude](https://platform.claude.com/docs/en/build-with-claude/streaming), [visão Claude](https://platform.claude.com/docs/en/build-with-claude/vision), [Models API](https://platform.claude.com/docs/en/api/models/retrieve), [contagem Claude](https://platform.claude.com/docs/en/build-with-claude/token-counting), [imagens Gemini](https://ai.google.dev/gemini-api/docs/image-understanding). Capacidades/cotas reais dependem da conta e são verificadas em execução.
