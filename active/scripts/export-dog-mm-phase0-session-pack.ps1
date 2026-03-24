param(
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"

$resolvedOutputDir = if ($OutputDir) {
    $OutputDir
} else {
    Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session"
}

New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null
$resolvedOutputDir = (Resolve-Path $resolvedOutputDir).Path

$briefScript = Join-Path $PSScriptRoot "export-dog-mm-phase0-execution-brief.ps1"
$preflightScript = Join-Path $PSScriptRoot "test-dog-mm-phase0-preflight.ps1"
$statusScript = Join-Path $PSScriptRoot "show-dog-mm-status.ps1"
$liveStatusScript = Join-Path $PSScriptRoot "get-dog-mm-phase0-live-status.ps1"
$templatePath = Join-Path $PSScriptRoot "..\templates\aibtc\dog-mm\dog-mm-phase0-shadow-log-entry.template.md"
$liveMonitorPath = Join-Path $resolvedOutputDir "dog-mm-phase0-live-monitor.md"

$null = powershell -ExecutionPolicy Bypass -File $briefScript
$preflight = powershell -ExecutionPolicy Bypass -File $preflightScript | ConvertFrom-Json
$status = powershell -ExecutionPolicy Bypass -File $statusScript | ConvertFrom-Json
try {
    $live = powershell -ExecutionPolicy Bypass -File $liveStatusScript | ConvertFrom-Json
} catch {
    if (Test-Path $liveMonitorPath) {
        $liveMonitorLines = Get-Content $liveMonitorPath
        $lookup = @{}
        foreach ($line in $liveMonitorLines) {
            if ($line -match '^- ([^:]+):\s*(.*)$') {
                $lookup[$matches[1]] = $matches[2]
            }
        }

        $live = [pscustomobject]@{
            openTxId = $lookup["open_txid"]
            openTxStatus = $lookup["open_tx_status"]
            openBlockHeight = $lookup["open_block_height"]
            unsignedBinId = $lookup["unsigned_bin_id"]
            lpTokenAmount = $lookup["lp_token_amount"]
            coversActiveBin = $lookup["covers_active_bin"]
            liquidity = [pscustomobject]@{
                totalValueUsd = $lookup["total_value_usd"]
            }
            nextAction = $lookup["next_action"]
        }
    } else {
        throw
    }
}

$logOutputPath = Join-Path $resolvedOutputDir "dog-mm-phase0-log-entry.md"
Copy-Item $templatePath $logOutputPath -Force

$summaryPath = Join-Path $resolvedOutputDir "dog-mm-phase0-session-summary.md"
$lines = @(
    "# DOG MM Phase 0 Session Pack",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Status",
    "",
    "- stage: $($status.stage)",
    "- wallet_name: $($status.wallet.name)",
    "- wallet_validated: $($status.wallet.validated)",
    "- wallet_funded: $($status.wallet.funded)",
    "",
    "## Session Configuration",
    "",
    "- pool: $($preflight.selectedPool)",
    "- bin_step: $($preflight.selectedBinStep)",
    "- launch_ready: $($preflight.readiness.phase0LaunchReady)",
    "- next_action: $($live.nextAction)",
    "- suggested_initial_capital_usd: 20",
    "- observation_window: 24h",
    "- recenter_max: 1",
    "",
    "## Live Position",
    "",
    "- open_txid: $($live.openTxId)",
    "- open_tx_status: $($live.openTxStatus)",
    "- open_block_height: $($live.openBlockHeight)",
    "- unsigned_bin_id: $($live.unsignedBinId)",
    "- lp_token_amount: $($live.lpTokenAmount)",
    "- covers_active_bin: $($live.coversActiveBin)",
    "- live_value_usd: $($live.liquidity.totalValueUsd)",
    "",
    "## Files",
    "",
    "- execution_brief: C:\dev\local-ai-agent\active\state\dog-mm\dog-mm-phase0-execution-brief.md",
    "- pretrade_snapshot: C:\dev\local-ai-agent\active\state\dog-mm\phase0-session\dog-mm-phase0-pretrade-snapshot.md",
    "- action_sheet: C:\dev\local-ai-agent\active\state\dog-mm\phase0-session\dog-mm-phase0-action-sheet.md",
    "- monitor_card: C:\dev\local-ai-agent\active\state\dog-mm\phase0-session\dog-mm-phase0-monitor-card.md",
    "- live_monitor: C:\dev\local-ai-agent\active\state\dog-mm\phase0-session\dog-mm-phase0-live-monitor.md",
    "- session_log_template: $logOutputPath",
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($summaryPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM phase 0 session pack exported to: $resolvedOutputDir"
