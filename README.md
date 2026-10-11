# Instagram → Site Premium — versão 2

Workflow n8n e worker revisados para priorizar a qualidade do site: fotografias reais selecionadas pelos pixels, direção de arte, uma criação multimodal Claude, inspeção no navegador e correções locais antes da publicação. O JSON depende deste worker e do renderer; importá-lo sozinho não instala a solução.

**Não houve execução com suas contas nem geração paga nesta revisão.** O alcance dos testes e o bloqueio atual do Docker estão em [VALIDACAO.md](VALIDACAO.md). A justificativa dos componentes está em [ARQUITETURA.md](ARQUITETURA.md). A matriz de atendimento está em [REQUISITOS.md](REQUISITOS.md).

## Fluxo

Telegram → autorização/idempotência → preflight → Apify → Sharp → Gemini (fatos, lotes visuais, seleção global, direções, briefing) → **uma criação Claude com as fotos selecionadas** → finalização SEO → navegador + Gemini → patches delimitados e nova inspeção → hash aprovado → GitHub + Pages verificado → Telegram.

As fotografias de produção vêm exclusivamente do acervo Apify aprovado. Não existe geração de fotografias, fundos raster ou logo por IA. SVG, máscaras, gradientes e decoração em código são permitidos. Não há fallback para fotos rejeitadas. Um acervo insuficiente pode resultar em composição tipográfica ou interrupção fundamentada.

## Instalação

1. Use Docker Engine/Desktop com contêineres Linux e cerca de 4 GB disponíveis, além dos recursos do n8n. O ambiente de referência do workflow é n8n 2.41.6, com somente nós nativos.
2. Nesta pasta, execute `node scripts/init-env.mjs`. O comando cria `.env` e segredos locais sem imprimi-los. Abra o arquivo e configure as integrações abaixo.
3. Prepare o repositório descartável de prova de permissões GitHub.
4. Construa e inicie os serviços:

```powershell
docker compose --profile build build renderer-image worker
docker compose up -d worker
docker compose logs --tail 30 worker
```

5. Importe [workflow_instagram_site_premium.json](workflow_instagram_site_premium.json). No nó **Contexto — um evento por execução**, ajuste `workerBaseUrl`. O padrão `http://host.docker.internal:8787` atende Docker Desktop; outro host/n8n Cloud precisa de HTTPS acessível.
6. Crie **Header Auth**, Name `Authorization`, Value `Bearer <WORKER_TOKEN>`, e selecione-a nos nós HTTP. Confira a credencial Telegram no trigger e nos nós de mensagens. Desative o fluxo antigo que usa o mesmo bot antes de ativar este.
7. Envie somente o link HTTPS de um perfil público. Use `/retomar JOB` para recuperar um trabalho existente.

| Variável em `.env` | Uso |
|---|---|
| `WORKER_TOKEN` | Autenticação n8n → worker; gerado pelo script. |
| `JOB_HMAC_KEY` | Identidade estável de eventos; conserve junto do banco. |
| `ALLOWED_CHAT_IDS` | Chats autorizados, separados por vírgula. |
| `TELEGRAM_BOT_ID` | ID numérico do bot, não seu token. |
| `GEMINI_API_KEY` | Curadoria, briefing e auditoria. |
| `ANTHROPIC_API_KEY` | Models API, contagem de tokens e única criação. |
| `APIFY_TOKEN` | Actor `apify/instagram-scraper`. |
| `GITHUB_TOKEN` | PAT clássico pessoal com `public_repo` ou `repo`. |
| `GITHUB_PROBE_REPO` | Nome do repositório público descartável de prova. |
| `NVIDIA_API_KEY` | Somente se Nemotron for habilitado. |

O repositório de prova deve pertencer ao usuário do PAT, ter branch inicial e descrição exata `instagram-site-premium permission probe`. Cada preflight escreve `permission-check.txt` e configura Pages nele para confirmar permissões antes do Claude. Não use um repositório importante. Conta de organização, GitHub App e PAT fine-grained não estão implementados nesta edição. A prova reduz falhas previsíveis; não garante que permissões/serviços continuarão disponíveis até publicar.

