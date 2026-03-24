# AIBTC_DOG_MM_FUNDING_PLAN_RUNBOOK.md

## Objetivo

Determinar o aporte minimo recomendado para a wallet do `DOG MM Agent` antes da primeira execucao manual.

## Artefatos

- [export-dog-mm-funding-plan.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-funding-plan.ps1)
- [dog-mm-funding-plan.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-funding-plan.md)

## Comando

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-funding-plan.ps1
```

## Regra

- funding para fase 0 deve incluir `STX` para fees
- funding em `sBTC` deve ter pequena margem operacional, nao apenas o valor exato do alvo em USD
