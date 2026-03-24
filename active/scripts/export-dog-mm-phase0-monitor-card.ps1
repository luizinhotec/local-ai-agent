param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session\dog-mm-phase0-monitor-card.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$liveStatusScript = Join-Path $PSScriptRoot "get-dog-mm-phase0-live-status.ps1"
$live = powershell -ExecutionPolicy Bypass -File $liveStatusScript | ConvertFrom-Json

$lines = @(
    "# DOG MM Phase 0 Monitor Card",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Live Position",
    "",
    "- open_txid: $($live.openTxId)",
    "- open_tx_status: $($live.openTxStatus)",
    "- unsigned_bin_id: $($live.unsignedBinId)",
    "- lp_token_amount: $($live.lpTokenAmount)",
    "- covers_active_bin: $($live.coversActiveBin)",
    "- live_value_usd: $($live.liquidity.totalValueUsd)",
    "",
    "## First 24h",
    "",
    "- do not recenter before 12h unless there is a real risk event",
    "- maximum recenter count: 1",
    "- if a second recenter seems necessary, close the cycle and log the failure",
    "- watch inventory drift, fee friction, and whether the chosen range stays useful",
    "",
    "## Checkpoints",
    "",
    "- t+0h: capture tx hash and open time",
    "- t+1h: confirm position is live and note first friction impression",
    "- t+6h: note whether inventory drift looks benign or material",
    "- t+12h: decide whether recenter is still unnecessary",
    "- t+24h: close, or record the reason to keep it open with explicit justification",
    "",
    "## What To Record",
    "",
    "- tx_hash_open",
    "- open_tx_status",
    "- unsigned_bin_id",
    "- observed_bin_or_range_context",
    "- stayed_in_range",
    "- range_breach_detected",
    "- recenter_needed",
    "- friction_observed",
    "- what_was_validated",
    "- what_failed",
    ""
)

$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM phase 0 monitor card exported to: $resolvedOutputPath"
