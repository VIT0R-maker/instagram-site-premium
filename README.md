# Instagram → site premium → GitHub Pages

Esta entrega contém o workflow `../workflow_instagram_site_premium.json` e o worker que ele chama. O JSON depende deste worker: importar o workflow sozinho não instala Sharp, Chromium, o armazenamento persistente nem os validadores.

O caminho implementado é: Telegram → autorização/idempotência → preflight → Apify → processamento e curadoria Gemini → três direções/copy/briefing → uma geração Claude → renderização e revisão Gemini → commit coerente → Pages verificado → Telegram. Não há subworkflows a importar.

## O que foi validado nesta entrega

- Importação real em contêiner descartável **n8n 2.41.6**.
- Execução real desse n8n com **Telegram e HTTP simulados**: sete etapas, polling e pareamento de itens. Não é uma execução contra suas contas.
- **26 testes** de contratos, segurança, retomada, imagens, publicações simuladas e concorrência.
- Chromium isolado: 360×844, 390×844, 768×900 e 1440×900; oito screenshots reais de uma fixture, menu/teclado/âncoras/CTA/overflow e axe; teste adicional sem JavaScript.
- Construção das imagens Docker de worker e renderer; dependências npm fixadas em lockfile, sem vulnerabilidades reportadas pelo `npm audit` na instalação testada.

Nenhuma chamada real de geração Claude/Gemini, coleta Apify, envio Telegram ou criação de repositório na sua conta foi realizada nesta sessão. A disponibilidade dos modelos e permissões é confirmada pelo preflight **com suas credenciais**, antes da geração. Veja `VALIDACAO.md` para o alcance exato dos testes.

## 1. Requisitos de implantação

- Docker Engine/Desktop com contêineres Linux; reserve aproximadamente 4 GB de RAM para worker e renderer, além do n8n.
- Acesso HTTPS de saída para `api.github.com`, `api.apify.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`, CDNs públicas do Instagram e o domínio Pages retornado.
- Volume Docker **local e persistente**. Não use OneDrive, NFS ou uma pasta sincronizada para `jobs.sqlite`.
- Uma instância de worker por volume. O processo usa bloqueio de inicialização e o ledger SQLite usa WAL + `synchronous=FULL`. Não escale réplicas independentes, não clone o volume para servidores simultâneos e não restaure um backup anterior a chamadas já feitas.
- Para n8n Cloud, publique o worker por HTTPS com proxy reverso e a credencial Bearer. `host.docker.internal` é apenas uma configuração inicial para Docker Desktop. O proxy **não deve repetir POSTs upstream**. A API do worker não deve ficar exposta sem autenticação/TLS.

O worker confiável recebe o socket Docker para iniciar os renderers. Esse socket confere controle do daemon: dedique o host ao serviço ou isole-o em uma VM. **O navegador que executa a página não recebe socket, segredos, diretórios do host ou rede**. Seu contêiner tem filesystem somente leitura, tmpfs limitado, usuário sem privilégios, capabilities removidas e limites de memória, CPU, PIDs e duração.

## 2. Configurar o worker

No diretório desta pasta:

```powershell
node scripts/init-env.mjs
```

O comando cria `.env` com dois segredos aleatórios, sem imprimi-los. Abra o arquivo no editor e preencha:

| Variável | Configuração |
|---|---|
| `WORKER_TOKEN` | Já gerado; use o mesmo valor na credencial Header Auth do n8n. |
| `JOB_HMAC_KEY` | Já gerado; mantenha estável com o banco. Sua troca altera a identidade dos eventos. |
| `ALLOWED_CHAT_IDS` | IDs exatos dos chats Telegram autorizados, separados por vírgula. Vazio não autoriza ninguém. |
| `TELEGRAM_BOT_ID` | ID numérico do bot usado no trigger; confirme na resposta autenticada `getMe`. Não é o token. |
| `GEMINI_API_KEY` | Chave da conta Gemini com os modelos configurados disponíveis. |
| `ANTHROPIC_API_KEY` | Chave Anthropic com acesso ao modelo configurado. |
| `APIFY_TOKEN` | Token com acesso ao Actor `apify/instagram-scraper` e crédito suficiente. |
| `GITHUB_TOKEN` | PAT **clássico** da sua conta pessoal com `public_repo` (ou `repo`). |
| `GITHUB_PROBE_REPO` | Repositório público descartável de prova, explicado abaixo. |
| `NVIDIA_API_KEY` | Opcional; pode ficar vazio com Nemotron desligado. |

