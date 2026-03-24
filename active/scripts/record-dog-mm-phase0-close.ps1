param(
    [Parameter(Mandatory = $true)]
    [string]$TxHashClose,
    [Parameter(Mandatory = $true)]
    [string]$ReasonForClose,
    [string]$StayedInRange,
    [string]$RangeBreachDetected,
    [string]$RecenterNeeded,
    [string]$FrictionObserved,
    [string]$WhatWasValidated,
    [string]$WhatFailed,
    [string]$WhatChangesForDog,
    [string]$ReusableRuleForHodlmmDog,
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

$utcNow = [datetime]::UtcNow
$localNow = [datetime]::Now
$content = Get-Content $resolvedLogPath -Raw
$content = Set-MarkdownFieldValue -Content $content -Field "stayed_in_range" -Value $StayedInRange
$content = Set-MarkdownFieldValue -Content $content -Field "range_breach_detected" -Value $RangeBreachDetected
$content = Set-MarkdownFieldValue -Content $content -Field "recenter_needed" -Value $RecenterNeeded
$content = Set-MarkdownFieldValue -Content $content -Field "friction_observed" -Value $FrictionObserved
$content = Set-MarkdownFieldValue -Content $content -Field "tx_hash_close" -Value $TxHashClose
$content = Set-MarkdownFieldValue -Content $content -Field "closed_at_local" -Value $localNow.ToString("yyyy-MM-dd HH:mm:ss")
$content = Set-MarkdownFieldValue -Content $content -Field "closed_at_utc" -Value $utcNow.ToString("o")
$content = Set-MarkdownFieldValue -Content $content -Field "reason_for_close" -Value $ReasonForClose
$content = Set-MarkdownFieldValue -Content $content -Field "what_was_validated" -Value $WhatWasValidated
$content = Set-MarkdownFieldValue -Content $content -Field "what_failed" -Value $WhatFailed
$content = Set-MarkdownFieldValue -Content $content -Field "what_changes_for_dog" -Value $WhatChangesForDog
$content = Set-MarkdownFieldValue -Content $content -Field "reusable_rule_for_hodlmm_dog" -Value $ReusableRuleForHodlmmDog
[System.IO.File]::WriteAllText($resolvedLogPath, $content, [System.Text.Encoding]::UTF8)

$eventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"
$details = @{
    txHashClose = $TxHashClose
    closedAtUtc = $utcNow.ToString("o")
    reasonForClose = $ReasonForClose
} | ConvertTo-Json -Compress

& $eventScript -Type "phase0_close_recorded" -DetailsJson $details | Out-Null
Write-Host "DOG MM phase 0 close recorded in: $resolvedLogPath"
