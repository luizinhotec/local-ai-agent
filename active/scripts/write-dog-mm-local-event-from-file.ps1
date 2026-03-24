param(
    [Parameter(Mandatory = $true)]
    [string]$Type,
    [Parameter(Mandatory = $true)]
    [string]$DetailsPath
)

$ErrorActionPreference = "Stop"

$writeEventScript = Join-Path $PSScriptRoot "write-dog-mm-local-event.ps1"

if (-not (Test-Path $DetailsPath)) {
    throw "Arquivo de detalhes nao encontrado: $DetailsPath"
}

$detailsJson = Get-Content $DetailsPath -Raw

powershell -ExecutionPolicy Bypass -File $writeEventScript `
    -Type $Type `
    -DetailsJson $detailsJson
