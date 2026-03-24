# AIBTC_DOG_MM_OPS_BUNDLE_RUNBOOK.md

## Objetivo

Consolidar o estado operacional do `DOG MM Agent` em um unico pacote de leitura rapida.

## Artefatos

- [export-dog-mm-ops-bundle.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-ops-bundle.ps1)
- [show-dog-mm-next-step.ps1](/c:/dev/local-ai-agent/active/scripts/show-dog-mm-next-step.ps1)
- [backup-dog-mm-local-state.ps1](/c:/dev/local-ai-agent/active/scripts/backup-dog-mm-local-state.ps1)
- [export-dog-mm-ops-dashboard.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-ops-dashboard.ps1)
- [dog-mm-ops-bundle.json](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-ops-bundle.json)
- [dog-mm-ops-bundle.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-ops-bundle.md)
- [dog-mm-ops-dashboard.html](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-ops-dashboard.html)

## Comandos

Exportar bundle:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-ops-bundle.ps1
```

Mostrar proxima acao:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-dog-mm-next-step.ps1 -Plain
```

Fazer backup do estado local:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/backup-dog-mm-local-state.ps1
```

Exportar dashboard HTML:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-ops-dashboard.ps1
```

## Uso Recomendado

1. exportar o bundle
2. checar a `next_action`
3. revisar os briefs da fase `0` e da fase `1`
4. fazer backup antes de qualquer mudanca manual relevante