As referências Telegram do arquivo original foram preservadas no JSON. As chaves Gemini/Anthropic/Apify/GitHub passam a ser segredos do worker; um export de workflow contém referências de credenciais, não os valores descriptografados que permitiriam migrá-las automaticamente.

### Prova de permissão GitHub antes do Claude

Nesta edição, o modo suportado é conta pessoal + PAT clássico. Tokens fine-grained, GitHub Apps e repositórios de organizações não são tratados como equivalentes: o preflight os bloqueia em vez de supor que têm permissão para criar novos repositórios e Pages.

Crie uma vez um repositório **descartável**, público, inicializado com README e descrição exata:

```text
instagram-site-premium permission probe
```

Exemplo com GitHub CLI já autenticado:

```powershell
gh repo create site-permission-probe --public --add-readme --description "instagram-site-premium permission probe"
```

Defina `GITHUB_PROBE_REPO=site-permission-probe`. Cada preflight confere `/user`, escopos, proprietário e permissões; escreve `permission-check.txt` e cria/atualiza a configuração Pages nesse repositório. Isso comprova escrita de conteúdo e administração de Pages sem criar o repositório definitivo antes da aprovação. **Não indique um repositório importante**. O marcador de descrição é exigido para evitar a escrita acidental.

Não existe dry-run universal para criação de repositório. Escopos e a prova anterior reduzem o risco; suspensão da conta, limite de repositórios ou mudanças posteriores de permissão ainda podem causar publicação parcial.

### Subir os serviços

```powershell
docker compose --profile build build renderer-image worker
docker compose up -d worker
docker compose logs --tail 30 worker
```

A porta padrão é 8787, vinculada ao localhost do host. O n8n em Docker Desktop pode usar `http://host.docker.internal:8787`. Para n8n em outro servidor ou Cloud, configure uma URL HTTPS realmente acessível. Não publique diretamente o Docker socket.

`GET /healthz` confirma que o processo está disponível; não testa contas/modelos. O preflight de cada job testa essas integrações. `restart: "no"` é intencional: uma queda exige examinar o ledger, remover um lock de processo obsoleto somente após confirmar que não existe outro worker, e então reiniciar.

## 3. Importar e configurar o n8n

1. Importe `workflow_instagram_site_premium.json` pelo editor. Na importação CLI, o ID estável é `IGPremiumSingleClaudeV1`; reimportar pelo CLI atualiza esse workflow.
2. No nó **Contexto — um evento por execução**, ajuste `workerBaseUrl`.
3. Crie uma credencial **Header Auth**: Name=`Authorization`, Value=`Bearer <WORKER_TOKEN>`. Selecione-a nos nós HTTP do worker; a referência inicial é `Premium Worker — Authorization`.
4. Confira a credencial Telegram do trigger e dos nós de mensagem. A referência original pode ser resolvida na mesma instância; em outra instância, selecione a credencial existente.
5. Desative o workflow antigo antes de ativar este se ambos usam o mesmo bot/webhook.
6. Envie **somente** um link HTTPS de perfil público. Parâmetros de compartilhamento são removidos. Links de posts/reels, domínio parecido, credenciais na URL e perfil privado não são aceitos.

O trigger recebe um único evento por execução, condição checada em código. O contexto de trabalho vem do worker; ramos Telegram de progresso são terminais e não substituem o payload. Cada etapa tem seu próprio loop **somente de consulta de status**. Nenhum caminho retorna ao nó de geração.

## 4. Configuração e limites

Edite `config.json` e reconstrua/reinicie o worker. Não altere a configuração de um trabalho no meio da execução.

