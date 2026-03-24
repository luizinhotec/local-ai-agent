# AIBTC_DOG_MM_READY_TO_TRADE_RUNBOOK.md

## Objetivo

Gerar os artefatos finais imediatamente antes da primeira execucao manual.

## Artefatos

- [prefill-dog-mm-phase0-log.ps1](/c:/dev/local-ai-agent/active/scripts/prefill-dog-mm-phase0-log.ps1)
- [prefill-dog-mm-phase1-log.ps1](/c:/dev/local-ai-agent/active/scripts/prefill-dog-mm-phase1-log.ps1)
- [export-dog-mm-ready-to-trade.md.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-ready-to-trade.md.ps1)
- [prepare-dog-mm-phase0-go-live.ps1](/c:/dev/local-ai-agent/active/scripts/prepare-dog-mm-phase0-go-live.ps1)
- [export-dog-mm-phase0-pretrade-snapshot.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-phase0-pretrade-snapshot.ps1)
- [export-dog-mm-phase0-action-sheet.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-phase0-action-sheet.ps1)
- [export-dog-mm-phase0-monitor-card.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-phase0-monitor-card.ps1)
- [invoke-dog-mm-bitflow-swap.ps1](/c:/dev/local-ai-agent/active/scripts/invoke-dog-mm-bitflow-swap.ps1)
- [record-dog-mm-bitflow-swap-execution.ps1](/c:/dev/local-ai-agent/active/scripts/record-dog-mm-bitflow-swap-execution.ps1)
- [export-dog-mm-phase0-lp-add-card.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-phase0-lp-add-card.ps1)
- [dog-mm-ready-to-trade.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-ready-to-trade.md)
- [bitflow-last-swap-plan.md](/c:/dev/local-ai-agent/active/state/dog-mm/bitflow-last-swap-plan.md)

## Comandos

Prefill fase 0:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/prefill-dog-mm-phase0-log.ps1
```

Prefill fase 1:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/prefill-dog-mm-phase1-log.ps1
```

Resumo final:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-ready-to-trade.md.ps1
```

Go-live pack da fase 0:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/prepare-dog-mm-phase0-go-live.ps1 -StxBalance 3 -SbtcBalanceSats 32500 -UsdcxBalance 0
```

Dry-run do executor Bitflow:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/invoke-dog-mm-bitflow-swap.ps1 -AmountIn 13479 -WalletPassword "PREENCHER"
```
