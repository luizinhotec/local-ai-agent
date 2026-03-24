# AIBTC_DOG_MM_CONTROL_CENTER_RUNBOOK.md

## Objetivo

Atualizar e abrir o centro de controle local do `DOG MM Agent` com um numero minimo de comandos.

## Artefatos

- [refresh-dog-mm-control-center.ps1](/c:/dev/local-ai-agent/active/scripts/refresh-dog-mm-control-center.ps1)
- [open-dog-mm-control-center.ps1](/c:/dev/local-ai-agent/active/scripts/open-dog-mm-control-center.ps1)
- [watch-dog-mm-control-center.ps1](/c:/dev/local-ai-agent/active/scripts/watch-dog-mm-control-center.ps1)
- [export-dog-mm-blockers-report.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-blockers-report.ps1)
- [export-dog-mm-doctor-report.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-doctor-report.ps1)
- [open-dog-mm-remediation-files.ps1](/c:/dev/local-ai-agent/active/scripts/open-dog-mm-remediation-files.ps1)
- [dog-mm-ops-dashboard.html](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-ops-dashboard.html)
- [dog-mm-morning-brief.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-morning-brief.md)
- [dog-mm-ops-bundle.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-ops-bundle.md)
- [dog-mm-blockers-report.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-blockers-report.md)
- [dog-mm-doctor-report.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-doctor-report.md)

## Comandos

Refresh completo:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/refresh-dog-mm-control-center.ps1
```

Refresh com backup:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/refresh-dog-mm-control-center.ps1 -IncludeBackup
```

Abrir o control center:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/open-dog-mm-control-center.ps1
```

Watch continuo:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/watch-dog-mm-control-center.ps1 -IntervalSeconds 300
```

Exportar doctor report:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-doctor-report.ps1
```

Abrir arquivos de remediacao:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/open-dog-mm-remediation-files.ps1
```

## Uso Recomendado

1. rodar o refresh completo
2. revisar a `next_action`
3. abrir o dashboard, o morning brief e o bundle
4. executar apenas a proxima acao real da trilha