| Parâmetro | Padrão e efeito |
|---|---|
| `postsLimit` / `expandedPostsLimit` | 40 / 80 posts. Perfil é uma consulta `details`; posts vêm de `posts`. |
| `maxCandidateImages` / `expandedCandidateImages` | 60 / 100 mídias, uma expansão se o primeiro acervo útil for insuficiente. |
| `analysisBatchSize` | Até 10 imagens; o lote também é reduzido pelo tamanho base64 serializado. Não é limite universal do Gemini. |
| `maxFinalists` / `maxSiteImages` | 20 finalistas revistos globalmente / 10 imagens exibidas. |
| `geminiPayloadBytes` | 16 MB por requisição, abaixo do teto documentado de inline data. Payload excessivo bloqueia; não é enviado parcialmente. |
| `geminiMaxCalls` / `apiAttempts` | 90 reservas de tentativa / até 3 tentativas para Gemini. Reserva conservadora contabiliza o pior caso mesmo quando a primeira tentativa funciona. |
| `maxBriefReviewRounds` / `maxAuditRounds` | Até 2 correções após a revisão inicial em cada fase. |
| `maxJobDuration` | 3600 s por janela de execução; `/retomar` abre outra janela preservando reservas/checkpoints. |
| `maxActiveJobs` / `downloadConcurrency` | 2 jobs / 4 downloads por job. Saturação exige retomada; não existe fila ilimitada oculta. |
| `claudeMaxOutputTokens` | 24000, validado contra Models API antes da geração. |
| `claudeInputBytes` | 120000 bytes para a requisição; briefing recebe margem para o system prompt. |
| `claudeTimeoutMs` | 300000 ms; timeout é ambíguo e **não** provoca retry. |
| `qualityThreshold` | Média mínima 85 da rubrica, mais testes determinísticos aprovados e nenhum issue high/critical. |
| `pagesPollingDeadline` | 600 s; depois disso há sucesso parcial do repositório, sem declarar site no ar. |
| `retentionDays` | 14 dias para arquivos privados/modelos; o tombstone de identidade e a reserva Claude não expiram. |

Os modelos iniciais preservam os IDs do arquivo recebido: `gemini-3.8-flash`, `claude-sonnet-5-5` e, opcionalmente, `nvidia/nemotron-3-super-120b-a12b`. As APIs de modelos são consultadas em runtime; modelos ausentes, método incompatível ou limites não confirmados bloqueiam antes do Claude. Nenhuma troca silenciosa é feita.

Nemotron inicia desligado. Quando habilitado, a lista do provedor precisa conter o ID configurado; no máximo uma chamada textual curta é feita, e Gemini pode rejeitar todo o rascunho. Não foi confirmada disponibilidade contratada da referência Ultra 550B; ela não substituiu o modelo existente.

Geração complementar por IA **não está implementada nem é necessária para o caminho padrão**. `enableAiDecorativeImages=false` e `geminiImageModel=null`. Se a flag for habilitada, o briefing registra a indisponibilidade e continua com fotos reais e decoração CSS. Não existe endpoint fictício. A predominância de imagens reais é 100% nesta edição.

## 5. Contratos, fatos e imagem

Os schemas versionados estão em `src/contracts.mjs`; Ajv faz validação local completa. O schema enviado ao Gemini é adaptado ao subconjunto da API. As etapas não transportam base64 no n8n: HTTP retorna apenas IDs/estado/contexto curto; bytes ficam no volume privado.

- Perfil, bio/categoria e legendas são fontes distintas. Uma afirmação contém ID, tipo, original, normalizado, fonte, trecho contíguo exato, data e estado. Contatos conflitantes são omitidos. Nenhum número é formado juntando evidências.
- `normalized` permite apenas capitalização/normalização Unicode, sem reinterpretar o fato. Há uma revisão semântica Gemini adicional: correspondência textual não prova por si só uma alegação comercial.
- WhatsApp exige link `wa.me`/`api.whatsapp.com` válido, ou indicação explícita com número internacional completo. País/DDD não são adivinhados. Sem comprovação, o CTA permanece **Conversar pelo Instagram**. Sites externos arbitrários não são seguidos.
- IDs de assets são derivados da identidade da mídia, nunca da posição após downloads. Carrosséis não têm corte em três filhos. A amostra alterna períodos recentes/antigos dentro dos posts consultados.
- Sharp decodifica, identifica MIME/dimensões e limita pixels. Não há descarte por “menos de 4 KB”. Hash exato elimina cópias; dHash agrupa possíveis semelhantes **sem eliminar automaticamente ângulos distintos**.
- Originais privados, JPEGs de análise e variantes AVIF/WebP/JPEG ou PNG são separados. Não há upscale; hero vai até 2400 px de largura, outras fotos até 1600, respeitando a fonte. Esta edição não impõe 4K.
- Todas as imagens aceitas para análise são vistas em lotes. Finalistas são vistas novamente juntas, com IDs, restrições de corte, foco, alt e identidade. Uma imagem rejeitada nunca é promovida a hero. Sem hero adequado, é usado briefing tipográfico.
- Fontes locais DM Sans, Lora e Space Grotesk possuem versões fixadas, suporte latino/latino estendido, `font-display: swap` e OFL incluída no pacote público.

