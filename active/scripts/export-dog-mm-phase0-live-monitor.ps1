param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session\dog-mm-phase0-live-monitor.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }

$statusScript = Join-Path $PSScriptRoot "get-dog-mm-phase0-live-status.ps1"
$live = powershell -ExecutionPolicy Bypass -File $statusScript | ConvertFrom-Json

$lines = @(
    "# DOG MM Phase 0 Live Monitor",
    "",
    "- generated_at_utc: $($live.checkedAtUtc)",
    "- pool: $($live.pool)",
    "- open_txid: $($live.openTxId)",
    "- open_tx_status: $($live.openTxStatus)",
    "- open_block_height: $($live.openBlockHeight)",
    "- unsigned_bin_id: $($live.unsignedBinId)",
    "- lp_token_amount: $($live.lpTokenAmount)",
    "- covers_active_bin: $($live.coversActiveBin)",
    "- liquidity_token_x_amount: $($live.liquidity.tokenXAmount)",
    "- liquidity_token_y_amount: $($live.liquidity.tokenYAmount)",
    "- total_value_usd: $($live.liquidity.totalValueUsd)",
    "- total_value_btc: $($live.liquidity.totalValueBtc)",
    "- earned_usd: $($live.earned.usd)",
    "- earned_btc: $($live.earned.btc)",
    "- next_action: $($live.nextAction)",
    "",
    "## Reading",
    "",
    "- position is live if open_tx_status is success",
    "- covers_active_bin = True means the current one-bin setup still sits on the active bin",
    "- use this file before each checkpoint during the first 24h",
    ""
)

$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM phase 0 live monitor exported to: $resolvedOutputPath"
