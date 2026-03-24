# AIBTC_DOG_MM_PHASE1_LAUNCH_RUNBOOK.md

## Objetivo

Fechar a revalidacao operacional da fase `1` antes do primeiro teste manual em `sBTC-DOG`.

## Artefatos

- [check-dog-mm-phase1-pool.ps1](/c:/dev/local-ai-agent/active/scripts/check-dog-mm-phase1-pool.ps1)
- [test-dog-mm-phase1-preflight.ps1](/c:/dev/local-ai-agent/active/scripts/test-dog-mm-phase1-preflight.ps1)
- [export-dog-mm-phase1-execution-brief.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-phase1-execution-brief.ps1)
- [dog-mm-phase1-execution-brief.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-phase1-execution-brief.md)

## Sequencia Recomendada

1. validar a wallet segregada
2. confirmar o funding experimental
3. rodar o preflight da fase `1`
4. exportar o brief de execucao
5. abrir a operacao manual apenas se o preflight retornar `phase1_can_launch`

## Pool Snapshot

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/check-dog-mm-phase1-pool.ps1 -Plain
```

## Preflight

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/test-dog-mm-phase1-preflight.ps1 -Plain
```

## Brief

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-phase1-execution-brief.ps1
```

## Gate de Execucao

Somente executar a fase `1` quando:

- `wallet_validated = true`
- `wallet_funded = true`
- `phase1_launch_ready = true`
- a pool `sBTC-DOG` continuar com `TVL >= USD 5.000`
- a friccao estimada de entrada continuar `<= 3%`
- a rechecagem de `DOG` no `HODLMM` tiver sido feita