## 6. Política do código e qualidade

Claude gera `index.html` e `styles.css` em envelope JSON completo. A implementação pode compor livremente grid, tipografia, cores, detalhes CSS e hierarquia dentro do briefing. Um `runtime.js` confiável, entregue aqui e validado por hash, implementa menu não modal com Escape/`aria-expanded`/retorno de foco.

Esta escolha limita interações a menu, âncoras e links reais. Não há lightbox, formulário, agendamento fictício, JavaScript arbitrário gerado, CDN Tailwind, embeds ou frameworks com build. Imagens usam `<img>/<picture>` e fontes são os únicos recursos carregáveis por CSS. SVG arbitrário e escapes CSS estão fora do contrato; decoração pode usar gradientes e formas CSS.

parse5 e CSSTree validam estrutura/referências e políticas; regex não é usada como “sanitizador universal”. Não há tentativa de fechar HTML truncado. Copy visível, metadata, CTAs, assets e runtime são conferidos. Segredos/IDs privados são bloqueados no pacote público. DNS é resolvido e fixado por requisição; IPs privados/reservados e redirects para hosts não permitidos são rejeitados.

O renderer usa subcaminho `/nome-do-repo/`, rede Docker `none`, CSP restrita e bloqueio de requisições externas no navegador. Screenshots e testes são obrigatórios. Gemini recebe pixels reais e deve descrever gravidade, componente, viewport e evidência; notas são indicadores subjetivos, não certificados. Não foi implementado Lighthouse; os testes executados são axe e verificações Playwright descritas no relatório, sem alegação de Core Web Vitals reais.

Patches precisam de arquivo, hash da versão auditada e trecho exato único. Há limites de tamanho por patch e por arquivo. Depois de cada patch, parsing/renderização/screenshots/revisão são repetidos. Se a nota piora, a versão anterior é restaurada e a publicação é bloqueada. Resultado incompleto não é reconstruído por Gemini.

## 7. Como a chamada única do Claude é protegida

1. `jobId` é HMAC(bot ID, chat ID, message ID). Reentrega do mesmo evento mantém o job; nova mensagem intencional cria outro.
2. O único nó de geração chama `/stages/generate`. O único POST Anthropic de geração fica em `Providers.claude()`.
3. `INSERT OR IGNORE` em `claude(job PRIMARY KEY, calls CHECK(calls=1))` reserva o direito antes de qualquer envio; o banco confirma a operação durável.
4. O estado passa de `reserved` para `sent` antes do POST. HTTPS nativo não faz retry nem segue redirecionamento. Não há SDK ou proxy Anthropic configurado.
5. Resposta bruta, status e request ID são salvos transacionalmente antes de parsing/validação.
6. Se a resposta já existe, ela é reutilizada. Sem resposta persistida, uma reserva existente é **ambígua e irrevogável**; não há nova geração.

Isso é **no máximo uma requisição de geração**, não “exatamente uma”. Uma queda entre reserva e envio pode consumir a oportunidade sem entregar site. O teste cobre 40 concorrentes e oito processos reais usando um provedor simulado. A garantia depende de preservar o volume/ledger e a chave HMAC; apagá-los ou restaurar uma versão antiga invalida a garantia.

Consultas **GET** ao catálogo de modelos Anthropic no preflight não são chamadas de geração nem usam Claude para preparar/auditar conteúdo.

## 8. Recuperação e publicação

Envie `/retomar JOB_ID` ao mesmo bot, no chat autorizado. Jobs concluídos atravessam as etapas usando checkpoints. Falhas de auditoria/publicação recomeçam na etapa pendente; o endpoint de geração devolve sua conclusão existente. A recuperação de uma resposta persistida nunca chama Claude novamente.

Se o estado Claude for `reserved`/`sent` sem resposta, o bot explica o bloqueio. Nem a retomada nem apagar uma execução n8n liberam uma segunda geração. Se desejar uma nova tentativa intencional paga, envie o perfil em **nova mensagem**, ciente de que é um novo job.

