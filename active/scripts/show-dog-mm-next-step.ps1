param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$bundleScript = Join-Path $PSScriptRoot "export-dog-mm-ops-bundle.ps1"
$bundlePath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-ops-bundle.json"

$null = powershell -ExecutionPolicy Bypass -File $bundleScript
$bundle = Get-Content $bundlePath -Raw | ConvertFrom-Json

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    stage = $bundle.stage
    nextAction = $bundle.nextAction
    walletCreated = [bool]$bundle.status.wallet.created
    walletValidated = [bool]$bundle.status.wallet.validated
    walletFunded = [bool]$bundle.status.wallet.funded
    phase0LaunchReady = [bool]$bundle.phase0.preflight.readiness.phase0LaunchReady
    phase1LaunchReady = [bool]$bundle.phase1.preflight.readiness.phase1LaunchReady
}

if ($Plain) {
    Write-Host "track: DOG MM Agent"
    Write-Host "stage: $($result.stage)"
    Write-Host "next_action: $($result.nextAction)"
    Write-Host "wallet_created: $($result.walletCreated)"
    Write-Host "wallet_validated: $($result.walletValidated)"
    Write-Host "wallet_funded: $($result.walletFunded)"
    Write-Host "phase0_launch_ready: $($result.phase0LaunchReady)"
    Write-Host "phase1_launch_ready: $($result.phase1LaunchReady)"
    exit 0
}

$result | ConvertTo-Json -Depth 10
