# Windows PowerShell 5.1 / PowerShell 7. Nao apaga volumes nem worker.lock.
[CmdletBinding()]
param([ValidateRange(30,600)][int]$TunnelTimeoutSeconds = 120)
$ErrorActionPreference = 'Stop'

function Invoke-DockerRaw {
    param([string[]]$DockerArgs, [int]$TimeoutSeconds = 30, [switch]$AllowFailure)
    # Capture stdout and stderr as text, without PowerShell ErrorRecord/Out-String formatting.
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = 'docker'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $quoted = foreach ($arg in $DockerArgs) {
        # Windows native argument quoting, including quotes and trailing backslashes.
        $value = [regex]::Replace($arg, '(\\*)"', '$1$1\"')
        $value = [regex]::Replace($value, '(\\+)$', '$1$1')
        '"' + $value + '"'
    }
    $info.Arguments = $quoted -join ' '
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try { $process.Kill() } catch {}
            throw "Docker excedeu ${TimeoutSeconds}s ao executar: $($DockerArgs -join ' '). Confira o Docker Desktop."
        }
        $result = [pscustomobject]@{
            Code = $process.ExitCode
            Out = $stdoutTask.GetAwaiter().GetResult()
            Err = $stderrTask.GetAwaiter().GetResult()
        }
        if ($result.Code -ne 0 -and -not $AllowFailure) {
            throw "Docker falhou ($($result.Code)): $($DockerArgs -join ' ')`n$($result.Err)`n$($result.Out)"
        }
        return $result
    } finally { $process.Dispose() }
}

function Get-Container {
    param([string]$Name)
    $result = Invoke-DockerRaw -DockerArgs @('container','inspect',$Name) -AllowFailure
    if ($result.Code -ne 0) {
        if (($result.Err + $result.Out) -match 'No such (object|container)') { return $null }
        throw "Nao consegui consultar o container ${Name}: $($result.Err)"
    }
    return @($result.Out | ConvertFrom-Json)[0]
}

function Get-ContainerLogs {
    param([string]$Name)
    $result = Invoke-DockerRaw -DockerArgs @('logs','--tail','500',$Name) -AllowFailure
    return $result.Out + "`n" + $result.Err
}

function Find-TunnelUrl {
    param([string]$LogText)
    $found = [regex]::Matches($LogText, 'https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b', 'IgnoreCase')
    $urls = @($found | ForEach-Object { $_.Value } | Where-Object { $_ -ne 'https://api.trycloudflare.com' })
    if ($urls.Count -gt 0) { return $urls[-1] }
    return $null
}

function Test-HttpReady {
    param([string]$Url)
    try {
        $reply = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return ($reply.StatusCode -eq 200)
    } catch { return $false }
}

