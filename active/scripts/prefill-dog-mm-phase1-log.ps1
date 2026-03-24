param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$status = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "show-dog-mm-status.ps1") | ConvertFrom-Json
$preflight = powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-dog-mm-phase1-preflight.ps1") | ConvertFrom-Json

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase1-session\dog-mm-phase1-log-entry.prefilled.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$lines = @(
    "# DOG MM Agent - Phase 1 Log Entry",
    "",
    "## Header",
    "",
    "- date_local: PREENCHER",
    "- date_utc: PREENCHER",
    '- operator_context: `DOG MM Agent`',
    '- phase: `1`',
    '- venue: `Bitflow`',
    "",
    "## Wallet Check",
    "",
    "- dedicated_wallet_confirmed: $($status.wallet.validated)",
    "- principal_wallet_not_used: true",
    "- speedy_indra_wallet_not_used: true",
    "",
    "## Market Snapshot",
    "",
    '- pool: `sBTC-DOG`',
    "- pool_status: $($preflight.pool.isPoolStatus)",
    "- pool_tvl_usd: $($preflight.pool.tvlUsd)",
    "- sbtc_price_usd: $($preflight.tokens.sBTC.priceUsd)",
    "- dog_price_usd: $($preflight.tokens.DOG.priceUsd)",
    "- estimated_entry_friction_pct: $($preflight.pool.estimatedEntryFrictionPct)",
    "",
    "## Trade Plan",
    "",
    '- asset_base: `sBTC`',
    '- capital_total_authorized_usd: `100`',
    "- capital_planned_for_trade_usd: 50",
    "- capital_reserved_outside_pool_usd: 50",
    "- thesis: manual first DOG liquidity test with small size and reserve preserved",
    "",
    "## Execution",
    "",
    "- tx_hash_open: PREENCHER",
    "- opened_at_local: PREENCHER",
    "- opened_at_utc: PREENCHER",
    "- notes_on_fill_or_friction: PREENCHER",
    "",
    "## Observation Window",
    "",
    "- planned_hold_window: 24h to 72h",
    '- rebalance_before_24h: `no`',
    "- stop_conditions_checked: true",
    "",
    "## Exit Or Adjustment",
    "",
    "- tx_hash_close_or_adjust: PREENCHER",
    "- closed_or_adjusted_at_local: PREENCHER",
    "- closed_or_adjusted_at_utc: PREENCHER",
    "- reason_for_close_or_adjust: PREENCHER",
    "",
    "## Outcome",
    "",
    "- final_inventory_sbtc: PREENCHER",
    "- final_inventory_dog: PREENCHER",
    "- final_cash_reserve_or_idle_balance: PREENCHER",
    "- estimated_pnl_usd: PREENCHER",
    "- friction_summary: PREENCHER",
    '- rebalance_needed_next: `PREENCHER`',
    "",
    "## Post-Trade Review",
    "",
    "- what_worked: PREENCHER",
    "- what_failed: PREENCHER",
    "- what_to_change_before_next_trade: PREENCHER",
    "- escalation_needed: PREENCHER",
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM phase 1 prefilled log exported to: $resolvedOutputPath"
