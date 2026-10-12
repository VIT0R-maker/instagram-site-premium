# Requisitos do anexo e evidências — v3

Implementação não equivale a validação de um perfil real. A coluna de evidência distingue testes técnicos, browser real e dependências externas.

| Seção do anexo | Implementação | Evidência / limite |
|---|---|---|
| 1. Qualidade e retorno | Direção específica, curadoria por pixels, browser, refinamento, gates e retorno com URLs/estado/limitações. | Fixture comparativa real; criatividade e retorno externo exigem job real. |
| 2. Modelos e fotos | Reserva Claude antes do envio, um POST, nenhum retry/continuação/subjob; Gemini com responsabilidades; Nemotron opcional e isolado; fotos Apify. | Testes de concorrência, timeout, truncamento, stream e Nemotron. |
| 3. Consolidar principal | n8n orquestra; worker processa/persiste/publica; renderer observa isoladamente. JSON e gerador determinísticos. | `scripts/check.mjs`; 58 nós/47 origens, sem ciclo até Claude. |
| 4. Auditar dois projetos | Estados Git examinados; mapa em `INTEGRACAO.md`; referência não alterada. | Principal 24c4afd e referência 6651617 como bases observadas. |
| 5. Coleta ampliada | Carrosséis, decode, IDs, fontes, falhas parciais, SHA e dHash somente informativo; reaproveitamento de avaliações válidas. | Testes de acervo, expansão, duplicação e download. |
| 6. Curadoria contextual | Pixels + negócio, papéis, região protegida, espaço negativo, rejeição, conjunto global, logo/prioridades. Redução preserva essenciais. | Teste 11→10 mantém oito fotos de galeria e logo/hero; curadoria estética real pendente. |
| 7. Recortes | `crops.mjs`: geometria adaptada, dimensões, focais, protectedBox, riscos/alternativas e variantes no briefing. | Testes mobile/desktop e métricas do browser; máscaras/posições complexas exigem revisão visual. |
| 8. Identidade/direção | Fatos separados de inferências; três propostas estruturais; pixels na decisão; recuperação limitada de chosenId inválido. | Contratos/prompts e teste de recuperação; distinção semântica final também revisada por Gemini. |
| 9. Liberdade estrutural | Ordem variável, seções combináveis, páginas múltiplas, HTML/CSS/JS/SVG, fundos/máscaras/galerias e movimento. | Teste sem seção hero, fixture com SVG/JS/background e segunda página real no browser. |
| 10. Fontes | Vinte famílias locais e extensíveis, OFL, pesos/estilos reais, latim/acentos, fallback, carregamento com timeout. | `verifyResources`, instalação de cada família; capturas com fontes locais. |
| 11. Briefing corrigível | Fatos, links, seleção, crops, fontes, direção, estrutura/copy com dependências; evidências chegam à revisão e auditoria. | Teste refaz direção/copy ao revisar fontes sem refazer fatos/coleta. |
| 12. Única criação completa | Todas as referências com ID/hash, visão/contexto/bytes/saída antes da reserva; SSE persistido e validado. | Testes inspecionam payload; nenhuma requisição Claude real nesta entrega. |
| 13. Auditoria completa | Quatro larguras × dois movimentos; contextos adequados, dobra/full/faixas/estados, páginas adicionais; divisão de análise e consolidação. | Chromium real; página com 14 seções e 9.871 px coberta até o rodapé. |
| 14. Experiência | Ações reais teclado/mouse/toque, Escape, foco, áreas clicáveis, âncoras, sem JS; manifesto corrigível. | 36 caminhos de interação na fixture final; correção de seletor não pode remover modalidade/passo/tecla/expectativa. |
| 15. Refinamento/gate | Hash/âncora, histórico, snapshots, comparação, sem rollback por um ponto; extensão justificada e gate único. | Nota baixa provoca patch/reavaliação; defeito high bloqueia nota 97; semântico bloqueia mesmo com browser aprovado. |
| 16. Estado/SQLite | Busy handler antes de WAL, bootstrap com contenção limitada, uma instância/volume; retomada torna etapa executável e preserva ledger. | 57 testes verdes, incluindo oito processos inicializando banco novo, queda/retomada e resposta recuperada. Linux/Docker final pendente. |
| 17. Publicação | Conteúdo aprovado, commit/build corretos, caminhos relativos, recursos funcionais conferidos publicamente por hash; retomada. | Protocolo GitHub/Pages simulado; publicação real e inspeção do endereço público pendentes. |
| 18. Testes | Código, estrutura/gerador, Chromium, interação, página longa/adicional e concorrência. | `evidencias/v3`; build/importação v3 impedidos pelo daemon Docker indisponível. |
| 19. Comparação honesta | Baseline/final do mesmo job, pixels e ações reais, nenhuma nova geração; procedimento multínicho separado. | `comparacao.html`; Gemini/Claude são mocks nas fixtures. `AVALIACAO_VISUAL.md` define ensaios pagos ainda não executados. |
| 20. Reuso seletivo | Recortes, repertório de fontes, recuperação JSON e ideia de streaming adaptados; mecanismos melhores do principal preservados. | `INTEGRACAO.md` e testes direcionados. Planejador genérico não importado; opcional. |
| 21. Entrega | Código, JSON, configuração, instalação, credenciais, retomada, prompts, matriz, capturas e relatório atual. | README é a fonte operacional; evidências antigas marcadas como históricas. |

Nenhuma aprovação técnica garante excelência artística para todos os negócios. Modelos, acervo e verificação externa precisam ser exercitados no ambiente real; não há garantia “100% pronto/testado”.
