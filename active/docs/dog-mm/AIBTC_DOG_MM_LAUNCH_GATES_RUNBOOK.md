# AIBTC_DOG_MM_LAUNCH_GATES_RUNBOOK.md

## Objetivo

Consolidar em uma unica visao os gates de lancamento da fase `0` e da fase `1`.

## Artefatos

- [test-dog-mm-launch-gates.ps1](/c:/dev/local-ai-agent/active/scripts/test-dog-mm-launch-gates.ps1)
- [watch-dog-mm-launch-status.ps1](/c:/dev/local-ai-agent/active/scripts/watch-dog-mm-launch-status.ps1)
- [export-dog-mm-morning-brief.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-morning-brief.ps1)
- [export-dog-mm-ops-dashboard.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-ops-dashboard.ps1)
- [dog-mm-morning-brief.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-morning-brief.md)
- [dog-mm-ops-dashboard.html](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-ops-dashboard.html)

## Comandos

Checagem unica:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/test-dog-mm-launch-gates.ps1 -Plain
```

Watch continuo:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/watch-dog-mm-launch-status.ps1 -IntervalSeconds 300
```

Exportar morning brief:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-morning-brief.ps1
```

## Uso Recomendado

1. rodar os launch gates
2. confirmar o `global_next_action`
3. exportar o morning brief
4. executar a proxima acao sem misturar trilhas
