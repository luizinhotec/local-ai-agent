param(
    [int]$Port = 8765,
    [switch]$ForceRestart
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..\\tools")
$serverScript = Join-Path $root "register_helper_server.py"
$helperUrl = "http://127.0.0.1:$Port/leather-register-helper.html"
$dashboardUrl = "http://127.0.0.1:$Port/aibtc-ops-dashboard.html"
$healthUrl = "http://127.0.0.1:$Port/api/health"

function Test-HelperHealth {
    param(
        [string]$Url
    )

    try {
        $health = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 3
        return $health.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Get-Listener {
    param(
        [int]$TargetPort
    )

    try {
        return Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $TargetPort -State Listen -ErrorAction Stop | Select-Object -First 1
    } catch {
        return $null
    }
}

Write-Host "Preparando servidor local AIBTC em http://127.0.0.1:$Port/"

$python = Get-Command python -ErrorAction SilentlyContinue
if ($null -eq $python) {
    Write-Error "python nao encontrado no PATH."
    exit 1
}

$listener = Get-Listener -TargetPort $Port

if ($null -ne $listener) {
    if (-not $ForceRestart -and (Test-HelperHealth -Url $healthUrl)) {
        Write-Host "Helper ja esta ativo e saudavel na porta $Port (PID $($listener.OwningProcess)). Reutilizando."
        Write-Host "Dashboard:"
        Write-Host $dashboardUrl
        Write-Host "Helper de registro:"
        Write-Host $helperUrl
        exit 0
    }
}

$helperProcesses = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -match "python" -and
        $_.CommandLine -match "register_helper_server\.py"
    }

if ($helperProcesses) {
    $processIds = $helperProcesses.ProcessId | Sort-Object -Unique
    Write-Host "Encerrando helper(s) antigo(s): $($processIds -join ', ')"
    $processIds | ForEach-Object {
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

for ($attempt = 0; $attempt -lt 10; $attempt++) {
    $listener = Get-Listener -TargetPort $Port
    if ($null -eq $listener) {
        break
    }
    Start-Sleep -Milliseconds 500
}

$listener = Get-Listener -TargetPort $Port

if ($null -ne $listener) {
    if (-not $ForceRestart -and (Test-HelperHealth -Url $healthUrl)) {
        Write-Host "Helper recuperado na porta $Port (PID $($listener.OwningProcess))."
        Write-Host "Dashboard:"
        Write-Host $dashboardUrl
        Write-Host "Helper de registro:"
        Write-Host $helperUrl
        exit 0
    }
    Write-Error "A porta $Port continua ocupada por outro processo nao saudavel (PID $($listener.OwningProcess))."
    exit 1
}

$env:AIBTC_HELPER_PORT = "$Port"
Start-Process -FilePath $python.Source `
    -ArgumentList @("$serverScript", "--port", "$Port") `
    -WorkingDirectory $root `
    -WindowStyle Minimized

$ready = $false
for ($attempt = 0; $attempt -lt 10; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-HelperHealth -Url $healthUrl) {
        $ready = $true
        break
    }
}

if (-not $ready) {
    Write-Error "Helper nao respondeu em $healthUrl apos a inicializacao."
    exit 1
}

Write-Host "Servidor iniciado e respondendo."
Write-Host "Dashboard:"
Write-Host $dashboardUrl
Write-Host "Helper de registro:"
Write-Host $helperUrl
