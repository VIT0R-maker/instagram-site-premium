# Avaliação reproduzível entre nichos

Este procedimento não foi executado com modelos pagos nesta entrega. A fixture Chromium demonstra infraestrutura de detecção/correção, não criatividade dos modelos. Notas de modelo não substituem inspeção humana nem tornam todo site excepcional.

## Casos intencionais separados

Após validar Docker, credenciais e orçamento, escolha perfis públicos autorizados para pelo menos: produto artesanal com acervo rico, serviço local com acervo mediano, portfólio com fotografias verticais, e oferta com pouca fotografia/hero tipográfico. Inclua caso com logo e sem contato comprovado. Não use fotografias de uma empresa como se fossem de outra.

Registre perfil, data, autorização, configurações, versões dos modelos e teto financeiro antes de iniciar. Cada perfil enviado como nova mensagem é um pedido de teste separado. Reenvio do mesmo evento e `/retomar JOB` devem manter a mesma reserva. Nunca gere variantes adicionais dentro do mesmo job para comparar estilos.

## Material a conservar

Conserve privadamente por job: coleção e evidências textuais, avaliações por assetId, seleção/prioridades, direção e justificativa, briefing final, metadados da requisição Claude, baseline sem patches, versões corrigidas, capturas por largura/movimento/posição, testes de interação, revisão semântica, patches e aprovação por hash. Não publique fontes brutas, segredos, jobId ou respostas privadas no site.

Compare baseline e final do **mesmo job**, no mesmo dispositivo, largura, DPR, fontes e modo de movimento. Use dobra e faixas pelo mesmo y; a altura final pode mudar por uma correção legítima. Não compare seções diferentes apenas porque seus screenshots têm o mesmo índice. Compare páginas completas somente como visão de conjunto; leia as faixas sem reduzir texto a miniatura.

## Revisão independente

Um avaliador lê o negócio e as evidências antes de ver a nota Gemini. Para cada critério, registre observação concreta, captura/viewport e severidade:

| Critério | O que observar |
|---|---|
| Especificidade | O layout, a tipografia e a fotografia parecem adequados a este negócio? Está apenas repetindo a solução de outro nicho? |
| Dobra inicial | Oferta compreensível, hierarquia clara, foto ou hero tipográfico bem composto, CTA legítimo e legível. |
| Página completa | Ritmo, continuidade, ausência de blocos vazios, extensão proporcional à evidência e acabamento no rodapé. |
| Fotografias | Assunto protegido, enquadramentos distintos mobile/desktop, fidelidade de origem, logo legível e ausência de repetição gratuita. |
| Tipografia | Família pertinente, pesos/estilos carregados, acentos, escala, quebras e conforto de leitura. |
| Experiência | Teclado/mouse/toque, destino dos links, menu, lightbox/galeria se existentes, foco e conteúdo sem JS. |
| Movimento | Observe no browser/vídeo: intenção, transições, ausência de salto ou conteúdo preso; compare reduced motion. rAF virtualizado não é benchmark de aparelho real. |
| Veracidade | Todas as ofertas, contatos e afirmações estão sustentadas? Reformulações preservam sentido? |
| Autonomia | Quantas intervenções humanas foram necessárias e por quê? Houve recuperação sem segunda geração? |

Uma falha relevante impede aprovação, independentemente da média. Para qualidade subjetiva, registre desacordos humanos/modelo; não esconda um nicho ruim atrás da média dos demais. Guarde baseline/final quando houver condições justas; sem baseline comparável, apresente somente avaliação absoluta e declare a limitação.

## Verificação pública

Após Pages retornar `published`, confira o commit, URLs e hashes registrados. Abra o endereço público no desktop/mobile e repita ao menos navegação, CTA e interações principais, procurando diferença de carregamento/caminho em relação ao renderer. Nesta versão, a verificação automática externa compara bytes dos recursos e build; a inspeção em navegador do endereço público é este passo adicional no ambiente real.