O JSON preserva referências de credenciais Telegram do arquivo original. Referências não contêm os segredos descriptografados; confirme a associação na sua instância. O ID CLI `IGPremiumSingleClaudeV1` foi conservado para reimportação, embora o conteúdo seja v2. Não há subworkflows adicionais.

## Configuração de qualidade

| Parâmetro | Padrão |
|---|---|
| Posts inicial / ampliado | 40 / 80 |
| Candidatos inicial / ampliado | 60 / 100 |
| Lote visual / finalistas globais / assets no site | 10 / 20 / 10 |
| Revisões de briefing / patches de auditoria após inspeção inicial | 2 / 4 |
| Rodadas consecutivas sem progresso | 2 |
| `qualityThreshold` | 85, além dos gates técnicos e semânticos |
| Viewports | 320, 390, 768 e 1440 px, em movimento normal e reduzido |
| `claudeInputBytes` | 120.000 bytes de briefing textual |
| `claudeRequestBytes` | 24 MB do corpo multimodal serializado |
| Referência visual Claude | Até 1280 px; pode reduzir até 768 px para caber |
| Imagens por criação / base64 por imagem | Até 20 / 8 MB |
| Saída Claude / timeout | 24.000 tokens / 300 s, sem retry |
| Gemini | 16 MB por corpo; até 90 reservas de tentativa, incluindo retries |
| Patches | Até 25% por arquivo por rodada e 45% acumulados, com pequenos pisos absolutos; nunca substituição integral |
| Janela do job / retenção privada | 3600 s / 14 dias |

Os valores são limites operacionais configuráveis, não metas de encher o contexto. IDs de modelos permanecem configuráveis. Antes de criar, o preflight confirma disponibilidade/capacidade nas APIs e `image_input.supported` no Claude. Depois de preparar os pixels, `/v1/messages/count_tokens` estima a entrada real, com margem de 5% e reserva de saída. Esse endpoint não gera conteúdo. Apenas `/v1/messages` é uma requisição de geração e tem barreira atômica persistente. Se visão/limites não forem confirmados, o fluxo para antes da reserva; nunca troca pixels por descrições silenciosamente.

As referências visuais mantêm assetId e hash do original. O checkpoint privado `claudeInput` registra dimensões, bytes, hashes, contagem estimada e eventuais reduções. Publicação usa variantes AVIF/WebP/JPEG/PNG próprias, sem URLs temporárias do Instagram.

## Liberdade de criação e revisão

O briefing distingue fatos/identidade/contatos/assets imutáveis, exigências de qualidade e composição flexível. Produtos, serviços e outras ofertas comprovadas são aceitos. Site, loja, Instagram e WhatsApp conservam destinos e rótulos próprios. A coleta ampliada refaz também a interpretação das fontes textuais.

Claude entrega até 16 arquivos HTML/CSS/JS/SVG com caminhos explícitos e um manifesto privado de interações. JavaScript autoral, galeria/lightbox, decoração SVG, fundos fotográficos, máscaras e reuso funcional são permitidos. O runtime de menu existente pode ser reutilizado, mas não é obrigatório nem exclusivo.

O catálogo local tem oito famílias OFL: DM Sans, Lora, Space Grotesk, Fraunces, Manrope, Playfair Display, Outfit e Bitter. Heading/body são escolhidos livremente dentro do catálogo. Apenas fontes selecionadas e respectivas licenças entram no pacote. Recursos nativos são o padrão; Anime.js 3.2.2/MIT está disponível quando Gemini justificar uma timeline que o beneficie. O modelo não instala dependências.

O validador produz diagnósticos: reparável com renderização, reparo anterior à execução ou falha irrecuperável. Fatos são revistos semanticamente contra evidências pelo Gemini, incluindo texto efetivamente renderizado; pequenas reformulações, legendas fiéis e microcopy não são rejeitadas por diferença literal. Essa avaliação probabilística não é uma prova infalível de verdade.

O navegador testa todas as páginas HTML, nos dois modos de movimento. Registra dobra, página inteira, detalhes, momentos de entrada, medidas de animação/rAF, áreas clicáveis, overflow, imagens, âncoras, axe e cenários de teclado/mouse/toque declarados para as interações. Medições locais não garantem fluidez em qualquer dispositivo. O auditor recebe pixels, código, evidências e resultados reais. Patches usam hash da versão e âncora literal única; HTML/CSS/JS/SVG são revalidados e renderizados. Pequena queda de nota não desfaz correção objetiva. Limite, ciclo, ausência de progresso ou reconstrução ampla bloqueiam a publicação.

