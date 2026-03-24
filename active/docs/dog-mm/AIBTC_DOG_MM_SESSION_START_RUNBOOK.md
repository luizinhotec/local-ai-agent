# AIBTC_DOG_MM_SESSION_START_RUNBOOK.md

## Objetivo

Padronizar o inicio das sessoes operacionais da fase `0` e da fase `1`.

## Artefatos

- [start-dog-mm-phase0-session.ps1](/c:/dev/local-ai-agent/active/scripts/start-dog-mm-phase0-session.ps1)
- [start-dog-mm-phase1-session.ps1](/c:/dev/local-ai-agent/active/scripts/start-dog-mm-phase1-session.ps1)
- [export-dog-mm-execution-queue.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-execution-queue.ps1)
- [dog-mm-execution-queue.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-execution-queue.md)

## Comandos

Iniciar sessao da fase 0:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/start-dog-mm-phase0-session.ps1
```

Iniciar sessao da fase 1:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/start-dog-mm-phase1-session.ps1
```

Exportar queue:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-execution-queue.ps1
```

## Regra

- fase `0` continua sendo a primeira sessao recomendada
- fase `1` nao deve ser tratada como automatica so porque o gate esta aberto
