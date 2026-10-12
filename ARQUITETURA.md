# Decisão técnica — revisão 3

A implementação existente foi preservada. n8n continua orquestrando etapas e Telegram; o worker reúne processamento, contratos e persistência; o renderer executa o artefato sem credenciais. Esses componentes fornecem capacidades verificáveis. A quantidade de componentes não prova design superior.

Inspeção local em 11/10/2026: Node 24.14.1, projeto Node/ESM instalado, Playwright/Chromium disponível, Docker Desktop 4.91.0 instalado mas o daemon Linux não iniciou. O log informa falha ao renomear `sailor-ingest.sock`. Não foi feito reset nem alteração de volumes Docker. Não foi identificada instância n8n local configurada neste projeto; a referência do export é 2.41.6. Não foi presumida a versão da instância do usuário.

| Capacidade | Benefício para o resultado | Onde executa | Por que manter o componente |
|---|---|---|---|
| Análise multimodal e briefing | Seleção por pixels, contexto de marca e direção concreta | APIs Gemini, coordenadas pelo worker; etapas visíveis no n8n | Worker já agrupa imagens, controla payload, valida contratos e persiste resultados. Transferir essa lógica para nós não oferece ganho visual demonstrado nesta tarefa. |
| Processamento de imagens | Orientação, nitidez preservada, variantes, dimensões e referências coerentes | Sharp no worker | Operações binárias e acesso a arquivos locais já existem aqui. Não foi demonstrado ambiente n8n com Sharp/bibliotecas equivalentes disponíveis. |
| Renderização desktop/mobile | Detectar overflow, recortes, conteúdo oculto e defeitos de dobra | Chromium/Playwright no renderer | Navegador real executa HTML/CSS/JS do artefato. Isolamento evita entregar segredos do worker a código gerado. |
| Movimento e interação | Verificar teclado, mouse, toque, Escape, foco e efeitos nos dois modos | Mesmo renderer | Reusa a sessão de navegador; não foi adicionado outro serviço. Capturas temporais e métricas complementam screenshots. |
| Correções após inspeção | Reparar o artefato real sem reconstruí-lo | Gemini propõe; worker aplica hashes/âncoras; renderer revalida | A combinação permite mostrar defeito e confirmar resultado. O teste local demonstrou detecção e reparo de overflow, CTA e foco. O Gemini real não foi exercitado. |
| Persistência de trabalhos | Recuperar coleta/artefato/publicação sem repetir criação | SQLite local no worker | Reserva atômica é requisito operacional, não melhoria estética. Uma tabela de reservas compartilhada impede retries/concorrência de gerar duas vezes. |

O Docker continua obrigatório para código gerado em produção. A execução nativa de uma fixture controlada é apenas uma ferramenta de teste, sem fallback automático. O erro do daemon impede afirmar que a imagem Docker v3 foi construída/executada nesta revisão. A instalação anterior v1 tem evidências históricas próprias e não substitui essa confirmação.

Poderia ser hospedado com menos processos se o ambiente n8n fornecesse as mesmas bibliotecas, disco persistente e isolamento do navegador com desempenho equivalente. Isso não foi confirmado aqui; uma migração agora acrescentaria risco sem benefício visual observado.
