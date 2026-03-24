param(
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"

$resolvedOutputDir = if ($OutputDir) {
    $OutputDir
} else {
    Join-Path $PSScriptRoot "..\state\dog-mm"
}

$statusScript = Join-Path $PSScriptRoot "show-dog-mm-status.ps1"
$readinessScript = Join-Path $PSScriptRoot "test-dog-mm-readiness.ps1"
$hodlmmScript = Join-Path $PSScriptRoot "check-dog-mm-hodlmm-status.ps1"
$phase0PreflightScript = Join-Path $PSScriptRoot "test-dog-mm-phase0-preflight.ps1"
$phase1PoolScript = Join-Path $PSScriptRoot "check-dog-mm-phase1-pool.ps1"
$phase1PreflightScript = Join-Path $PSScriptRoot "test-dog-mm-phase1-preflight.ps1"
$phase0BriefScript = Join-Path $PSScriptRoot "export-dog-mm-phase0-execution-brief.ps1"
$phase1BriefScript = Join-Path $PSScriptRoot "export-dog-mm-phase1-execution-brief.ps1"

New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null
$resolvedOutputDir = (Resolve-Path $resolvedOutputDir).Path

$status = powershell -ExecutionPolicy Bypass -File $statusScript | ConvertFrom-Json
$readiness = powershell -ExecutionPolicy Bypass -File $readinessScript | ConvertFrom-Json
$hodlmm = powershell -ExecutionPolicy Bypass -File $hodlmmScript | ConvertFrom-Json
$phase0Preflight = powershell -ExecutionPolicy Bypass -File $phase0PreflightScript | ConvertFrom-Json
$phase1Pool = powershell -ExecutionPolicy Bypass -File $phase1PoolScript | ConvertFrom-Json
$phase1Preflight = powershell -ExecutionPolicy Bypass -File $phase1PreflightScript | ConvertFrom-Json
$null = powershell -ExecutionPolicy Bypass -File $phase0BriefScript
$null = powershell -ExecutionPolicy Bypass -File $phase1BriefScript

$nextAction = if ($readiness.nextAction -ne "phase0_can_start") {
    $readiness.nextAction
} elseif (-not $phase0Preflight.readiness.phase0LaunchReady) {
    $phase0Preflight.readiness.nextAction
} elseif (-not $phase1Preflight.readiness.phase1LaunchReady) {
    $phase1Preflight.readiness.nextAction
} else {
    "phase0_and_phase1_gates_open"
}

$bundle = [pscustomobject]@{
    generatedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    nextAction = $nextAction
    stage = $status.stage
    status = $status
    readiness = $readiness
    hodlmm = $hodlmm
    phase0 = [pscustomobject]@{
        preflight = $phase0Preflight
        briefPath = (Join-Path $resolvedOutputDir "dog-mm-phase0-execution-brief.md")
    }
    phase1 = [pscustomobject]@{
        poolSnapshot = $phase1Pool
        preflight = $phase1Preflight
        briefPath = (Join-Path $resolvedOutputDir "dog-mm-phase1-execution-brief.md")
    }
}

$jsonPath = Join-Path $resolvedOutputDir "dog-mm-ops-bundle.json"
$mdPath = Join-Path $resolvedOutputDir "dog-mm-ops-bundle.md"

$jsonContent = $bundle | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($jsonPath, $jsonContent, [System.Text.Encoding]::UTF8)

$lines = @(
    "# DOG MM Ops Bundle",
    "",
    "Generated at UTC: $($bundle.generatedAtUtc)",
    "",
    "## Summary",
    "",
    "- track: DOG MM Agent",
    "- stage: $($bundle.stage)",
    "- next_action: $($bundle.nextAction)",
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
    "- selected_pool: $($bundle.phase0.preflight.selectedPool)",
    "- selected_bin_step: $($bundle.phase0.preflight.selectedBinStep)",
    "- phase0_launch_ready: $($bundle.phase0.preflight.readiness.phase0LaunchReady)",
    "- phase0_next_action: $($bundle.phase0.preflight.readiness.nextAction)",
    "",
    "## Phase 1",
    "",
    "- selected_pool: $($bundle.phase1.preflight.selectedPool)",
    "- asset_base: $($bundle.phase1.preflight.assetBase)",
    "- phase1_launch_ready: $($bundle.phase1.preflight.readiness.phase1LaunchReady)",
    "- phase1_next_action: $($bundle.phase1.preflight.readiness.nextAction)",
    "- phase1_tvl_usd: $($bundle.phase1.poolSnapshot.pool.tvlUsd)",
    "- phase1_estimated_entry_friction_pct: $($bundle.phase1.poolSnapshot.pool.estimatedEntryFrictionPct)",
    "",
    "## Artifacts",
    "",
    "- bundle_json: $jsonPath",
    "- phase0_brief: $($bundle.phase0.briefPath)",
    "- phase1_brief: $($bundle.phase1.briefPath)",
    ""
)

$mdContent = ($lines -join [Environment]::NewLine) + [Environment]::NewLine
[System.IO.File]::WriteAllText($mdPath, $mdContent, [System.Text.Encoding]::UTF8)

Write-Host "DOG MM ops bundle exported:"
Write-Host "json: $jsonPath"
Write-Host "markdown: $mdPath"