O repositório final recebe username + sufixo estável. Um marcador aleatório de propriedade permite reconciliar criação com resposta perdida e recusa colisões. A inicialização GitHub produz um commit inicial; **todos os arquivos do site aprovado entram em um único commit subsequente** via blobs/tree/commit/ref. Não há publicação por PUT individual de cada arquivo. Nenhum force push é usado.

Pages é habilitado somente depois desse commit. O fluxo confere commit do build, status e SHA-256 dos arquivos públicos essenciais. Um HTTP 200 com conteúdo antigo não basta. O teste público é de download/integridade; o navegador renderiza o mesmo pacote validado sob subcaminho isolado, sem acesso direto à internet. Domínio personalizado não é suportado nesta versão.

Se Pages falhar, o bot entrega a URL do repositório e o diagnóstico, sem afirmar que o site está disponível. A URL de site só aparece como publicada depois da verificação. Interrupção do Telegram no último envio pode ser resolvida com `/retomar`: o resultado já publicado é reapresentado.

Após queda do worker, confirme que não há outra instância, pare o serviço e remova **somente** `/data/worker.lock` no volume antes de reiniciar. Nunca remova `jobs.sqlite`, `jobs.sqlite-wal` ou os registros Claude para “destravar”. Logs públicos contêm apenas erros sanitizados; `lastFailure` no SQLite armazena diagnóstico privado com valores do ambiente redigidos.

Backups consistentes devem incluir banco/WAL e arquivos do job. Restauração exige conciliar reservas mais recentes; não há protocolo distribuído para restaurar backups antigos sem risco. Retenção remove artefatos após 14 dias, mas mantém tombstones. Um job expirado não será regenerado pela retomada.

## 9. Contrato HTTP

Todas as rotas `/v1/*` exigem `Authorization: Bearer <WORKER_TOKEN>`; limite de corpo 24 KB. O cliente não informa chaves/modelos/destinos de download arbitrários.

| Rota | Corpo/resposta |
|---|---|
| `GET /healthz` | `{ok,version}`; não revela configuração nem segredos. |
| `POST /v1/jobs` | Update Telegram com `message.chat.id`, `message.message_id`, `message.text`; cria/recupera job, ou processa `/retomar ID`. |
| `POST /v1/jobs/:id/stages/:stage` | `{}`; inicia uma etapa elegível e retorna rapidamente seu estado. |
| `GET /v1/jobs/:id/stages/:stage` | Consulta; não gera site, não publica nem reinicia etapa. |

Etapas: `preflight`, `collect`, `curate`, `brief`, `generate`, `audit`, `publish`. Resposta curta: `jobId`, `chatId`, `stage`, `state`, `message`, `code`, `repoUrl`, `siteUrl`, `claudeState`. Estados: `pending`, `running`, `done`, `failed`, `interrupted`. Segredos, evidências, pixels e respostas dos modelos nunca retornam nessas rotas.

## 10. Executar os testes

```powershell
npm ci --ignore-scripts
npm test
npm run check
node scripts/render-smoke.mjs
node scripts/n8n-smoke.mjs
```

Os dois últimos comandos precisam de Docker e usam somente fixtures/mocks; nenhum deles utiliza as APIs pagas. `n8n-smoke` abre um servidor HTTP temporário para o contêiner alcançar o mock e o encerra ao terminar. `test-output/` é ignorado pelo Git.

## Referências técnicas consultadas

- [Apify: schema do Instagram Scraper](https://apify.com/apify/instagram-scraper/input-schema) — `details` retorna metadados; `resultsLimit` não é a quantidade de imagens de um perfil em details.
- [Gemini: compreensão de imagens](https://ai.google.dev/gemini-api/docs/image-understanding), [saída estruturada](https://ai.google.dev/gemini-api/docs/structured-output), [generateContent](https://ai.google.dev/api/generate-content), [Models API](https://ai.google.dev/api/models).
- [Claude: modelos e limites](https://platform.claude.com/docs/en/models/overview), [Models API](https://platform.claude.com/docs/en/api/models/retrieve).
- [GitHub: repositórios](https://docs.github.com/en/rest/repos/repos), [Git database](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database), [Pages](https://docs.github.com/en/rest/pages/pages).
- [n8n: releases](https://github.com/n8n-io/n8n/releases/).
- [NVIDIA: referência Ultra 550B](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b) — referência não comprova quota/acesso na conta; não ativada.
# instagram-site-premium
