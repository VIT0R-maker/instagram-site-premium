# Offline: no Docker, Cloudflare, Telegram or model calls.
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot) 'start.ps1')
function Assert-True($Value, $Message) { if (-not $Value) { throw $Message } }
function Start-Sleep { param([int]$Seconds) }
function Get-Command { param($Name, $ErrorAction) return 'mock-docker' }
$script:url = 'https://mainstream-investments-peripherals-merger.trycloudflare.com'
Assert-True ((Find-TunnelUrl ('prefix ' * 40 + $script:url)) -eq $script:url) 'Long URL must not wrap/truncate'
Assert-True ((Find-TunnelUrl "https://api.trycloudflare.com`nhttps://old-domain.trycloudflare.com`n$script:url") -eq $script:url) 'Use last tunnel URL, not API'
Assert-True ($null -eq (Find-TunnelUrl 'Network timeout; no URL')) 'No invented URL'

function Container($Name, $Running = $true, $Url = $script:url) {
    $cmd = @('tunnel','--url','http://n8n:5678')
    return [pscustomobject]@{
        Name=$Name;Image='sha256:local-image'
        State=[pscustomobject]@{Running=$Running;Status=$(if($Running){'running'}else{'exited'});Health=[pscustomobject]@{Status='healthy'}}
        Config=[pscustomobject]@{Cmd=$cmd;Env=@("WEBHOOK_URL=$Url",'N8N_PROXY_HOPS=1')}
        NetworkSettings=[pscustomobject]@{Networks=[pscustomobject]@{'instagram-site-premium_default'=@{}}}
        Mounts=@([pscustomobject]@{Destination='/home/node/.n8n';Type='volume';Name='n8n_data'})
    }
}
function Reset-Mocks($Scenario) {
    $script:scenario=$Scenario
    $script:calls=New-Object System.Collections.Generic.List[string]
    $script:tunnel=if($Scenario -eq 'fresh' -or $Scenario -eq 'crash'){$null}else{Container 'cf-tunnel'}
    $script:n8n=if($Scenario -eq 'fresh' -or $Scenario -eq 'crash'){$null}else{Container 'n8n'}
    if($Scenario -eq 'new-url' -or $Scenario -eq 'other-volume'){$script:n8n=Container 'n8n' $true 'https://old.trycloudflare.com'}
    if($Scenario -eq 'other-volume'){$script:n8n.Mounts[0].Name='unexpected-data'}
}
function Invoke-DockerRaw {
    param([string[]]$DockerArgs,[int]$TimeoutSeconds=30,[switch]$AllowFailure)
    $command=$DockerArgs -join ' '
    $script:calls.Add($command)
    $output='';$errorText='';$code=0
    if($command -eq 'info --format {{.ServerVersion}}'){$output='29'}
    elseif($command -eq 'compose up -d worker'){$output='worker ready'}
    elseif($command -eq 'compose ps -q worker'){$output='worker-fixture'}
    elseif($command -like 'container inspect *'){
        $item=switch($DockerArgs[-1]){'worker-fixture'{Container 'worker'} 'cf-tunnel'{$script:tunnel} 'n8n'{$script:n8n}}
        if($item){$output=ConvertTo-Json -InputObject @($item) -Depth 8}else{$code=1;$errorText='Error: No such container: '+$DockerArgs[-1]}
    }
    elseif($command -like 'logs *cf-tunnel'){
        $errorText=if($script:scenario -eq 'crash'){'Cloudflare failed to start'}else{"INF Your quick Tunnel has been created!`nINF $script:url`nINF Registered tunnel connection"}
    }
    elseif($command -like 'run *--name cf-tunnel *'){$script:tunnel=Container 'cf-tunnel' ($script:scenario -ne 'crash');$output='tunnel-id'}
    elseif($command -like 'run *--name n8n *'){$script:n8n=Container 'n8n';$output='n8n-id'}
    elseif($command -eq 'stop n8n'){$script:n8n.State.Running=$false}
    elseif($command -eq 'rm n8n'){$script:n8n=$null}
    else{throw "Unexpected Docker call: $command"}
    return [pscustomobject]@{Out=$output;Err=$errorText;Code=$code}
}
function Test-HttpReady {
    param([string]$Url)
    return -not ($script:scenario -eq 'dns-delay' -and $Url.StartsWith('https:'))
}

Reset-Mocks 'reuse'
Start-Premium
Assert-True (@($script:calls | Where-Object {$_ -match '^(run|rm|stop) '}).Count -eq 0) 'Healthy containers must not be restarted'
Write-Host 'PASS: reuse healthy tunnel and n8n'

Reset-Mocks 'fresh'
Start-Premium
$runs=@($script:calls | Where-Object {$_ -match '^run '})
Assert-True ($runs.Count -eq 2) 'Fresh start creates tunnel and n8n exactly once'
Assert-True ($runs[1].Contains('N8N_PROXY_HOPS=1')) 'Proxy configuration required'
Assert-True ($runs[1].Contains("WEBHOOK_URL=$script:url")) 'Correct public URL required'
Assert-True ($runs[1].Contains('n8n_data:/home/node/.n8n')) 'Data volume must be preserved'
Write-Host 'PASS: fresh start with raw stderr URL'

Reset-Mocks 'crash'
$failed=$false
try{Start-Premium}catch{$failed=$_.Exception.Message.Contains('cf-tunnel encerrou')}
Assert-True $failed 'Tunnel crash must be reported immediately'
Assert-True (@($script:calls | Where-Object {$_ -like 'run *--name n8n *'}).Count -eq 0) 'No n8n recreation after tunnel failure'
Write-Host 'PASS: failed tunnel stops startup'

Reset-Mocks 'dns-delay'
$failed=$false
try{Start-Premium}catch{$failed=$_.Exception.Message.Contains('nao confirmei')}
Assert-True $failed 'Unreachable public URL must not be called ready'
Assert-True (@($script:calls | Where-Object {$_ -match '^(run|rm|stop) '}).Count -eq 0) 'DNS delay must preserve healthy containers'
Write-Host 'PASS: public URL failure preserves containers'

Reset-Mocks 'new-url'
Start-Premium
$changes=@($script:calls | Where-Object {$_ -match '^(run|rm|stop) '})
Assert-True ($changes.Count -eq 3 -and $changes[0] -eq 'stop n8n' -and $changes[1] -eq 'rm n8n') 'Only n8n is recreated for changed URL'
Assert-True ($changes[2].Contains("WEBHOOK_URL=$script:url") -and $changes[2].Contains('n8n_data:/home/node/.n8n') -and $changes[2].EndsWith('sha256:local-image')) 'Replacement retains volume and image with updated URL'
Write-Host 'PASS: changed URL preserves n8n volume and image'

Reset-Mocks 'other-volume'
$failed=$false
try{Start-Premium}catch{$failed=$_.Exception.Message.Contains('nao usa o volume esperado')}
Assert-True $failed 'Unknown n8n storage must stop reconfiguration'
Assert-True (@($script:calls | Where-Object {$_ -match '^(run|rm|stop) '}).Count -eq 0) 'Unknown storage must not be replaced'
Write-Host 'PASS: unexpected n8n storage is preserved'
Write-Host 'PASS: URL parsing scenarios'
