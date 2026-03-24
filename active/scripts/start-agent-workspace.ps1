param(
    [int]$IntervalSeconds = 60,
    [int]$AmountSats = 3000,
    [bool]$AutoSafeActions = $true,
    [switch]$IncludeMonitor,
    [switch]$Preview
)

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logsDir = Join-Path $root "logs"
$speedyLog = Join-Path $logsDir "speedy-indra"
$standardLoopLog = Join-Path $logsDir "standard-loop.log"
$greenCircle = [System.Char]::ConvertFromUtf32(0x1F7E2)
$yellowCircle = [System.Char]::ConvertFromUtf32(0x1F7E1)
$blueCircle = [System.Char]::ConvertFromUtf32(0x1F535)
$purpleCircle = [System.Char]::ConvertFromUtf32(0x1F7E3)

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
New-Item -ItemType Directory -Force -Path $speedyLog | Out-Null

function New-TerminalCommand {
    param(
        [string]$Title,
        [string[]]$Lines
    )

    $escapedTitle = $Title.Replace("'", "''")
    $body = @(
        "`$Host.UI.RawUI.WindowTitle = '$escapedTitle'"
        "Set-Location '$root'"
        "if (Test-Path '.env') {"
        "  Get-Content '.env' | ForEach-Object {"
        "    `$line = `$_.Trim()"
        "    if (-not `$line -or `$line.StartsWith('#')) { return }"
        "    `$parts = `$line -split '=', 2"
        "    if (`$parts.Length -ne 2) { return }"
        "    `$key = `$parts[0].Trim()"
        "    `$value = `$parts[1].Trim().Trim('""').Trim(""'"")"
        "    if (-not [string]::IsNullOrWhiteSpace(`$key) -and -not (Test-Path ""Env:`$key"")) {"
        "      Set-Item -Path ""Env:`$key"" -Value `$value"
        "    }"
        "  }"
        "}"
    ) + $Lines

    return ($body -join '; ')
}

function Start-WorkspaceTerminal {
    param(
        [string]$Title,
        [string[]]$Lines
    )

    $command = New-TerminalCommand -Title $Title -Lines $Lines
    if ($Preview) {
        Write-Host ""
        Write-Host "[$Title]" -ForegroundColor Cyan
        Write-Host $command -ForegroundColor DarkGray
        return
    }

    Start-Process powershell -ArgumentList @(
        "-NoLogo",
        "-NoExit",
        "-ExecutionPolicy", "Bypass",
        "-Command", $command
    ) | Out-Null
}

$loopTitle = "$greenCircle SPEEDY INDRA - LOOP (NAO MEXER)"
$logsTitle = "$yellowCircle SPEEDY INDRA - LOGS (TEMPO REAL)"
$controlTitle = "$blueCircle SPEEDY INDRA - CONTROLE"
$monitorTitle = "$purpleCircle SPEEDY INDRA - MONITOR"

$loopLines = @(
    "Write-Host 'SPEEDY INDRA LOOP PADRAO - NAO MEXER NESTA JANELA' -ForegroundColor Green",
    "Write-Host 'Uso exclusivo do loop fail-closed.' -ForegroundColor Yellow",
    "npm run agent:loop:standard -- --interval-seconds=$IntervalSeconds --amount-sats=$AmountSats --auto-safe-actions=$($AutoSafeActions.ToString().ToLower()) 2>&1 | Tee-Object -FilePath '$standardLoopLog' -Append"
)

$logsLines = @(
    "Write-Host 'MONITOR DE LOGS EM TEMPO REAL' -ForegroundColor Yellow",
    "Write-Host 'Arquivo: logs/speedy-indra/agent-log.jsonl' -ForegroundColor DarkYellow",
    "Get-Content 'logs/speedy-indra/agent-log.jsonl' -Wait"
)

$controlLines = @(
    "Write-Host 'CONTROLE OPERACIONAL DO SPEEDY INDRA' -ForegroundColor Cyan",
    "Write-Host ''",
    "Write-Host 'Comandos uteis:' -ForegroundColor White",
    "Write-Host '  npm run agent:audit:safe' -ForegroundColor Gray",
    "Write-Host '  node runtime/speedy-indra/agent-status.cjs' -ForegroundColor Gray",
    "Write-Host '  npm run agent:next-action -- --dry-run --amount-sats=$AmountSats' -ForegroundColor Gray",
    "Write-Host '  npm run agent:messages -- --status-only' -ForegroundColor Gray",
    "Write-Host ''",
    "Write-Host 'Esta janela e para operacao manual segura.' -ForegroundColor Blue"
)

$monitorLines = @(
    "Write-Host 'MONITOR SOMENTE LEITURA DO SPEEDY INDRA' -ForegroundColor Magenta",
    "Write-Host 'Alertas: INFO, WARNING, ALERT' -ForegroundColor DarkMagenta",
    "node runtime/speedy-indra/agent-monitor.cjs"
)

Write-Host "Preparando workspace operacional do Speedy Indra..." -ForegroundColor Green
Write-Host "Root: $root" -ForegroundColor DarkGreen

Start-WorkspaceTerminal -Title $loopTitle -Lines $loopLines
Start-WorkspaceTerminal -Title $logsTitle -Lines $logsLines
Start-WorkspaceTerminal -Title $controlTitle -Lines $controlLines

if ($IncludeMonitor) {
    Start-WorkspaceTerminal -Title $monitorTitle -Lines $monitorLines
}

if ($Preview) {
    Write-Host ""
    Write-Host "Preview concluido. Nenhuma janela foi aberta." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "Workspace iniciado." -ForegroundColor Green
}
