# AIBTC_DOG_MM_READINESS_RUNBOOK.md

## Objetivo

Determinar se a trilha do `DOG MM Agent` ja pode sair de preparacao e iniciar a fase `0`.

## Scripts

- [show-dog-mm-status.ps1](/c:/dev/local-ai-agent/active/scripts/show-dog-mm-status.ps1)
- [apply-dog-mm-wallet-public-input.ps1](/c:/dev/local-ai-agent/active/scripts/apply-dog-mm-wallet-public-input.ps1)
- [apply-dog-mm-funding-input.ps1](/c:/dev/local-ai-agent/active/scripts/apply-dog-mm-funding-input.ps1)
- [mark-dog-mm-wallet-validated.ps1](/c:/dev/local-ai-agent/active/scripts/mark-dog-mm-wallet-validated.ps1)
- [mark-dog-mm-wallet-funded.ps1](/c:/dev/local-ai-agent/active/scripts/mark-dog-mm-wallet-funded.ps1)
- [test-dog-mm-readiness.ps1](/c:/dev/local-ai-agent/active/scripts/test-dog-mm-readiness.ps1)

## Uso Rapido

Consultar readiness:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/test-dog-mm-readiness.ps1 -Plain
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
Copy-Item active/state/dog-mm/dog-mm-funding-input.template.json active/state/dog-mm/dog-mm-funding-input.json
```

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/apply-dog-mm-funding-input.ps1
```

## Regra de Liberacao da Fase 0

A fase `0` so pode iniciar quando:

- `wallet_created = true`
- `wallet_validated = true`
- `wallet_funded = true`
- `phase0_pool_defined = true`
- `next_action = phase0_can_start`

## Regra de Liberacao da Fase 1

A fase `1` so pode iniciar quando:

- a wallet estiver criada, validada e fundeada
- a pool `sBTC-DOG` continuar aprovada
- a janela de reavaliacao do `HODLMM` tiver sido checada

## Guard Rails

- nao marcar `wallet_funded` antes de `wallet_validated`
- nao validar enderecos antes de `wallet_created`
- sempre reexecutar `test-dog-mm-readiness.ps1` apos validacao e apos funding
