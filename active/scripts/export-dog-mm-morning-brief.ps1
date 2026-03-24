param(
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$defaultOutputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-morning-brief.md"
$resolvedOutputPath = if ($OutputPath) { $OutputPath } else { $defaultOutputPath }
$dir = Split-Path -Parent $resolvedOutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$resolvedOutputPath = if (Test-Path $dir) { Join-Path (Resolve-Path $dir).Path (Split-Path $resolvedOutputPath -Leaf) } else { $resolvedOutputPath }

$bundleScript = Join-Path $PSScriptRoot "export-dog-mm-ops-bundle.ps1"
$gatesScript = Join-Path $PSScriptRoot "test-dog-mm-launch-gates.ps1"
$bundlePath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-ops-bundle.json"

if (-not (Test-Path $bundlePath)) {
    $null = powershell -ExecutionPolicy Bypass -File $bundleScript
}

$bundle = Get-Content $bundlePath -Raw | ConvertFrom-Json
$gates = powershell -ExecutionPolicy Bypass -File $gatesScript | ConvertFrom-Json

$phase0Action = if ($bundle.phase0.preflight.readiness.phase0LaunchReady) { "phase0_can_launch" } else { $bundle.phase0.preflight.readiness.nextAction }
$phase1Action = if ($bundle.phase1.preflight.readiness.phase1LaunchReady) { "phase1_can_launch" } else { $bundle.phase1.preflight.readiness.nextAction }

$lines = @(
    "# DOG MM Morning Brief",
    "",
    "Generated at UTC: $([datetime]::UtcNow.ToString("o"))",
    "",
    "## Immediate Action",
    "",
    "- next_action: $($bundle.nextAction)",
    "- wallet_blocker: $($gates.blockers.wallet)",
    "- phase0_blocker: $($gates.blockers.phase0)",
    "- phase1_blocker: $($gates.blockers.phase1)",
    "",
    "## Wallet",
    "",
    "- wallet_name: $($bundle.status.wallet.name)",
    "- wallet_created: $($bundle.status.wallet.created)",
    "- wallet_validated: $($bundle.status.wallet.validated)",
    "- wallet_funded: $($bundle.status.wallet.funded)",
    "",
    "## HODLMM",
    "",
    "- hodlmm_dog_pool_available: $($bundle.hodlmm.hodlmmDogPoolAvailable)",
    "- dog_pool_count: $($bundle.hodlmm.dogPoolCount)",
    "",
    "## Phase 0",
    "",
    "- pool: $($bundle.phase0.preflight.selectedPool)",
    "- bin_step: $($bundle.phase0.preflight.selectedBinStep)",
    "- launch_ready: $($bundle.phase0.preflight.readiness.phase0LaunchReady)",
    "- next_action: $phase0Action",
    "",
    "## Phase 1",
    "",
    "- pool: $($bundle.phase1.preflight.selectedPool)",
    "- asset_base: $($bundle.phase1.preflight.assetBase)",
    "- launch_ready: $($bundle.phase1.preflight.readiness.phase1LaunchReady)",
    "- next_action: $phase1Action",
    "- tvl_usd: $($bundle.phase1.poolSnapshot.pool.tvlUsd)",
    "- estimated_entry_friction_pct: $($bundle.phase1.poolSnapshot.pool.estimatedEntryFrictionPct)",
    "- sbtc_price_usd: $($bundle.phase1.poolSnapshot.tokens.sBTC.priceUsd)",
    "- dog_price_usd: $($bundle.phase1.poolSnapshot.tokens.DOG.priceUsd)",
    "",
    "## Reference Files",
    "",
    "- ops_bundle: $(Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\\state\\dog-mm')).Path 'dog-mm-ops-bundle.md')",
    "- phase0_brief: $(Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\\state\\dog-mm')).Path 'dog-mm-phase0-execution-brief.md')",
    "- phase1_brief: $(Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\\state\\dog-mm')).Path 'dog-mm-phase1-execution-brief.md')",
    ""
)

$content = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($resolvedOutputPath, $content, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM morning brief exported to: $resolvedOutputPath"
