# Correção do HTTP 409 no preflight

O preflight grava `permission-check.txt` no repositório descartável configurado em `GITHUB_PROBE_REPO`. A atualização inclui o SHA que foi lido imediatamente antes. Se o arquivo ou a referência do repositório mudar durante essa operação, o GitHub pode responder HTTP 409, com uma mensagem como `is at ... but expected ...`.

O código anterior interrompia o job no primeiro conflito. Esta correção relê o arquivo e repete somente a gravação de prova, usando o SHA atual e a mesma branch. São no máximo quatro tentativas, com pausas de 0,5, 1 e 2 segundos. Outros erros continuam sendo informados. Se a disputa persistir, o job para com `GITHUB_PROBE_CONFLICT`, sem aprovar indevidamente o teste de permissão.

A mensagem recebida não identifica qual processo alterou a referência. Execuções concorrentes são uma causa possível; não se pode afirmar, apenas por esse erro, que existe outro workflow ativo.

## Instalação no Windows

Na pasta `S:\instagram-site-premium`, faça uma cópia do arquivo atual:

```bat
copy src\publish.mjs src\publish.mjs.bak
```

Substitua apenas `S:\instagram-site-premium\src\publish.mjs` pelo `src/publish.mjs` deste pacote. O teste e este documento são opcionais para a instalação. O pacote não contém `config.json`, `.env` ou workflow n8n, portanto não altera seu timeout local de 900000 ms.

Como este arquivo fica dentro da imagem do worker, aplique a mudança com:

```bat
powershell -ExecutionPolicy Bypass -File .\stop.ps1
docker compose build worker
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Depois de o script informar `Pronto`, abra `http://localhost:5678` e publique/ative o workflow para registrar o webhook do endereço atual.

No Telegram, retome o job que falhou no preflight:

```text
/retomar bfc7dbaee580d19cc7d14bde
```

Não é necessário reenviar o link do Instagram para esse erro. O preflight acontece antes da coleta, curadoria e geração. A retomada tenta concluir o preflight e, se ele passar, segue com as etapas normais e suas chamadas às APIs. A correção não libera outra chamada para o job antigo `5a49282dcbcec7e6aed80bba`, que ficou sem resposta persistida do Claude.

Nenhum volume, lock ou reserva de geração precisa ser apagado. A instalação reinicia os serviços; aguarde outras execuções terminarem antes de aplicar, se houver alguma em andamento.

## Validação

O erro HTTP 409 foi reproduzido com o código anterior. Após a correção, passaram 16 testes offline em Node.js 24.19.0, incluindo:

- nova leitura do SHA após conflito e limitação de tentativas;
- duas execuções concorrentes sobre o mesmo arquivo de prova;
- criação do arquivo ausente e preservação de erros não relacionados ao conflito;
- retomada de preflight falho sem consumir reserva Claude;
- testes existentes de publicação, retomada e geração única em oito processos.

```bat
node --test test/preflight-conflict.test.mjs test/publication.test.mjs
```

As respostas do GitHub foram simuladas. Os testes não chamaram Claude, Gemini ou Apify, nem gravaram no repositório de prova real. O corpo da função `publishSite`, que publica os sites finais, foi preservado.
