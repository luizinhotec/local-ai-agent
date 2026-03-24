param()

$ErrorActionPreference = "Stop"

$stateDir = Join-Path $PSScriptRoot "..\state\dog-mm"
$logPath = Join-Path $stateDir "dog-mm-ops-log.jsonl"
$statusPath = Join-Path $stateDir "dog-mm-setup-status.json"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

if (-not (Test-Path $logPath)) {
    New-Item -ItemType File -Path $logPath | Out-Null
}

if (-not (Test-Path $statusPath)) {
    $status = [pscustomobject]@{
        checkedAtUtc = [datetime]::UtcNow.ToString("o")
        track = "DOG MM Agent"
        stage = "blueprint/preparacao"
        wallet = [pscustomobject]@{
            name = ""
            created = $false
            validated = $false
            funded = $false
            stxAddress = ""
            btcAddress = ""
            taprootAddress = ""
        }
        phase0 = [pscustomobject]@{
            selectedPool = "sBTC-USDCx"
            binStep = 1
            firstCycleExecuted = $false
        }
        phase1 = [pscustomobject]@{
            selectedPool = "sBTC-DOG"
            assetBase = "sBTC"
            firstManualTradeExecuted = $false
        }
        notes = @(
            "Separate state for DOG MM Agent only.",
            "Do not mix with Speedy Indra operational state."
        )
    }

    $status | ConvertTo-Json -Depth 8 | Set-Content -Path $statusPath -Encoding UTF8
} else {
    $status = Get-Content $statusPath -Raw | ConvertFrom-Json

    if (-not ($status.wallet.PSObject.Properties.Name -contains "name")) {
        $status.wallet | Add-Member -NotePropertyName name -NotePropertyValue ""
    }
    if (-not ($status.wallet.PSObject.Properties.Name -contains "stxAddress")) {
        $status.wallet | Add-Member -NotePropertyName stxAddress -NotePropertyValue ""
    }
    if (-not ($status.wallet.PSObject.Properties.Name -contains "btcAddress")) {
        $status.wallet | Add-Member -NotePropertyName btcAddress -NotePropertyValue ""
    }
    if (-not ($status.wallet.PSObject.Properties.Name -contains "taprootAddress")) {
        $status.wallet | Add-Member -NotePropertyName taprootAddress -NotePropertyValue ""
    }

    $status.checkedAtUtc = [datetime]::UtcNow.ToString("o")
    $status | ConvertTo-Json -Depth 10 | Set-Content -Path $statusPath -Encoding UTF8
}

Write-Host "DOG MM local state initialized at: $stateDir"