function Start-Premium {
    Set-Location $PSScriptRoot
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker nao encontrado. Abra/instale o Docker Desktop.' }
    [void](Invoke-DockerRaw -DockerArgs @('info','--format','{{.ServerVersion}}'))

    Write-Host '1/4 Subindo o worker...'
    $up = Invoke-DockerRaw -DockerArgs @('compose','up','-d','worker') -TimeoutSeconds 120
    Write-Host ($up.Out + $up.Err).Trim()
    $workerId = (Invoke-DockerRaw -DockerArgs @('compose','ps','-q','worker')).Out.Trim()
    if (-not $workerId) { throw 'Compose nao retornou o container do worker.' }

    Write-Host '2/4 Aguardando o worker ficar saudavel...'
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    $worker = $null
    do {
        $worker = Get-Container $workerId
        if ($worker -and $worker.State.Running -and $worker.State.Health.Status -eq 'healthy') { break }
        if (-not $worker -or $worker.State.Status -eq 'exited' -or $worker.State.Status -eq 'dead') { break }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $worker -or -not $worker.State.Running -or $worker.State.Health.Status -ne 'healthy') {
        Write-Host (Get-ContainerLogs $workerId)
        throw 'Worker nao ficou saudavel. Nenhum lock ou volume foi apagado.'
    }
    $networks = @($worker.NetworkSettings.Networks.PSObject.Properties.Name)
    if ($networks.Count -ne 1) { throw 'Worker deve ter uma unica rede Docker para esta inicializacao.' }
    $network = $networks[0]

    Write-Host '3/4 Obtendo o tunnel...'
    $tunnel = Get-Container 'cf-tunnel'
    if ($tunnel -and $tunnel.State.Running) {
        if (-not ($tunnel.NetworkSettings.Networks.PSObject.Properties.Name -contains $network) -or
            -not (@($tunnel.Config.Cmd) -contains 'http://n8n:5678')) {
            throw 'cf-tunnel ativo usa outra rede/origem. Confira sua configuracao antes de substitui-lo.'
        }
        Write-Host 'Reaproveitando cf-tunnel ativo; a URL sera lida diretamente dos logs.'
    } else {
        $tunnelImage = 'cloudflare/cloudflared:latest'
        if ($tunnel) {
            $tunnelImage = $tunnel.Image
            [void](Invoke-DockerRaw -DockerArgs @('rm','cf-tunnel'))
        }
        [void](Invoke-DockerRaw -DockerArgs @('run','-d','--name','cf-tunnel','--network',$network,$tunnelImage,'tunnel','--no-autoupdate','--url','http://n8n:5678') -TimeoutSeconds 120)
    }
    $deadline = [DateTime]::UtcNow.AddSeconds($TunnelTimeoutSeconds)
    $url = $null
    do {
        $logs = Get-ContainerLogs 'cf-tunnel'
        $url = Find-TunnelUrl $logs
        $tunnel = Get-Container 'cf-tunnel'
        if (-not $tunnel -or -not $tunnel.State.Running) {
            Write-Host $logs
            throw 'O container cf-tunnel encerrou. A causa aparece nos logs acima.'
        }
        if ($url) { break }
        Write-Host 'Aguardando a Cloudflare informar a URL...'
        Start-Sleep -Seconds 3
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $url) {
        Write-Host $logs
        throw "Nao apareceu uma URL do Quick Tunnel em ${TunnelTimeoutSeconds}s. Logs brutos acima; containers e volumes preservados."
    }
    Write-Host "URL encontrada: $url"

    Write-Host '4/4 Configurando o n8n...'
    $n8n = Get-Container 'n8n'
    $sameConfig = $n8n -and
        (@($n8n.Config.Env) -contains "WEBHOOK_URL=$url") -and
        (@($n8n.Config.Env) -contains 'N8N_PROXY_HOPS=1') -and
        ($n8n.NetworkSettings.Networks.PSObject.Properties.Name -contains $network)
    if ($sameConfig -and $n8n.State.Running) {
        Write-Host 'n8n ja esta configurado; mantendo o container em execucao.'
    } elseif ($sameConfig) {
        [void](Invoke-DockerRaw -DockerArgs @('start','n8n'))
    } else {
        $n8nImage = 'docker.n8n.io/n8nio/n8n'
        if ($n8n) {
            $dataMount = @($n8n.Mounts | Where-Object { $_.Destination -eq '/home/node/.n8n' -and $_.Type -eq 'volume' -and $_.Name -eq 'n8n_data' })
            if ($dataMount.Count -ne 1) { throw 'n8n existente nao usa o volume esperado n8n_data. Nenhum container foi removido.' }
            $n8nImage = $n8n.Image
            Write-Host 'Atualizando URL/proxy do n8n; volume n8n_data e imagem atual preservados.'
            if ($n8n.State.Running) { [void](Invoke-DockerRaw -DockerArgs @('stop','n8n') -TimeoutSeconds 60) }
            [void](Invoke-DockerRaw -DockerArgs @('rm','n8n'))
        }
        [void](Invoke-DockerRaw -DockerArgs @('run','-d','--name','n8n','--network',$network,'-p','127.0.0.1:5678:5678','-e',"WEBHOOK_URL=$url",'-e','N8N_PROXY_HOPS=1','-v','n8n_data:/home/node/.n8n',$n8nImage) -TimeoutSeconds 120)
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    $ready = $false
    do {
        $ready = Test-HttpReady 'http://127.0.0.1:5678/healthz'
        if ($ready) { break }
        $n8n = Get-Container 'n8n'
        if (-not $n8n -or -not $n8n.State.Running) { break }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $ready) {
        Write-Host (Get-ContainerLogs 'n8n')
        throw 'n8n nao respondeu localmente. Veja os logs acima.'
    }

    Write-Host 'Confirmando acesso pela URL publica (DNS/tunnel)...'
    $publicReady = $false
    for ($i = 0; $i -lt 6; $i++) {
        if (Test-HttpReady ($url + '/healthz')) { $publicReady = $true; break }
        Start-Sleep -Seconds 3
    }
    if (-not $publicReady) {
        Write-Host (Get-ContainerLogs 'cf-tunnel')
        throw "n8n responde localmente, mas nao confirmei $url/healthz. Mantenha os containers e teste a URL; pode haver atraso DNS ou falha de rede."
    }
    Write-Host "`nPronto. URL publica: $url"
    Write-Host 'Abra http://localhost:5678 e publique/ative o workflow para registrar o webhook.'
    Write-Host 'Worker interno: http://worker:8787. Para novos perfis, envie ao bot; nao reinicie os servicos.'
}

# Dot-sourcing loads functions for offline tests without operating Docker.
if ($MyInvocation.InvocationName -ne '.') {
    try { Start-Premium } catch {
        Write-Host "`nFalha ao iniciar: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'Nao reconstrua o worker nem apague worker.lock por um erro de tunnel.'
        exit 1
    }
}
