param(
    [switch]$Plain
)

$ErrorActionPreference = "Stop"

$walletInputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-wallet-public-input.json"
$fundingInputPath = Join-Path $PSScriptRoot "..\state\dog-mm\dog-mm-funding-input.json"

function Test-JsonFile {
    param(
        [string]$Path,
        [string[]]$RequiredProperties
    )

    if (-not (Test-Path $Path)) {
        return [pscustomobject]@{
            filePresent = $false
            jsonValid = $false
            missingProperties = $RequiredProperties
            parseError = ""
        }
    }

    try {
        $obj = Get-Content $Path -Raw | ConvertFrom-Json
    } catch {
        return [pscustomobject]@{
            filePresent = $true
            jsonValid = $false
            missingProperties = @()
            parseError = $_.Exception.Message
        }
    }

    $missing = @()
    foreach ($prop in $RequiredProperties) {
        if (-not ($obj.PSObject.Properties.Name -contains $prop)) {
            $missing += $prop
        }
    }

    return [pscustomobject]@{
        filePresent = $true
        jsonValid = ($missing.Count -eq 0)
        missingProperties = $missing
        parseError = ""
    }
}

$wallet = Test-JsonFile -Path $walletInputPath -RequiredProperties @("walletName", "stxAddress", "btcAddress", "taprootAddress")
$funding = Test-JsonFile -Path $fundingInputPath -RequiredProperties @("fundingAmountUsd", "fundingNote")

$result = [pscustomobject]@{
    checkedAtUtc = [datetime]::UtcNow.ToString("o")
    track = "DOG MM Agent"
    walletInput = $wallet
    fundingInput = $funding
}

if ($Plain) {
    Write-Host "track: DOG MM Agent"
    Write-Host "wallet_json_file_present: $($result.walletInput.filePresent)"
    Write-Host "wallet_json_valid: $($result.walletInput.jsonValid)"
    Write-Host "wallet_json_missing_properties: $([string]::Join(',', @($result.walletInput.missingProperties)))"
    Write-Host "funding_json_file_present: $($result.fundingInput.filePresent)"
    Write-Host "funding_json_valid: $($result.fundingInput.jsonValid)"
    Write-Host "funding_json_missing_properties: $([string]::Join(',', @($result.fundingInput.missingProperties)))"
    exit 0
}

$result | ConvertTo-Json -Depth 10
