# Correção da inicialização do túnel

O `start.ps1` anterior podia perder a URL na conversão dos logs de erro do Docker para texto no Windows PowerShell. Também removia o túnel a cada execução, mesmo quando ele estava funcionando. A mensagem genérica não distinguia essa situação de uma falha real da Cloudflare.

Esta versão captura stdout e stderr diretamente, verifica o estado dos contêineres e mostra os logs quando algo falha. Uma indisponibilidade da rede ou da Cloudflare ainda pode impedir a inicialização.

## Instalação manual

No Prompt de Comando, dentro de `S:\instagram-site-premium`, faça uma cópia do script atual:

```bat
copy start.ps1 start.ps1.bak
```

Substitua somente `S:\instagram-site-premium\start.ps1` pelo arquivo deste pacote. Não copie a pasta inteira sobre sua instalação. O teste e este documento são opcionais para uso diário.

Execute:

```bat
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Não é necessário executar `docker compose build worker` para atualizar um script PowerShell. Também não é necessário apagar `/data/worker.lock` por causa de um erro do túnel.

Depois de aparecer `Pronto`, abra `http://localhost:5678` e publique/ative o workflow para registrar o webhook com o endereço informado. Um túnel ativo é reaproveitado; se um novo túnel precisar ser criado, o endereço poderá mudar.

## Comportamento

- Localiza a rede pelo contêiner do worker, sem depender do nome da pasta do projeto.
- Aguarda o worker ficar saudável, preservando o banco e o lock.
- Reaproveita um `cf-tunnel` ativo que esteja na rede e na origem esperadas.
- Aguarda até 120 segundos pela URL; se o contêiner encerrar, mostra os logs imediatamente.
- Reaproveita o n8n quando a URL e o proxy já estiverem configurados. Quando é preciso recriar esse contêiner, mantém sua imagem instalada e o volume `n8n_data`; uma configuração de armazenamento diferente interrompe a substituição.
- Define `N8N_PROXY_HOPS=1` e confirma o acesso local e público ao endpoint `/healthz` antes de anunciar sucesso.
- Não altera `.env`, `config.json`, reservas do Claude, jobs ou sites. Não chama Gemini, Claude ou Apify diretamente. Como antes, subir os serviços permite que o workflow ativo processe eventos recebidos.

Se a URL não aparecer no prazo, o script exibirá o motivo disponível nos logs. Para uma conexão comprovadamente lenta, é possível aguardar mais:

```bat
powershell -ExecutionPolicy Bypass -File .\start.ps1 -TunnelTimeoutSeconds 240
```

Esse prazo é apenas para obter a URL. A conferência de acesso público tem tentativas separadas. Encontrar uma URL não garante que a conexão com a Cloudflare esteja funcionando.

## Validação realizada

Executado com PowerShell 7.4.13 em Linux: testes offline com respostas simuladas de Docker e HTTP para inicialização nova, reaproveitamento, encerramento do túnel, indisponibilidade pública, mudança de URL e proteção de armazenamento diferente. Também foi testada a captura real de stdout/stderr por processo, incluindo saída longa, aspas, espaços, barras finais e códigos de erro.

```powershell
powershell -ExecutionPolicy Bypass -File .\test\start-script.test.ps1
```

O teste acima é offline: não opera Docker nem chama serviços externos. A sintaxe do script foi escrita para Windows PowerShell 5.1 e PowerShell 7, mas não houve execução no Windows ou no Docker Desktop do usuário.
