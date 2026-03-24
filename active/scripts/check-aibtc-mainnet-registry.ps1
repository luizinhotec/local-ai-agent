$registryUrl = "https://stx402.com/agent/registry"

try {
    $response = Invoke-WebRequest -UseBasicParsing $registryUrl -TimeoutSec 30
    $body = $response.Content | ConvertFrom-Json
    $networks = $body.networks
    $mainnet = $networks.mainnet
    $testnet = $networks.testnet

    Write-Host "AIBTC mainnet registry status"
    Write-Host "URL: $registryUrl"
    Write-Host "HTTP: $($response.StatusCode)"
    Write-Host ""

    if ($null -eq $mainnet) {
        Write-Host "[warn] mainnet registry ainda indisponivel"
        if ($null -ne $testnet) {
            Write-Host "[info] testnet registry publicado; bloqueio atual e apenas da mainnet"
            Write-Host ($testnet | ConvertTo-Json -Depth 8)
        }
    } else {
        Write-Host "[ok] mainnet registry publicado"
        $mainnet | ConvertTo-Json -Depth 8
    }

    if ($null -ne $body.specification) {
        Write-Host ""
        Write-Host "Especificacao:"
        $body.specification | ConvertTo-Json -Depth 8
    }

    Write-Host ""
    Write-Host "Payload bruto:"
    $body | ConvertTo-Json -Depth 8
} catch {
    Write-Host "[err] falha ao consultar registry"
    Write-Host $_.Exception.Message
    exit 1
}
