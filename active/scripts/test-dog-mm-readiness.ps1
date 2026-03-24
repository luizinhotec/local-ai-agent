param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$statusPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-setup-status.json"
$hodlmmSnapshotPath = Join-Path $PSScriptRoot "..\state\dog-mm-hodlmm-status.json"

if (-not (Test-Path $statusPath)) {
    throw "Estado do DOG MM nao inicializado."
}

$status = Get-Content $statusPath -Raw | ConvertFrom-Json
$hodlmm = if (Test-Path $hodlmmSnapshotPath) {
    Get-Content $hodlmmSnapshotPath -Raw | ConvertFrom-Json
} else {
    $null
}

$checks = [ordered]@{
    wallet_created = [bool]$status.wallet.created
    wallet_validated = [bool]$status.wallet.validated
    wallet_funded = [bool]$status.wallet.funded
    phase0_pool_defined = ($status.phase0.selectedPool -eq "sBTC-USDCx")
    phase1_pool_defined = ($status.phase1.selectedPool -eq "sBTC-DOG")
    hodlmm_snapshot_present = ($null -ne $hodlmm)
}

$phase0Ready = $checks.wallet_created -and $checks.wallet_validated -and $checks.wallet_funded -and $checks.phase0_pool_defined
$phase1Ready = $checks.wallet_created -and $checks.wallet_validated -and $checks.wallet_funded -and $checks.phase1_pool_defined

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    currentStage = $status.stage
    checks = [pscustomobject]$checks
    readiness = [pscustomobject]@{
        phase0Ready = $phase0Ready
        phase1Ready = $phase1Ready
        hodlmmDogPoolAvailable = if ($hodlmm) { [bool]$hodlmm.hodlmmDogPoolAvailable } else { $false }
    }
    nextAction = if (-not $checks.wallet_created) {
        "create_wallet"
    } elseif (-not $checks.wallet_validated) {
        "validate_wallet_addresses"
    } elseif (-not $checks.wallet_funded) {
        "fund_wallet"
    } elseif (-not $phase0Ready) {
        "review_phase0_inputs"
    } else {
        "phase0_can_start"
    }
}

if ($Plain) {
    Write-Host "track: DOG MM Agent"
    Write-Host "current_stage: $($result.currentStage)"
    Write-Host "wallet_created: $($result.checks.wallet_created)"
    Write-Host "wallet_validated: $($result.checks.wallet_validated)"
    Write-Host "wallet_funded: $($result.checks.wallet_funded)"
    Write-Host "phase0_pool_defined: $($result.checks.phase0_pool_defined)"
    Write-Host "phase1_pool_defined: $($result.checks.phase1_pool_defined)"
    Write-Host "hodlmm_snapshot_present: $($result.checks.hodlmm_snapshot_present)"
    Write-Host "phase0_ready: $($result.readiness.phase0Ready)"
    Write-Host "phase1_ready: $($result.readiness.phase1Ready)"
    Write-Host "hodlmm_dog_pool_available: $($result.readiness.hodlmmDogPoolAvailable)"
    Write-Host "next_action: $($result.nextAction)"
    exit 0
}

$result | ConvertTo-Json -Depth 10
