# AIBTC_DOG_MM_WALLET_EXECUTION_RUNBOOK.md

## Objetivo

Executar a preparacao real da wallet segregada do `DOG MM Agent` com acompanhamento no estado local proprio.

## Scripts Envolvidos

- [initialize-dog-mm-local-state.ps1](/c:/dev/local-ai-agent/active/scripts/initialize-dog-mm-local-state.ps1)
- [set-dog-mm-status.ps1](/c:/dev/local-ai-agent/active/scripts/set-dog-mm-status.ps1)
- [apply-dog-mm-wallet-public-input.ps1](/c:/dev/local-ai-agent/active/scripts/apply-dog-mm-wallet-public-input.ps1)
- [mark-dog-mm-wallet-validated.ps1](/c:/dev/local-ai-agent/active/scripts/mark-dog-mm-wallet-validated.ps1)
- [mark-dog-mm-wallet-funded.ps1](/c:/dev/local-ai-agent/active/scripts/mark-dog-mm-wallet-funded.ps1)
- [show-dog-mm-status.ps1](/c:/dev/local-ai-agent/active/scripts/show-dog-mm-status.ps1)
- [write-dog-mm-local-event.ps1](/c:/dev/local-ai-agent/active/scripts/write-dog-mm-local-event.ps1)

## Ordem Recomendada

1. inicializar o estado local do `DOG MM Agent`
2. criar a wallet segregada
3. registrar o nome da wallet no estado local
4. validar os enderecos publicos
5. atualizar o estado local para `wallet_created = true`
6. atualizar o estado local para `wallet_validated = true`
7. fazer o funding experimental
8. atualizar o estado local para `wallet_funded = true`

## Comandos de Estado

Marcar wallet criada:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/set-dog-mm-status.ps1 -Stage "wallet_created" -WalletCreated $true -WalletName "dog-mm-mainnet"
```

Marcar wallet validada:

```powershell
Copy-Item active/state/dog-mm/dog-mm-wallet-public-input.template.json active/state/dog-mm/dog-mm-wallet-public-input.json
```

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/apply-dog-mm-wallet-public-input.ps1
```

Marcar wallet fundeada:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/mark-dog-mm-wallet-funded.ps1 -FundingAmountUsd 100
```

Consultar status:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-dog-mm-status.ps1 -Plain
```

## Regras

- nao usar a wallet do `Speedy Indra`
- nao usar a wallet principal
- nao preencher seed ou senha no estado local
- registrar apenas enderecos publicos
- nao marcar funding antes da validacao dos enderecos
