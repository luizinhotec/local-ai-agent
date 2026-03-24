param(
    [Parameter(Mandatory = $true)]
    [string]$CheckpointLabel,
    [string]$StayedInRange,
    [string]$RangeBreachDetected,
    [string]$RecenterNeeded,
    [string]$FrictionObserved,
    [string]$LogPath
)

$ErrorActionPreference = "Stop"

$resolvedLogPath = if ($LogPath) {
    $LogPath
} else {
    Join-Path $PSScriptRoot "..\state\dog-mm\phase0-session\dog-mm-phase0-log-entry.prefilled.md"
}

if (-not (Test-Path $resolvedLogPath)) {
    throw "Log da fase 0 nao encontrado em '$resolvedLogPath'."
}

function Set-MarkdownFieldValue {
    param(
        [string]$Content,
        [string]$Field,
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Content
    }

    $escapedField = [regex]::Escape($Field)
    $pattern = "(?m)^- ${escapedField}:.*$"
    $replacement = "- ${Field}: $Value"
    return [regex]::Replace($Content, $pattern, $replacement)
}

$content = Get-Content $resolvedLogPath -Raw
$content = Set-MarkdownFieldValue -Content $content -Field "stayed_in_range" -Value $StayedInRange
$content = Set-MarkdownFieldValue -Content $content -Field "range_breach_detected" -Value $RangeBreachDetected
$content = Set-MarkdownFieldValue -Content $content -Field "recenter_needed" -Value $RecenterNeeded
$content = Set-MarkdownFieldValue -Content $content -Field "friction_observed" -Value $FrictionObserved
[System.IO.File]::WriteAllText($resolvedLogPath, $content, [System.Text.Encoding]::UTF8)

$eventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"
$details = @{
    checkpoint = $CheckpointLabel
    loggedAtUtc = [datetime]::UtcNow.ToString("o")
    stayedInRange = $StayedInRange
    rangeBreachDetected = $RangeBreachDetected
    recenterNeeded = $RecenterNeeded
    frictionObserved = $FrictionObserved
} | ConvertTo-Json -Compress

& $eventScript -Type "phase0_checkpoint_recorded" -DetailsJson $details | Out-Null
Write-Host "DOG MM phase 0 checkpoint recorded in: $resolvedLogPath"
