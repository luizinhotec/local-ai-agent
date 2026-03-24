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

$outputPath = Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session\dog-mm-phase0-lp-add-card.md"
$content = @(
    '# DOG MM Phase 0 LP Add Card',
    '',
    "- generated_at_local: $([datetime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))",
    "- generated_at_utc: $([datetime]::UtcNow.ToString('o'))",
    "- phase0_state: inventory_staged_lp_pending",
    "- swap_txid: $SwapTxId",
    "- wallet_stx: $StxBalance",
    "- wallet_sbtc_sats_ready_for_lp: $SbtcBalanceSats",
    "- wallet_usdcx_ready_for_lp: $UsdcxBalance",
    '',
    '## Next Manual Action',
    '',
    '1. Open Bitflow in the DOG MM session.',
    '2. Select the `sBTC-USDCx` HODLMM or DLMM venue with `bin_step = 1`.',
    '3. Use the current wallet inventory instead of doing another swap.',
    '4. Add liquidity with a moderate range bias, not the narrowest possible setup.',
    '5. Copy the LP add txid.',
    '6. Only after that tx exists, run `record-dog-mm-phase0-open.ps1`.',
    '',
    '## Guardrails',
    '',
    '- do not perform a second inventory swap before the LP add',
    '- do not use the full wallet beyond the staged balances shown above',
    '- do not mark phase0 as open until the LP add tx confirms'
) -join "`n"

[System.IO.File]::WriteAllText($outputPath, $content, [System.Text.Encoding]::UTF8)
Write-Host "DOG MM phase 0 LP add card exported to: $outputPath"
