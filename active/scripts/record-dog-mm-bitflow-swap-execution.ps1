param(
    [Parameter(Mandatory = $true)]
    [string]$SwapTxId,
    [Parameter(Mandatory = $true)]
    [decimal]$StxBalance,
    [Parameter(Mandatory = $true)]
    [long]$SbtcBalanceSats,
    [Parameter(Mandatory = $true)]
    [decimal]$UsdcxBalance,
    [string]$AmountInSats = "13479",
    [string]$AmountOutUsdcx = "9.890354"
)

$ErrorActionPreference = "Stop"

$snapshotScript = Join-Path $PSScriptRoot "export-dog-mm-phase0-postswap-snapshot.ps1"
& $snapshotScript -SwapTxId $SwapTxId -StxBalance $StxBalance -SbtcBalanceSats $SbtcBalanceSats -UsdcxBalance $UsdcxBalance | Out-Null

$eventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"
$details = @{
    swapTxId = $SwapTxId
    amountInSats = $AmountInSats
    amountOutUsdcx = $AmountOutUsdcx
    stxBalance = $StxBalance
    sbtcBalanceSats = $SbtcBalanceSats
    usdcxBalance = $UsdcxBalance
    phase0State = "inventory_staged_lp_pending"
} | ConvertTo-Json -Compress

& $eventScript -Type "phase0_swap_executed" -DetailsJson $details | Out-Null

$summaryPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session\dog-mm-phase0-execution-status.md"
$summary = @(
    '# DOG MM Phase 0 Execution Status',
    '',
    '- status: inventory_staged_lp_pending',
    "- swap_txid: $SwapTxId",
    "- amount_in_sats: $AmountInSats",
    "- amount_out_usdcx: $AmountOutUsdcx",
    "- wallet_stx: $StxBalance",
    "- wallet_sbtc_sats: $SbtcBalanceSats",
    "- wallet_usdcx: $UsdcxBalance",
    '- lp_add_txid: PENDING',
    '- next_action: add_liquidity_in_bitflow_then_record_phase0_open',
    '',
    '## Meaning',
    '',
    '- swap completed successfully',
    '- LP position has not been opened yet',
    '- `record-dog-mm-phase0-open.ps1` should be used only after the LP add tx exists'
) -join "`n"

[System.IO.File]::WriteAllText($summaryPath, $summary, [System.Text.Encoding]::UTF8)
Write-Host "DOG MM phase 0 swap execution recorded in: $summaryPath"
