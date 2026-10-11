# Inspeção do original e decisões

O original foi lido integralmente, incluindo parâmetros, código, conexões e referências de credenciais. Somente os dois arquivos fornecidos estavam presentes; não havia `Markdown colado.md` nem `AGENTS.md` no diretório.

## Caminho original

Telegram → Config/chat → URL/job baseado no relógio → GitHub `/user` → Apify details → normalização em itens de imagem → download binário `data` → agregação JSON com base64 → Gemini marca → fatos/seleção → Nemotron opcional → Gemini copy → briefing → Claude → sanitização regex → Gemini leitura do HTML → substituições textuais → criar repo → um item/upload por arquivo → Pages/polling → verificação HTTP 200 → Telegram.

O fluxo usa `telegramApi`, `apifyApi`, `googlePalmApi`, `httpBearerAuth` NVIDIA, `anthropicApi` e `githubApi`. O JSON exportado contém referências, não os segredos. A referência Telegram foi preservada; integrações de processamento migraram para o worker.

## Problemas confirmados e correções

| Original | Implementado |
|---|---|
| `maxImages=8`, com avatar adicional | 60 candidatas iniciais, até 100 em expansão; 10 por lote, 20 finalistas, 10 finais independentes. |
| Apify details + resultsLimit 8 | details para perfil; posts em coleta separada; polling com deadline/runId persistido. |
| 12 posts, 3 filhos, capas primeiro | Amostra temporal nos posts consultados; todos os filhos; nenhum corte arbitrário em três. |
| IDs `img0`, `img1` após filtragem | Hash da identidade da mídia; associação explícita em todas as respostas visuais. |
| Corte de 4 KB e 14 MiB por pacote | Decode, dimensões, pixel limit, MIME real, hash e orçamento configurável; logo pequena permitida. |
| Primeira imagem vira hero quando todas rejeitadas | Rejeição é preservada; hero tipográfico ou falha antes da geração. |
| Números concatenados entre fontes | Trecho exato por sourceId; sem DDI/DDD inferido; conflitos omitidos. |
| Nemotron ligado e confundido com família 550B | Desligado; ID original mantido; catálogo consultado ao ativar; fallback integral Gemini. |
| Uma direção curta e seções fixas | Três conceitos comparados, layout escolhido, fontes locais, copy/evidências, seção desktop/mobile. |
| Claude com retryOnFail e maxTries 2 | HTTP nativo sem retry, ledger transacional por job, resposta persistida antes de parsing. |
| Tailwind de desenvolvimento e fontes remotas | CSS autoral, fontes OFL locais, runtime pequeno e verificado. |
| Sanitização regex/includes e fechamento de truncamento | Parsing HTML/CSS, lista de capacidades, URLs exatas, integridade estrita; saída incompleta bloqueia. |
| Auditor lê somente HTML e pode falhar aberto | Navegador isolado + screenshots + testes + Gemini; indisponibilidade bloqueia. |
| Correções aproximadas não renderizadas | Hash/âncora exata, escopo limitado, nova renderização, rollback ao piorar. |
| Upload por arquivo gera estados parciais | Um commit completo do site; refs reconciliadas; Pages só após o commit. |
| HTTP 200 equivale a disponível | Commit do build e hashes dos arquivos servidos conferidos; status parcial separado. |
| `.first()` espalhado em ramos/itens | Um evento checado por execução; job explícito nas respostas; sem binários no n8n. |
| Erros dependem de nós que podem não ter executado | Contexto intake autorizado e status do worker; mensagens sanitizadas com etapa/job. |

## Responsabilidades finais

| Componente | Responsabilidade |
|---|---|
| n8n | Trigger, contexto, acionamento ordenado das sete etapas, polling, progresso, diagnóstico e resultado. |
| Gemini | Fatos propostos, pixels em lotes, comparação visual global, identidade, três direções, copy, revisão pré-Claude, screenshots e patches locais. |
| Claude | Implementação completa única de HTML/CSS a partir de briefing aprovado e assets existentes. |
| Nemotron | Opcional: headlines/crítica textual subordinadas a Gemini. Sem autoridade visual/factual. |
| Worker determinístico | Autorização, identidade, limites, SSRF, decode/variants, schemas, evidências, contraste, fontes, validação estática, ledger Claude, publicação e verificação. |
| Chromium + axe | Renderização isolada e testes concretos; não substituem o julgamento visual Gemini nem asseguram qualidade universal. |

## Trade-offs explícitos

- Nenhum worker externo fictício: todo o código, Dockerfiles e contrato são entregues. Em contrapartida, o JSON exige implantar o worker.
- Catálogo de três famílias de fontes locais, com diferentes combinações por direção; não há uma estrutura visual fixa imposta aos nichos.
- Imagens de IA são opcionais no pedido e foram omitidas; 100% das fotografias utilizadas são reais.
- Sem JavaScript arbitrário produzido por modelos. A automação mantém liberdade de composição CSS e restringe interações às que consegue testar.
- Escala horizontal, organizações GitHub, tokens fine-grained e domínios personalizados não são suportados nesta edição; falham claramente.
- O ledger é local durável, não um protocolo distribuído. Preservá-lo é requisito da garantia de chamada única.
