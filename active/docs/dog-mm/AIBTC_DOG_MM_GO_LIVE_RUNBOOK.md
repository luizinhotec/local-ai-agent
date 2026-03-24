# AIBTC_DOG_MM_GO_LIVE_RUNBOOK.md

## Objetivo

Preparar os artefatos finais de go-live da fase `0` e da fase `1` depois que a wallet segregada estiver validada e fundeada.

## Artefatos

- [mark-dog-mm-setup-complete.ps1](/c:/dev/local-ai-agent/active/scripts/mark-dog-mm-setup-complete.ps1)
- [export-dog-mm-phase0-session-pack.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-phase0-session-pack.ps1)
- [export-dog-mm-phase1-session-pack.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-phase1-session-pack.ps1)

## Comandos

Marcar setup concluido:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/mark-dog-mm-setup-complete.ps1
```

Exportar pack da fase 0:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-phase0-session-pack.ps1
```

Exportar pack da fase 1:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-phase1-session-pack.ps1
```

## Regra

- fase `0` continua sendo o primeiro passo recomendado
- fase `1` so deve ser executada de forma deliberada e manual
- os packs nao substituem a confirmacao final do operador
