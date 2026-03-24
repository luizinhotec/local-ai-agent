param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$statusPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-setup-status.json"
$checkHodlmmScript = Join-Path $PSScriptRoot "check-dog-mm-hodlmm-status.ps1"
$readinessScript = Join-Path $PSScriptRoot "test-dog-mm-readiness.ps1"
$liveStatusScript = Join-Path $PSScriptRoot "get-dog-mm-phase0-live-status.ps1"

if (-not (Test-Path $statusPath)) {
    throw "Estado do DOG MM nao inicializado."
}

function Convert-ToLogicalBoolean {
    param($Value)

    if ($null -eq $Value) {
        return $false
    }

    $text = $Value.ToString().Trim().ToLowerInvariant()
    return ($text -eq "true" -or $text -eq "1")
}

$null = powershell -ExecutionPolicy Bypass -File $checkHodlmmScript
$readiness = powershell -ExecutionPolicy Bypass -File $readinessScript | ConvertFrom-Json
$status = Get-Content $statusPath -Raw | ConvertFrom-Json
$livePhase0 = $null
try {
    $livePhase0 = powershell -ExecutionPolicy Bypass -File $liveStatusScript | ConvertFrom-Json
} catch {
    $livePhase0 = $null
}

$hodlmmPath = Join-Path $PSScriptRoot "..\state\dog-mm-hodlmm-status.json"
$hodlmm = if (Test-Path $hodlmmPath) { Get-Content $hodlmmPath -Raw | ConvertFrom-Json } else { $null }

$selectedPool = $status.phase0.selectedPool
$selectedBinStep = [decimal]$status.phase0.binStep
$recommendedPools = if ($hodlmm) { @($hodlmm.recommendedTrainingPools) } else { @() }
$matchingPool = $recommendedPools | Where-Object { $_.pool_symbol -eq $selectedPool -and [decimal]$_.bin_step -eq $selectedBinStep } | Select-Object -First 1

$checks = [ordered]@{
    readiness_phase0 = [bool]$readiness.readiness.phase0Ready
    selected_pool_defined = ($selectedPool -eq "sBTC-USDCx")
    selected_bin_step_defined = ($selectedBinStep -eq 1)
    selected_pool_listed_in_hodlmm_snapshot = ($null -ne $matchingPool)
    selected_pool_active = if ($matchingPool) { Convert-ToLogicalBoolean $matchingPool.active } else { $false }
    selected_pool_status = if ($matchingPool) { Convert-ToLogicalBoolean $matchingPool.pool_status } else { $false }
    hodlmm_dog_pool_still_absent = if ($hodlmm) { -not [bool]$hodlmm.hodlmmDogPoolAvailable } else { $true }
    phase0_position_open = if ($livePhase0) { $livePhase0.openTxStatus -eq "success" } else { $false }
    phase0_covers_active_bin = if ($livePhase0) { [bool]$livePhase0.coversActiveBin } else { $false }
}

$phase0LaunchReady = $checks.readiness_phase0 -and
    $checks.selected_pool_defined -and
    $checks.selected_bin_step_defined -and
    $checks.selected_pool_listed_in_hodlmm_snapshot -and
    $checks.selected_pool_active -and
    $checks.selected_pool_status

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    selectedPool = $selectedPool
    selectedBinStep = $selectedBinStep
    checks = [pscustomobject]$checks
    readiness = [pscustomobject]@{
        phase0LaunchReady = $phase0LaunchReady
        nextAction = if (-not $checks.readiness_phase0) {
            $readiness.nextAction
        } elseif ($checks.phase0_position_open) {
            "monitor_open_phase0_position"
        } elseif (-not $checks.selected_pool_listed_in_hodlmm_snapshot) {
            "review_hodlmm_training_pool"
        } elseif (-not $checks.selected_pool_active -or -not $checks.selected_pool_status) {
            "do_not_launch_phase0"
        } else {
            "phase0_can_launch"
        }
    }
    matchedPool = $matchingPool
    livePhase0 = $livePhase0
}

if ($Plain) {
    Write-Host "track: DOG MM Agent"
    Write-Host "selected_pool: $($result.selectedPool)"
    Write-Host "selected_bin_step: $($result.selectedBinStep)"
    Write-Host "readiness_phase0: $($result.checks.readiness_phase0)"
    Write-Host "selected_pool_defined: $($result.checks.selected_pool_defined)"
    Write-Host "selected_bin_step_defined: $($result.checks.selected_bin_step_defined)"
    Write-Host "selected_pool_listed_in_hodlmm_snapshot: $($result.checks.selected_pool_listed_in_hodlmm_snapshot)"
    Write-Host "selected_pool_active: $($result.checks.selected_pool_active)"
    Write-Host "selected_pool_status: $($result.checks.selected_pool_status)"
    Write-Host "hodlmm_dog_pool_still_absent: $($result.checks.hodlmm_dog_pool_still_absent)"
    Write-Host "phase0_position_open: $($result.checks.phase0_position_open)"
    Write-Host "phase0_covers_active_bin: $($result.checks.phase0_covers_active_bin)"
    Write-Host "phase0_launch_ready: $($result.readiness.phase0LaunchReady)"
    Write-Host "next_action: $($result.readiness.nextAction)"
    exit 0
}

$result | ConvertTo-Json -Depth 10
