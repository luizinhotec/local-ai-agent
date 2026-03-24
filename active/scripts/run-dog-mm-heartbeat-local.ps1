param(
    [switch]$StatusOnly,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$windowScript = Join-Path $PSScriptRoot "get-next-dog-mm-heartbeat-window.ps1"
$liveStatusScript = Join-Path $PSScriptRoot "get-dog-mm-phase0-live-status.ps1"
$statusScript = Join-Path $PSScriptRoot "show-dog-mm-status.ps1"
$eventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"

$window = powershell -ExecutionPolicy Bypass -File $windowScript | ConvertFrom-Json

if ($StatusOnly) {
    [pscustomobject]@{
        track = "DOG MM Agent"
        heartbeat = [pscustomobject]@{
            latestEventType = $window.eventType
            latestLoggedAt = $window.loggedAt
            nextCheckInUtc = $window.heartbeatWindow.nextCheckInUtc
            nextCheckInLocal = $window.heartbeatWindow.nextCheckInLocal
            waitSeconds = $window.heartbeatWindow.waitSeconds
            readyNow = $window.heartbeatWindow.readyNow
        }
    } | ConvertTo-Json -Depth 6
    exit 0
}

if (-not $Force -and -not $window.heartbeatWindow.readyNow) {
    $details = @{
        timestampIso = [datetime]::UtcNow.ToString("o")
        skipped = $true
        reason = "heartbeat_window_not_ready"
        nextCheckInUtc = $window.heartbeatWindow.nextCheckInUtc
        waitSeconds = $window.heartbeatWindow.waitSeconds
    } | ConvertTo-Json -Compress

    & $eventScript -Type "heartbeat_attempt" -DetailsJson $details | Out-Null
    Write-Host "DOG MM heartbeat aguardando janela. Proxima em: $($window.heartbeatWindow.nextCheckInLocal)"
    exit 0
}

$status = powershell -ExecutionPolicy Bypass -File $statusScript | ConvertFrom-Json
$live = powershell -ExecutionPolicy Bypass -File $liveStatusScript | ConvertFrom-Json
$timestampIso = [datetime]::UtcNow.ToString("o")

$detailsObject = [ordered]@{
    timestampIso = $timestampIso
    stage = $status.stage
    walletFunded = if ($status.wallet) { [bool]$status.wallet.funded } else { $false }
    phase0Pool = if ($status.phase0) { $status.phase0.selectedPool } else { $null }
    phase0OpenTxId = $live.openTxId
    phase0OpenTxStatus = $live.openTxStatus
    unsignedBinId = $live.unsignedBinId
    lpTokenAmount = $live.lpTokenAmount
    coversActiveBin = $live.coversActiveBin
    totalValueUsd = $live.liquidity.totalValueUsd
    tokenXAmount = $live.liquidity.tokenXAmount
    tokenYAmount = $live.liquidity.tokenYAmount
    nextAction = $live.nextAction
}

$details = $detailsObject | ConvertTo-Json -Compress
& $eventScript -Type "heartbeat_success" -DetailsJson $details | Out-Null

[pscustomobject]@{
    track = "DOG MM Agent"
    heartbeat = [pscustomobject]@{
        status = "success"
        timestampIso = $timestampIso
        openTxStatus = $live.openTxStatus
        unsignedBinId = $live.unsignedBinId
        coversActiveBin = $live.coversActiveBin
        totalValueUsd = $live.liquidity.totalValueUsd
        nextAction = $live.nextAction
    }
} | ConvertTo-Json -Depth 6
