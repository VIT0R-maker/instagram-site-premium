# Entrega v3 — 12/10/2026

A revisão consolida o repositório principal depois de consultar `criador-premium`. A geração única persistente e a publicação por bytes aprovados foram preservadas.

- Corrigida inicialização SQLite: busy handler antes de WAL/DDL e retry limitado somente em contenção da inicialização. O teste agora inicia oito processos sobre banco novo.
- Recortes: geometria adaptada da referência, regiões protegidas, alternativas por proporção, sugestões diferentes mobile/desktop e verificação do enquadramento real.
- Tipografia: catálogo passou de oito para vinte famílias locais, com pesos/estilos verificados, acentos e licenças. Não foram copiadas URLs externas com pesos presumidos.
- Curadoria: reserva de candidatos de logo, prioridades de recursos, redução correta sem esvaziar galeria, reaproveitamento de análises na expansão e rejeitadas fora da seleção.
- Briefing: revisão pode reparar causas além da copy. Direção inválida tem recuperação limitada. Estrutura não exige primeira seção chamada hero; recursos opcionais não são obrigatórios no DOM.
- Claude: streaming com término inequívoco, erro explícito propagado, resposta bruta persistida e nenhuma segunda geração. Saída padrão de 48 mil tokens validada contra modelo/complexidade. Todas as referências selecionadas continuam presentes.
- Gemini: recuperação limitada de JSON, contagem de contexto, orçamento persistente e auditoria visual em lotes sem omitir o final da página.
- Renderer: enquadramento da dobra verificado, fontes com timeout, desktop com mouse/hover, mobile com toque, capturas contíguas legíveis nos dois modos e teste de página adicional.
- Correção: snapshots, hashes/âncoras, nova renderização obrigatória, manifesto corrigível sem apagar ações e orçamento maior somente quando justificado. High/critical bloqueiam independentemente da nota.
- Retomada: verifica propriedade e estado, reabre somente primeira etapa recuperável, renova polling apropriado e preserva geração/artefatos/publicação.
- Export: JSON determinístico e teste de igualdade com gerador. Prompts/contratos/documentação sincronizados; relatórios antigos identificados como históricos.

Não foram importados o template fixo, o descarte perceptual automático, o limite de cinco referências, a exclusão da logo, o parser de stream que engole erros nem o gate baseado apenas em média do projeto de referência. Os 58 nós continuam: simplificar o planejador era opcional e não foi necessário para estas melhorias.

Resultados medidos e limitações: [VALIDACAO.md](VALIDACAO.md). Instalação e parâmetros atuais: [README.md](README.md).
