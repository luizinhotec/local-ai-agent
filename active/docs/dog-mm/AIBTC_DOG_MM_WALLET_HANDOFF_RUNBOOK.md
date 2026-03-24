# AIBTC_DOG_MM_WALLET_HANDOFF_RUNBOOK.md

## Objetivo

Fechar o handoff operacional da wallet segregada do `DOG MM Agent` sem depender de comandos longos digitados manualmente.

## Artefatos

- [dog-mm-wallet-public-input.template.json](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-wallet-public-input.template.json)
- [apply-dog-mm-wallet-public-input.ps1](/c:/dev/local-ai-agent/active/scripts/apply-dog-mm-wallet-public-input.ps1)
- [mark-dog-mm-wallet-validated.ps1](/c:/dev/local-ai-agent/active/scripts/mark-dog-mm-wallet-validated.ps1)
- [mark-dog-mm-wallet-funded.ps1](/c:/dev/local-ai-agent/active/scripts/mark-dog-mm-wallet-funded.ps1)
- [test-dog-mm-readiness.ps1](/c:/dev/local-ai-agent/active/scripts/test-dog-mm-readiness.ps1)

## Fluxo Recomendado

1. copiar o template local para `dog-mm-wallet-public-input.json`
2. preencher apenas os enderecos publicos reais da wallet segregada
3. aplicar o input com um comando unico
4. revisar o readiness
5. somente depois marcar o funding

## Preparacao do Arquivo

Criar o arquivo de trabalho a partir do template:

```powershell
Copy-Item active/state/dog-mm/dog-mm-wallet-public-input.template.json active/state/dog-mm/dog-mm-wallet-public-input.json
```

## Aplicacao

Depois de preencher o arquivo com os enderecos reais:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/apply-dog-mm-wallet-public-input.ps1
```

## Funding

Somente apos o readiness apontar `next_action: fund_wallet`:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/mark-dog-mm-wallet-funded.ps1 -FundingAmountUsd 100
```

## Regras

- nao salvar seed phrase
- nao salvar senha
- nao salvar private key
- nao usar enderecos do `Speedy Indra`
- nao usar enderecos da wallet principal
