param(
    [string]$Stage,
    [string]$WalletCreated,
    [string]$WalletValidated,
    [string]$WalletFunded,
    [string]$Phase0Executed,
    [string]$Phase1Executed,
    [string]$WalletName,
    [string]$WalletStxAddress,
    [string]$WalletBtcAddress,
    [string]$WalletTaprootAddress
)

$ErrorActionPreference = "Stop"

$stateDir = Join-Path $PSScriptRoot "..\state\dog-mm"
$statusPath = Join-Path $stateDir "dog-mm-setup-status.json"

if (-not (Test-Path $statusPath)) {
    throw "Estado do DOG MM nao inicializado. Rode initialize-dog-mm-local-state.ps1 primeiro."
}

$status = Get-Content $statusPath -Raw | ConvertFrom-Json

function Convert-ToBoolean {
    param([string]$Value)

    switch ($Value.ToLowerInvariant()) {
        "1" { return $true }
        "0" { return $false }
        "true" { return $true }
        "false" { return $false }
        default { throw "Valor booleano invalido: $Value" }
    }
}

function Ensure-Property {
    param(
        [object]$Object,
        [string]$Name,
        $DefaultValue
    )

    if (-not ($Object.PSObject.Properties.Name -contains $Name)) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $DefaultValue
    }
}

Ensure-Property -Object $status.wallet -Name "name" -DefaultValue ""
Ensure-Property -Object $status.wallet -Name "stxAddress" -DefaultValue ""
Ensure-Property -Object $status.wallet -Name "btcAddress" -DefaultValue ""
Ensure-Property -Object $status.wallet -Name "taprootAddress" -DefaultValue ""

if ($PSBoundParameters.ContainsKey("Stage")) {
    $status.stage = $Stage
}

if ($PSBoundParameters.ContainsKey("WalletCreated")) {
    $status.wallet.created = Convert-ToBoolean $WalletCreated
}

if ($PSBoundParameters.ContainsKey("WalletValidated")) {
    $status.wallet.validated = Convert-ToBoolean $WalletValidated
}

if ($PSBoundParameters.ContainsKey("WalletFunded")) {
    $status.wallet.funded = Convert-ToBoolean $WalletFunded
}

if ($PSBoundParameters.ContainsKey("Phase0Executed")) {
    $status.phase0.firstCycleExecuted = Convert-ToBoolean $Phase0Executed
}

if ($PSBoundParameters.ContainsKey("Phase1Executed")) {
    $status.phase1.firstManualTradeExecuted = Convert-ToBoolean $Phase1Executed
}

if ($PSBoundParameters.ContainsKey("WalletName")) {
    $status.wallet.name = $WalletName
}

if ($PSBoundParameters.ContainsKey("WalletStxAddress")) {
    $status.wallet.stxAddress = $WalletStxAddress
}

if ($PSBoundParameters.ContainsKey("WalletBtcAddress")) {
    $status.wallet.btcAddress = $WalletBtcAddress
}

if ($PSBoundParameters.ContainsKey("WalletTaprootAddress")) {
    $status.wallet.taprootAddress = $WalletTaprootAddress
}

$status.checkedAtUtc = [datetime]::UtcNow.ToString("o")
$status | ConvertTo-Json -Depth 10 | Set-Content -Path $statusPath -Encoding UTF8

Write-Host "DOG MM status updated."
