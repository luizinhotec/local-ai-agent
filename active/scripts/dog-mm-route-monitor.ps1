param()

$ErrorActionPreference = "Continue"

$repoRoot  = Resolve-Path (Join-Path $PSScriptRoot "..\..") | Select-Object -ExpandProperty Path
$envFile   = Join-Path $repoRoot ".env.ps1"
$logDir    = Join-Path $repoRoot "logs"
$logFile   = Join-Path $logDir "dog-mm-monitor.log"
$scanJson  = Join-Path $repoRoot "active\state\dog-mm\dog-mm-opportunity-scan.json"
$stateDir  = Join-Path $repoRoot "active\state\dog-mm"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

function Write-MonitorLog {
    param([string]$Line)
    $ts = [datetime]::UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC")
    $entry = "[$ts] $Line"
    Write-Host $entry
    Add-Content -Path $logFile -Value $entry
}

function Send-TelegramMessage {
    param([string]$Text)
    $script = @"
const fs = require('fs');
const path = require('path');
const envPath = path.join('$($repoRoot -replace '\\','/')', '.env.local');
const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath,'utf8').split(/\r?\n/) : [];
const env = {};
for (const l of lines) {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}
const token  = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const chatId = env.TELEGRAM_CHAT_ID   || process.env.TELEGRAM_CHAT_ID   || '';
if (!token || !chatId) { console.log('telegram_skip: no credentials'); process.exit(0); }
fetch('https://api.telegram.org/bot'+token+'/sendMessage', {
  method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ chat_id: chatId, text: decodeURIComponent('$([Uri]::EscapeDataString($Text))') })
}).then(r=>r.json()).then(b=>{ console.log('telegram_ok: message_id='+b.result?.message_id); }).catch(e=>{ console.log('telegram_error: '+e.message); });
"@
    node -e $script 2>&1
}

# --- Load env ---
if (-not (Test-Path $envFile)) {
    Write-MonitorLog "ERROR: .env.ps1 not found at $envFile"
    exit 1
}
. $envFile

Set-Location $repoRoot

Write-MonitorLog "dog-mm-route-monitor: START"

# Send startup heartbeat only on first cycle (no MONITOR_STARTED_SENT env yet)
if (-not $env:DOG_MM_MONITOR_STARTED_SENT) {
    Send-TelegramMessage "DOG MM Monitor iniciado. Aguardando rota sBTC-USDCx na Bitflow. Verificando a cada 1h."
    $env:DOG_MM_MONITOR_STARTED_SENT = "1"
}

# --- Market data check ---
Write-MonitorLog "running market data check..."
$marketJson = node "$repoRoot\active\tools\bitflow-runtime\dog-mm-market-data.cjs" --json 2>&1
$marketFavorable = $true
$marketReason = "unknown"
$marketPriceBitflow = "n/a"
$marketPriceKraken = "n/a"
$marketSpread = "n/a"

try {
    $marketData = $marketJson | ConvertFrom-Json -ErrorAction Stop
    $snapshot = $marketData.snapshot
    if ($snapshot) {
        if ($snapshot.price_bitflow) { $marketPriceBitflow = $snapshot.price_bitflow.ToString("0.00000000") }
        if ($snapshot.price_kraken)  { $marketPriceKraken  = $snapshot.price_kraken.ToString("0.00000000") }
        if ($snapshot.spread_pct)    { $marketSpread       = $snapshot.spread_pct.ToString("0.0000") + "%" }
    }
    $marketFavorable = [bool]$marketData.favorable
    $marketReason    = $marketData.reason
} catch {
    Write-MonitorLog "WARN: could not parse market data JSON — continuing with scan"
}

Write-MonitorLog "market_favorable: $marketFavorable | reason: $marketReason | bitflow: $marketPriceBitflow | kraken: $marketPriceKraken | spread: $marketSpread"

if (-not $marketFavorable) {
    Write-MonitorLog "market unfavorable ($marketReason) — skipping scan this cycle"
    Write-MonitorLog "dog-mm-route-monitor: END"
    exit 0
}

# --- Run scanner ---
Write-MonitorLog "running npm run dog-mm:scan..."
$scanOut = npm.cmd run dog-mm:scan 2>&1
$scanExit = $LASTEXITCODE
Write-MonitorLog "scanner exit_code: $scanExit"

if (-not (Test-Path $scanJson)) {
    Write-MonitorLog "ERROR: scan JSON not found after scan run"
    Send-TelegramMessage "ERRO: dog-mm-route-monitor nao encontrou scan JSON"
    exit 1
}

# --- Read scan result ---
$scan = Get-Content $scanJson -Raw | ConvertFrom-Json
$dominantCause   = $scan.summary.dominantCauseAggregate
$promisingExists = [bool]$scan.summary.promisingCandidateExists

# Route detected when at least one candidate has a real pathSignature (not "no-path")
$routeFound = ($scan.results | Where-Object { $_.pathSignature -and $_.pathSignature -ne "no-path" } | Select-Object -First 1) -ne $null

Write-MonitorLog "dominant_cause: $dominantCause | promising: $promisingExists | route_found: $routeFound"

# --- Decision ---
if ($routeFound -or ($dominantCause -ne "VALIDATION_BLOCKED" -and $promisingExists -eq $true)) {

    Write-MonitorLog "ROUTE FOUND - initiating dry-run..."
    Send-TelegramMessage "DOG MM - Rota encontrada! Iniciando dry-run fase 0..."

    # Run study (dry-run)
    Write-MonitorLog "running npm run dog-mm:study..."
    $studyOut = npm.cmd run dog-mm:study 2>&1
    $studyExit = $LASTEXITCODE
    Write-MonitorLog "study exit_code: $studyExit"

    # Save timestamped result
    $ts = [datetime]::UtcNow.ToString("yyyy-MM-ddTHHmmssZ")
    $autoResultFile = Join-Path $stateDir "auto-dryrun-$ts.json"

    $studySource = Join-Path $stateDir "study\dog-mm-dry-run-study.json"
    if (Test-Path $studySource) {
        Copy-Item $studySource $autoResultFile
        Write-MonitorLog "saved dry-run result to: $autoResultFile"
    } else {
        Write-MonitorLog "WARN: study JSON not found at $studySource"
    }

    # Build Telegram summary
    $bestCandidate = if ($scan.summary.bestByScore) { $scan.summary.bestByScore.candidateId } else { "n/a" }
    $msg = "DOG MM - Dry-run fase 0 concluido`npair: sBTC->USDCx`nbest_candidate: $bestCandidate`ndominant_cause: $dominantCause`nstudy_exit: $studyExit`nresult: $autoResultFile`n`nMercado:`n  bitflow: $marketPriceBitflow`n  kraken:  $marketPriceKraken`n  spread:  $marketSpread"
    Send-TelegramMessage $msg
    Write-MonitorLog "Telegram alert sent with dry-run summary"

} else {
    # Silent log only — no Telegram when no route
    Write-MonitorLog "no route available (dominant_cause=$dominantCause, promising=$promisingExists) - skipping"
}

Write-MonitorLog "dog-mm-route-monitor: END"
