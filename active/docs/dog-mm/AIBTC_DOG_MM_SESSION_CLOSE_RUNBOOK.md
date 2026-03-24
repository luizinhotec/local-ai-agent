# AIBTC_DOG_MM_SESSION_CLOSE_RUNBOOK.md

## Objetivo

Padronizar o encerramento das sessoes da fase `0` e da fase `1`, e gerar os artefatos de revisao do operador.

## Artefatos

- [close-dog-mm-phase0-session.ps1](/c:/dev/local-ai-agent/active/scripts/close-dog-mm-phase0-session.ps1)
- [close-dog-mm-phase1-session.ps1](/c:/dev/local-ai-agent/active/scripts/close-dog-mm-phase1-session.ps1)
- [export-dog-mm-post-session-review.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-post-session-review.ps1)
- [export-dog-mm-operator-handoff.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-operator-handoff.ps1)

## Comandos

Fechar fase 0:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/close-dog-mm-phase0-session.ps1
```

Fechar fase 1:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/close-dog-mm-phase1-session.ps1
```

Exportar post-session review:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-post-session-review.ps1
```

Exportar operator handoff:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-operator-handoff.ps1
```
