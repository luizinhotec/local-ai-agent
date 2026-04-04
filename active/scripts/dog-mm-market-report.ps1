param()

$ErrorActionPreference = "Continue"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..") | Select-Object -ExpandProperty Path
$envFile  = Join-Path $repoRoot ".env.ps1"
$stateDir = Join-Path $repoRoot "active\state\dog-mm"

if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Force -Path $stateDir | Out-Null }

if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: .env.ps1 not found at $envFile"
    exit 1
}
. $envFile

Set-Location $repoRoot

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

# --- Run market report ---
Write-Host "dog-mm-market-report: running..."
$reportOut = node "$repoRoot\active\tools\bitflow-runtime\dog-mm-market-data.cjs" --report --json 2>&1
$reportExit = $LASTEXITCODE

Write-Host $reportOut

if ($reportExit -ne 0) {
    Write-Host "WARNING: market report exited with code $reportExit"
}

# --- Extract formatted report (lines before --- JSON ---) ---
$reportLines = $reportOut -split "`n"
$jsonSeparator = $reportLines | Select-String "--- JSON ---" | Select-Object -First 1
$telegramText = if ($jsonSeparator) {
    ($reportLines[0..($jsonSeparator.LineNumber - 2)] -join "`n").Trim()
} else {
    $reportOut.Trim()
}

# --- Extract JSON section and save snapshot ---
$jsonSection = ""
$inJson = $false
foreach ($line in $reportLines) {
    if ($line -match "--- JSON ---") { $inJson = $true; continue }
    if ($inJson) { $jsonSection += $line + "`n" }
}

if ($jsonSection.Trim()) {
    $ts = [datetime]::UtcNow.ToString("yyyy-MM-ddTHHmmssZ")
    $snapshotFile = Join-Path $stateDir "market-snapshot-$ts.json"
    $jsonSection.Trim() | Set-Content -Path $snapshotFile -Encoding UTF8
    Write-Host "snapshot saved: $snapshotFile"
}

# --- Send to Telegram ---
$telegramResult = Send-TelegramMessage $telegramText
Write-Host "telegram: $telegramResult"

Write-Host "dog-mm-market-report: DONE"
