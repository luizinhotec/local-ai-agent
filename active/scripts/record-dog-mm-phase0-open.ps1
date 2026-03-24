param(
    [Parameter(Mandatory = $true)]
    [string]$TxHashOpen,
    [string]$ObservedContext = "bin_step=1",
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

    $escapedField = [regex]::Escape($Field)
    $pattern = "(?m)^- ${escapedField}:.*$"
    $replacement = "- ${Field}: $Value"
    return [regex]::Replace($Content, $pattern, $replacement)
}

$utcNow = [datetime]::UtcNow
$localNow = [datetime]::Now
$content = Get-Content $resolvedLogPath -Raw
$content = Set-MarkdownFieldValue -Content $content -Field "date_local" -Value $localNow.ToString("yyyy-MM-dd HH:mm:ss")
$content = Set-MarkdownFieldValue -Content $content -Field "date_utc" -Value $utcNow.ToString("o")
$content = Set-MarkdownFieldValue -Content $content -Field "tx_hash_open" -Value $TxHashOpen
$content = Set-MarkdownFieldValue -Content $content -Field "opened_at_local" -Value $localNow.ToString("yyyy-MM-dd HH:mm:ss")
$content = Set-MarkdownFieldValue -Content $content -Field "opened_at_utc" -Value $utcNow.ToString("o")
$content = Set-MarkdownFieldValue -Content $content -Field "observed_bin_or_range_context" -Value $ObservedContext
[System.IO.File]::WriteAllText($resolvedLogPath, $content, [System.Text.Encoding]::UTF8)

$eventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"
$details = @{
    txHashOpen = $TxHashOpen
    openedAtUtc = $utcNow.ToString("o")
    observedContext = $ObservedContext
} | ConvertTo-Json -Compress

& $eventScript -Type "phase0_open_recorded" -DetailsJson $details | Out-Null
Write-Host "DOG MM phase 0 open recorded in: $resolvedLogPath"
