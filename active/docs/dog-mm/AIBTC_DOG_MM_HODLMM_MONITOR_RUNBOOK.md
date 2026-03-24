# AIBTC_DOG_MM_HODLMM_MONITOR_RUNBOOK.md

## Objetivo

Monitorar a abertura da pool `DOG` no `HODLMM/DLMM` e listar rapidamente as pools candidatas da fase `0` de shadow training.

## Scripts

- [check-dog-mm-hodlmm-status.ps1](/c:/dev/local-ai-agent/active/scripts/check-dog-mm-hodlmm-status.ps1)
- [show-dog-mm-shadow-training-pools.ps1](/c:/dev/local-ai-agent/active/scripts/show-dog-mm-shadow-training-pools.ps1)
- [watch-dog-mm-hodlmm-status.ps1](/c:/dev/local-ai-agent/active/scripts/watch-dog-mm-hodlmm-status.ps1)

## Uso Rapido

Checagem unica:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/check-dog-mm-hodlmm-status.ps1 -Plain
```

Listar pools de treino:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-dog-mm-shadow-training-pools.ps1 -Plain
```

Watch continuo:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/watch-dog-mm-hodlmm-status.ps1 -IntervalSeconds 300
```

## Resultado Esperado

- saber se a pool `DOG` no `HODLMM` ja apareceu
- ver snapshot persistido em `active/state/dog-mm-hodlmm-status.json`
- listar rapidamente as pools candidatas da fase `0`
