# Publicação por nota visual e relatório no Telegram

A política `visual-score-v1` usa somente a média dos seis critérios visuais
e o `qualityThreshold` do config.json (85 nesta instalação) para aprovar a qualidade.
Diagnósticos técnicos, testes do navegador, avaliação semântica, ausência de cenários
de interação e severidades do Gemini são observações, não vetos adicionais.
Informações Apify continuam autoritativas. A geração única do Claude não foi alterada.

As proteções de credenciais, caminhos de arquivos, integridade da versão revisada,
autenticação e limites operacionais permanecem. Falha da API, falta de arquivos,
ausência de nota válida ou erro do GitHub não podem ser convertidos em sucesso.
Uma nota abaixo de 85 pode iniciar correções dentro do orçamento existente; ao
atingir 85, nenhuma nova rodada é necessária. O publisher não reaplica o antigo
critério de ausência total de diagnósticos.

## Instalar no Windows

1. Na pasta S:\instagram-site-premium, execute:

   ```bat
   powershell -ExecutionPolicy Bypass -File .\stop.ps1
   ```

2. Faça backup dos arquivos locais que substituirá. Extraia o ZIP de correção na
   raiz do projeto, mesclando as pastas src, scripts e test. O pacote não contém
   .env, banco de dados nem config.json; não apague volumes ou a pasta do projeto.
   Aplique todos os arquivos juntos, inclusive o novo src/audit-policy.mjs.

3. Reconstrua e inicie:

   ```bat
   docker compose build worker
   powershell -ExecutionPolicy Bypass -File .\start.ps1
   ```

4. No n8n, desative o fluxo antigo e importe workflow_instagram_site_premium.json
   do pacote. Selecione suas credenciais Telegram e Header Auth do worker.
   Confira workerBaseUrl no nó Contexto: dentro deste Compose use
   http://worker:8787. Publique/ative apenas o novo fluxo com esse bot.
   O túnel pode ter outra URL após iniciar; Publish registra o webhook novamente.

5. No Telegram, envie somente:

   ```text
   /retomar 24ee1d585b3de09cf9701dce
   ```

## Recuperação do job existente

A retomada procura relatórios audit-0 a audit-8 nos checkpoints persistidos e
seleciona a maior nota que atinja o mínimo. Para reutilizar uma nota, todos os
arquivos da pasta audit-versions daquela rodada devem corresponder aos hashes
salvos no relatório. No caso informado, a rodada 2 tem 91,67 e é elegível.

Se a versão estiver íntegra, a auditoria a copia para site/, grava approval.json
com reusedReview=true e segue para publicação SEM chamar Gemini ou Claude.
Também consegue recuperar jobs encerrados pela antiga política de auditoria.
Não apaga o histórico: um audit-2.json antigo pode continuar com passed=false;
a aprovação vigente está em approval.json, identificada pela nova política.
Se os artefatos expiraram, desapareceram ou foram alterados, a recuperação não é
garantida. Nunca se usa a nota de uma versão para aprovar arquivos diferentes.

Interromper apenas a execução no n8n não necessariamente interrompe o worker.
Por isso a instalação começa por stop.ps1, preservando volumes e checkpoints.

## Telegram

Depois de publicar, o fluxo envia o link e o relatório: nota, seis critérios,
observações visuais, descrição/evidência/sugestão, diagnósticos locais, erros
dos testes, observações semânticas e limitações. Repetições idênticas são
agrupadas com contagem, sem omitir os diferentes problemas.
Em falha também envia o último relatório disponível, além do diagnóstico.

Mensagens longas são divididas em partes, com intervalo de um segundo. HTML
é escapado para impedir os erros can't parse entities vistos anteriormente.
Os novos nós de notificação não fazem chamadas a modelos.
Não há como garantir entrega se a API Telegram ou a credencial falhar.

## Verificação desta entrega

Testes com respostas de modelos e renderização simuladas cobrem limite 85,
publicação com observações, recuperação de snapshots antigos sem chamadas de IA,
rejeição de snapshots alterados, reconhecimento de alt, mensagens extensas e
escape HTML. Nenhuma chamada paga foi feita para testar esta correção.
Importação no seu n8n e publicação real dependem de execução no seu computador.
