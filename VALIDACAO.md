# Relatório de validação — 11/10/2026

## Resultado e limites

Entrega validada por parsing/syntax, testes de unidade e integração com mocks, importação/execução local no n8n e renderização real de fixture em Chromium. **Não foi executado um job contra suas credenciais reais.** Não foram criados repositórios públicos, enviadas mensagens Telegram nem consumidas gerações Claude nesta sessão.

| Verificação | Resultado |
|---|---|
| JSON e estrutura n8n | 58 nós, nomes/IDs únicos, 47 origens de conexão válidas, expressões com referências existentes. |
| Nós e geração | Tipos nativos; um nó Claude, retry desligado; nenhum ciclo alcança novamente esse nó. |
| Importação original | Importado no CLI de n8n 2.41.6 em contêiner sem rede, credenciais ou ativação; exit 0. |
| Orquestração n8n | Workflow adaptado somente para trocar Telegram/HTTP por mocks; sete etapas POST uma vez cada, duas consultas por etapa; exit 0. |
| Testes automatizados | 26 testes de contratos, concorrência, rede simulada, imagens, GitHub simulado e HTTP local. |
| Concorrência Claude | 40 promessas concorrentes e oito processos separados: contador físico simulado = 1. |
| Renderer | Chromium 156.0.8078.4; Docker `network=none`, sem credenciais. |
| Viewports | 360×844, 390×844, 768×900, 1440×900; DPR 1, pt-BR, America/Sao_Paulo, movimento reduzido. |
| Screenshots | Oito arquivos reais da fixture: primeira dobra + página inteira em cada viewport. |
| Navegador | Menu, Escape, foco devolvido, âncoras, CTA, overflow, console, requests/imagens e conteúdo sem JS. Fixture passou. |
| axe | Nenhuma violação reportada na fixture nas quatro larguras. Isso não é garantia para sites futuros. |
| Dependências | `npm ci` com versões fixadas e lockfile; `npm audit` na instalação testada: zero vulnerabilidades reportadas. |
| Docker | Renderer e worker construídos; bases fixadas por versão e digest. |

A última tentativa de reconstruir o worker após os reforços finais de validação encontrou o daemon Docker desligado/indisponível (`dockerDesktopLinuxEngine` ausente). As construções anteriores foram bem-sucedidas; o código final passou nos 26 testes e na checagem de sintaxe. É necessário executar o build do pacote final no host de implantação.

## Cenários solicitados

1. **Acervo rico/carrosséis:** fixture com 18 posts × 5 filhos; 60 candidatos preservados; filho de índice 4 presente; nenhuma dependência de covers-first.
2. **Poucas fotos/vertical/logo:** imagem vertical decodificada e logo PNG válida abaixo de 4 KB aceita.
3. **Sem WhatsApp/endereço:** CTA Instagram; nenhuma inferência de DDI/DDD; contatos conflitantes removidos.
4. **Privado/inexistente/insuficiente:** rejeitados antes de geração.
5. **Download parcial/expirado/inválido/duplicado:** mock de falha + decode real; associação ID/legenda estável, SHA deduplica.
6. **Filho posterior do carrossel:** seleção candidata inclui filhos além dos três originais. A superioridade estética depende da curadoria real Gemini, não é simulada como fato.
7. **Sem hero fotográfico:** fixture tipográfica válida; código proíbe reaproveitar papel reject e exige coerência de heroMode.
8. **Gemini inválido/truncado/429:** respostas simuladas bloqueadas; teste de transporte 429→200 respeita Retry-After; 401 não repete; limites de payload/budget verificados.
9. **Nemotron:** desligado não chama endpoint; indisponível retorna null e permite caminho Gemini. Qualidade comparativa de texto requer avaliação real.
10. **GitHub inválido:** falha de preflight simulada sem reserva Claude.
11. **Claude truncado/timeout/persistência:** truncado permanece salvo e reprovado; timeout bloqueia repetição; resposta reaproveitada após reabrir o banco.
12. **Duplicação/concorrência/retomada:** mesma mensagem mantém ID; novo message_id muda ID; etapas não executam duas vezes; contador de geração permanece um.
13. **Auditoria impeditiva/patch inválido:** HTTP local não libera publish se audit falhar; patch exige hash/trecho exato, rejeita reconstrução; quality gate recusa aprovação ausente.
14. **IA complementar:** não aplicável como chamada externa: geração opcional não foi implementada. O caminho entregue usa fotos reais/CSS; flag habilitada registra essa limitação, sem endpoint fictício.
15. **Pages/subcaminho/pending/404/imagem ausente:** mocks confirmam recuperação de pending/404, bloqueio por ausência de imagem, build falho com repo preservado e retomada sem nova criação/ref mutation.
16. **Três nichos:** cerâmica artesanal, barbearia e oficina automotiva com fontes/ofertas distintas. O briefing solicita três direções específicas; não existe template HTML de produção. As fixtures não medem a criatividade real dos modelos.

## Evidências entregues

- `evidencias/n8n-report.json`: execução com mocks em n8n real.
- `evidencias/render-report.json`: verificações do browser/axe e condições de captura.
- `evidencias/screenshots/*.jpg`: imagens reais da fixture.
- `evidencias/testes.tap`: saída da suíte automatizada final.
- `evidencias/estrutura.json`: validação estática do workflow e sintaxe.

Os screenshots são de uma página sintética de teste. Não são um exemplo gerado pelo Claude para um Instagram real, nem prova de resultado visual universal. Nenhuma nota visual Gemini foi inventada.

## Validação restante no seu ambiente

- Configurar `.env`, credencial Header Auth e Telegram, URL acessível do worker, volume persistente e repositório descartável de prova.
- Confirmar as cotas/modelos com as contas reais; conferir Apify no perfil real; executar uma geração intencional e observar as auditorias produzidas por esse job.
- Confirmar publicação/URL real em sua conta. Os testes existentes verificam protocolo e recuperação com mocks; não comprovam a disponibilidade de serviços externos na sua conta.
- Conferir políticas do host Docker e do proxy HTTPS. A garantia de no máximo uma geração depende da preservação do ledger e da identidade do bot/chat/mensagem.

Não foi realizada importação ou execução na sua instância n8n. A compatibilidade testada refere-se ao contêiner local de referência 2.41.6.
