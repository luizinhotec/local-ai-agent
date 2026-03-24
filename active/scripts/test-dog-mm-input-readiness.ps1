param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$walletInputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-wallet-public-input.json"
$fundingInputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-funding-input.json"

function Test-PlaceholderValue {
    param([string]$Value)

    if ($null -eq $Value) {
        return $true
    }

    $text = $Value.Trim().ToUpperInvariant()
    return ($text -eq "" -or $text -eq "PREENCHER" -or $text -like "PREENCHER*")
}

function Read-JsonIfExists {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return $null
    }

    return Get-Content $Path -Raw | ConvertFrom-Json
}

$walletInput = Read-JsonIfExists -Path $walletInputPath
$fundingInput = Read-JsonIfExists -Path $fundingInputPath

$walletReady = ($null -ne $walletInput) -and
    -not (Test-PlaceholderValue $walletInput.walletName) -and
    -not (Test-PlaceholderValue $walletInput.stxAddress) -and
    -not (Test-PlaceholderValue $walletInput.btcAddress) -and
    -not (Test-PlaceholderValue $walletInput.taprootAddress)

$fundingReady = ($null -ne $fundingInput) -and
    -not (Test-PlaceholderValue $fundingInput.fundingAmountUsd) -and
    -not (Test-PlaceholderValue $fundingInput.fundingNote)

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    walletInput = [pscustomobject]@{
        filePresent = ($null -ne $walletInput)
        ready = $walletReady
        walletNamePresent = if ($walletInput) { -not (Test-PlaceholderValue $walletInput.walletName) } else { $false }
        stxAddressReady = if ($walletInput) { -not (Test-PlaceholderValue $walletInput.stxAddress) } else { $false }
        btcAddressReady = if ($walletInput) { -not (Test-PlaceholderValue $walletInput.btcAddress) } else { $false }
        taprootAddressReady = if ($walletInput) { -not (Test-PlaceholderValue $walletInput.taprootAddress) } else { $false }
    }
    fundingInput = [pscustomobject]@{
        filePresent = ($null -ne $fundingInput)
        ready = $fundingReady
        fundingAmountReady = if ($fundingInput) { -not (Test-PlaceholderValue $fundingInput.fundingAmountUsd) } else { $false }
        fundingNoteReady = if ($fundingInput) { -not (Test-PlaceholderValue $fundingInput.fundingNote) } else { $false }
    }
}

if ($Plain) {
    Write-Host "track: DOG MM Agent"
    Write-Host "wallet_input_file_present: $($result.walletInput.filePresent)"
    Write-Host "wallet_input_ready: $($result.walletInput.ready)"
    Write-Host "wallet_name_present: $($result.walletInput.walletNamePresent)"
    Write-Host "stx_address_ready: $($result.walletInput.stxAddressReady)"
    Write-Host "btc_address_ready: $($result.walletInput.btcAddressReady)"
    Write-Host "taproot_address_ready: $($result.walletInput.taprootAddressReady)"
    Write-Host "funding_input_file_present: $($result.fundingInput.filePresent)"
    Write-Host "funding_input_ready: $($result.fundingInput.ready)"
    Write-Host "funding_amount_ready: $($result.fundingInput.fundingAmountReady)"
    Write-Host "funding_note_ready: $($result.fundingInput.fundingNoteReady)"
    exit 0
}

$result | ConvertTo-Json -Depth 10
