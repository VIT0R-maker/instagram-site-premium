# Desliga tudo de forma limpa (nao apaga volumes).
# Uso:  .\stop.ps1
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
Write-Host 'Parando n8n e tunnel...'
docker stop n8n cf-tunnel *> $null
Write-Host 'Parando o worker (SIGTERM, para fechar o banco e apagar o lock)...'
docker compose stop worker
Write-Host 'Pronto. Os volumes worker-data e n8n_data foram preservados.'
