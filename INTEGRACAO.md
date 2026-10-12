# Auditoria da integração — 12/10/2026

Estados verificados via Git: principal `24c4afd3871b09a4d10da7db65742009cfaab8ec`; referência `6651617410823f02eda3d326c8820307300634d8`. O segundo repositório foi apenas consultado. A implementação final fica neste projeto.

| Decisão | Evidência inicial / finalidade |
|---|---|
| Preservar | Reserva SQLite antes do único POST Claude, envio de todas as referências, coleta expandida, recursos locais e verificação de bytes publicados são superiores no principal. |
| Corrigir | `busy_timeout` era instalado depois de WAL; inicialização concorrente podia falhar antes do handler. |
| Corrigir | Brief review só reconstruía copy; escolha inválida de direção não tinha recuperação; expansão perdia avaliações válidas. |
| Adaptar | Geometria `cropFit` do módulo assets da referência, mantendo sugestões livres por dispositivo e todos os metadados. |
| Adaptar | Repertório de fontes da referência, com pacotes locais/licenças/pesos reais; não copiar URLs Google com pesos inexistentes. |
| Adaptar | Recuperação limitada de JSON Gemini; não copiar parser SSE que engole exceções de eventos de erro. |
| Remover | Obrigação de primeira seção chamada hero e de utilizar fotos opcionais; teto universal de oito famílias. |
| Acrescentar | Correção dirigida de dependências do briefing, classificação de recursos, cobertura por faixas legíveis até o rodapé, divisão de auditoria visual e correção justificada do manifesto. |
| Não importar | Dedupe perceptual destrutivo, limite de cinco referências, exclusão de logo, seção universal, fallback para primeira direção, aprovação apenas por média. |
| Consolidar | Manter sete etapas existentes: simplificação do planejador é opcional e não melhora a qualidade visual nesta entrega. Remover documentação corrente obsoleta e identificar evidências antigas. |

Streaming foi avaliado separadamente: permite conexão longa sem repetir geração, mas exige término inequívoco e persistência antes da interpretação. A decisão final e a validação estão em VALIDACAO.md.
