param(
    [Parameter(Mandatory = $true)]
    [string]$SwapTxId,
    [Parameter(Mandatory = $true)]
    [decimal]$StxBalance,
    [Parameter(Mandatory = $true)]
    [long]$SbtcBalanceSats,
    [Parameter(Mandatory = $true)]
    [decimal]$UsdcxBalance
)

$ErrorActionPreference = "Stop"

$outputPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session\dog-mm-phase0-postswap-snapshot.md"
$content = @(
    '# DOG MM Phase 0 Post-Swap Snapshot',
    '',
    "- generated_at_local: $([datetime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))",
    "- generated_at_utc: $([datetime]::UtcNow.ToString('o'))",
    "- swap_txid: $SwapTxId",
    "- wallet_stx: $StxBalance",
    "- wallet_sbtc_sats: $SbtcBalanceSats",
    "- wallet_usdcx: $UsdcxBalance",
    '- inventory_status: staged_for_phase0_lp',
    '- next_step: add_liquidity_manually_in_bitflow',
    '',
    '## Interpretation',
    '',
    '- the swap leg is complete',
    '- phase 0 inventory is now split across `sBTC` and `USDCx`',
    '- the LP add is still pending and remains the next manual action',
    '',
    '## Guardrail',
    '',
    '- do not record `phase0_open` until the LP add tx exists'
) -join "`n"

[System.IO.File]::WriteAllText($outputPath, $content, [System.Text.Encoding]::UTF8)
Write-Host "DOG MM phase 0 post-swap snapshot exported to: $outputPath"