## SEO, publicação e retomada

Owner e nome final do repositório são conhecidos antes da criação. Canonical, Open Graph e JSON-LD `Organization` sustentado pelas evidências são finalizados antes da auditoria e do hash. Endereço, contato e logo só entram quando comprovados; nenhuma classificação `LocalBusiness` é presumida. A CSP vem antes de scripts no HTML final.

GitHub recebe apenas arquivos públicos aprovados, inclusive JS/SVG/fontes/biblioteca. Um commit agrupa o pacote; um marcador privado impede sobrescrever um repositório alheio. Pages precisa concluir o build do commit correto e servir os arquivos conferidos por hash no subcaminho. Domínios personalizados não são suportados. Se houver falha de publicação, `/retomar JOB` aproveita o mesmo artefato e não gera outro site.

SQLite usa WAL/FULL e reserva única do Claude por identidade HMAC de bot/chat/mensagem. Duplicatas e concorrência compartilham a reserva. Timeout ambíguo não é liberado. Resposta completa já persistida pode ser recuperada; resposta truncada não é continuada/reconstruída. O fluxo n8n repete consultas GET de status, nunca retorna ao nó de geração. Auditoria terminal também não ganha novas rodadas ao retomar.

## Atualização de v1

Pare novas entradas e faça backup do volume persistente. Não apague/recrie banco, `JOB_HMAC_KEY`, ledger ou tombstones. Para configuração v1 customizada:

```powershell
node scripts/migrate-config.mjs caminho/para/config.json
```

O script faz backup, preserva ajustes e remove as duas opções antigas de imagens IA; a funcionalidade foi retirada, não adiada. Revise os valores, construa imagens `2.0.0` e reimporte o workflow. Não mude configuração/modelo durante um job ativo.

Jobs v1 já aprovados podem retomar a publicação dos bytes originais, sem receber uma nova aprovação v2. Jobs v1 já gerados mas não aprovados não são automaticamente convertidos/regenerados: preserve e conclua-os com a versão anterior ou faça uma migração manual revisada dos artefatos, sem tocar na reserva Claude. Essa distinção evita chamar uma aprovação antiga de auditoria v2. Faça a atualização operacional preferencialmente sem jobs v1 em andamento.

## Operação e testes

Use um volume **local**, fora do OneDrive/NFS, para `jobs.sqlite`; uma instância de worker por volume. O worker confiável usa o socket Docker. O renderer de produção não recebe socket, segredos, mount do host ou rede, e tem usuário sem privilégios, filesystem somente leitura e limites. Timeout remove apenas o contêiner efêmero daquela chamada. O proxy n8n/worker não deve repetir POSTs. Retenção remove dados privados antigos, conservando a reserva/tombstone para impedir repetição.

```powershell
npm ci
npm test
npm run build:workflow
npm run check
npm run test:render
npm run test:n8n
```

`node scripts/render-comparison.mjs --local-fixture` é uma alternativa exclusiva para a fixture controlada quando Docker não estiver disponível. Não é fallback de produção. Notas/patches de Gemini e a geração são mocks nesse teste; Chromium é real. Nenhuma dessas fixtures é oferecida como foto de uma empresa ou fallback de coleta.

Prompts completos: [PROMPTS.md](PROMPTS.md), gerados de `src/prompts.mjs`. Contratos: `src/contracts.mjs` e `contratos/`. Versões sem patch e finais, diagnósticos e screenshots ficam privados em `data/jobs/<id>/`. Consulte [VALIDACAO.md](VALIDACAO.md) antes de considerar a implantação validada.

Referências de implementação consultadas em 11/10/2026: [visão Claude](https://platform.claude.com/docs/en/build-with-claude/vision), [Models API](https://platform.claude.com/docs/en/api/models/retrieve), [contagem de tokens](https://platform.claude.com/docs/en/build-with-claude/token-counting). Os limites do provedor podem mudar; o preflight verifica a conta/modelo e mantém limites locais conservadores.
