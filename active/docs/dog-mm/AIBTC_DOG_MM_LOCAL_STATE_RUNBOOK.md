# AIBTC_DOG_MM_LOCAL_STATE_RUNBOOK.md

## Objetivo

Manter um estado local separado para a trilha do `DOG MM Agent`.

## Arquivos

- `active/state/dog-mm/dog-mm-setup-status.json`
- `active/state/dog-mm/dog-mm-ops-log.jsonl`
- `active/state/dog-mm-hodlmm-status.json`

## Scripts

- [initialize-dog-mm-local-state.ps1](/c:/dev/local-ai-agent/active/scripts/initialize-dog-mm-local-state.ps1)
- [write-dog-mm-local-event.ps1](/c:/dev/local-ai-agent/active/scripts/write-dog-mm-local-event.ps1)
- [write-dog-mm-local-event-from-file.ps1](/c:/dev/local-ai-agent/active/scripts/write-dog-mm-local-event-from-file.ps1)
- [show-dog-mm-status.ps1](/c:/dev/local-ai-agent/active/scripts/show-dog-mm-status.ps1)

## Uso Rapido

Inicializar estado:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/initialize-dog-mm-local-state.ps1
```

Registrar evento:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/write-dog-mm-local-event.ps1 -Type "phase0_planned" -DetailsJson "{\"pool\":\"sBTC-USDCx\",\"binStep\":1}"
```

Mostrar status:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-dog-mm-status.ps1 -Plain
```

## Regra

- nunca misturar esse estado com o estado do agente principal
- nunca salvar segredo aqui
- usar esse estado para acompanhar preparacao, treino e fase 1 do `DOG MM Agent`
