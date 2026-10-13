# Sobe tudo: worker + tunnel (URL nova) + n8n com o WEBHOOK_URL certo.
# Uso (PowerShell, qualquer pasta):  .\start.ps1
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$net = 'instagram-site-premium_default'

Write-Host '1/4 Subindo o worker...'
docker compose up -d worker
if ($LASTEXITCODE -ne 0) { Write-Host 'Falha ao subir o worker.'; exit 1 }

Write-Host '2/4 Aguardando o worker ficar saudavel...'
$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  $status = (docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' instagram-site-premium-worker-1 2>$null)
  if ($status -match 'running healthy') { $healthy = $true; break }
  if ($status -match 'exited') { break }
  Start-Sleep -Seconds 2
}
if (-not $healthy) {
  Write-Host 'Worker nao ficou saudavel. Ultimas linhas do log:'
  docker compose logs --tail 5 worker
  Write-Host 'Se a ultima linha for LOCK_STALE ou INTERNAL, remova o lock: docker compose run --rm -T --entrypoint rm worker -f /data/worker.lock'
  exit 1
}

Write-Host '3/4 Iniciando o tunnel...'
docker rm -f cf-tunnel *> $null
docker run -d --name cf-tunnel --network $net cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://n8n:5678 | Out-Null
$url = $null
for ($i = 0; $i -lt 40 -and -not $url; $i++) {
  Start-Sleep -Seconds 2
  $logs = (docker logs cf-tunnel 2>&1 | Out-String)
  foreach ($m in [regex]::Matches($logs, 'https://[a-z0-9-]+\.trycloudflare\.com')) {
    if ($m.Value -notlike 'https://api.*') { $url = $m.Value; break }
  }
}
if (-not $url) { Write-Host 'Nao consegui ler a URL do tunnel. Veja: docker logs cf-tunnel'; exit 1 }

Write-Host "4/4 Iniciando o n8n com WEBHOOK_URL=$url"
docker rm -f n8n *> $null
docker run -d --name n8n --network $net -p 127.0.0.1:5678:5678 -e "WEBHOOK_URL=$url" -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'Falha ao subir o n8n.'; exit 1 }

Write-Host ''
Write-Host "Pronto. URL publica: $url"
Write-Host 'Abra http://localhost:5678, abra o workflow e clique em Publish para registrar o webhook.'
Write-Host 'Dentro do n8n o worker tambem responde em http://worker:8787.'
