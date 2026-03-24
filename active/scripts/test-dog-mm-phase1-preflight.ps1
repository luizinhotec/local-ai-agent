param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$readinessScript = Join-Path $PSScriptRoot "test-dog-mm-readiness.ps1"
$phase1PoolScript = Join-Path $PSScriptRoot "check-dog-mm-phase1-pool.ps1"
$checkHodlmmScript = Join-Path $PSScriptRoot "check-dog-mm-hodlmm-status.ps1"
$statusPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-setup-status.json"

if (-not (Test-Path $statusPath)) {
    throw "Estado do DOG MM nao inicializado."
}

$null = powershell -ExecutionPolicy Bypass -File $phase1PoolScript
$null = powershell -ExecutionPolicy Bypass -File $checkHodlmmScript
$readiness = powershell -ExecutionPolicy Bypass -File $readinessScript | ConvertFrom-Json
$status = Get-Content $statusPath -Raw | ConvertFrom-Json
$phase1Pool = Get-Content (Join-Path $PSScriptRoot "..\state\dog-mm-phase1-pool-status.json") -Raw | ConvertFrom-Json
$hodlmm = Get-Content (Join-Path $PSScriptRoot "..\state\dog-mm-hodlmm-status.json") -Raw | ConvertFrom-Json

$checks = [ordered]@{
    readiness_phase1 = [bool]$readiness.readiness.phase1Ready
    selected_pool_defined = ($status.phase1.selectedPool -eq "sBTC-DOG")
    asset_base_defined = ($status.phase1.assetBase -eq "sBTC")
    pool_created = [bool]$phase1Pool.pool.isPoolCreated
    pool_status = [bool]$phase1Pool.pool.isPoolStatus
    pool_display_on = [bool]$phase1Pool.pool.isDisplayOn
    tvl_above_minimum = ([decimal]$phase1Pool.pool.tvlUsd -ge 5000)
    friction_within_limit = ([decimal]$phase1Pool.pool.estimatedEntryFrictionPct -le 3)
    hodlmm_dog_pool_checked = ($null -ne $hodlmm)
}

$phase1LaunchReady = $checks.readiness_phase1 -and
    $checks.selected_pool_defined -and
    $checks.asset_base_defined -and
    $checks.pool_created -and
    $checks.pool_status -and
    $checks.pool_display_on -and
    $checks.tvl_above_minimum -and
    $checks.friction_within_limit

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    selectedPool = $status.phase1.selectedPool
    assetBase = $status.phase1.assetBase
    checks = [pscustomobject]$checks
    readiness = [pscustomobject]@{
        phase1LaunchReady = $phase1LaunchReady
        hodlmmDogPoolAvailable = [bool]$hodlmm.hodlmmDogPoolAvailable
        nextAction = if (-not $checks.readiness_phase1) {
            $readiness.nextAction
        } elseif (-not $checks.pool_status -or -not $checks.pool_display_on) {
            "do_not_launch_phase1"
        } elseif (-not $checks.tvl_above_minimum) {
            "do_not_launch_phase1"
        } elseif (-not $checks.friction_within_limit) {
            "do_not_launch_phase1"
        } else {
            "phase1_can_launch"
        }
    }
    pool = $phase1Pool.pool
    tokens = $phase1Pool.tokens
}

if ($Plain) {
    Write-Host "track: DOG MM Agent"
    Write-Host "selected_pool: $($result.selectedPool)"
    Write-Host "asset_base: $($result.assetBase)"
    Write-Host "readiness_phase1: $($result.checks.readiness_phase1)"
    Write-Host "pool_created: $($result.checks.pool_created)"
    Write-Host "pool_status: $($result.checks.pool_status)"
    Write-Host "pool_display_on: $($result.checks.pool_display_on)"
    Write-Host "tvl_above_minimum: $($result.checks.tvl_above_minimum)"
    Write-Host "friction_within_limit: $($result.checks.friction_within_limit)"
    Write-Host "hodlmm_dog_pool_checked: $($result.checks.hodlmm_dog_pool_checked)"
    Write-Host "hodlmm_dog_pool_available: $($result.readiness.hodlmmDogPoolAvailable)"
    Write-Host "phase1_launch_ready: $($result.readiness.phase1LaunchReady)"
    Write-Host "next_action: $($result.readiness.nextAction)"
    exit 0
}

$result | ConvertTo-Json -Depth 10
