# AIBTC_DOG_MM_DAILY_OPERATIONS_RUNBOOK.md

## Objetivo

Padronizar a abertura e o fechamento da rotina diaria do `DOG MM Agent`.

## Artefatos

- [ensure-dog-mm-input-files.ps1](/c:/dev/local-ai-agent/active/scripts/ensure-dog-mm-input-files.ps1)
- [start-dog-mm-day.ps1](/c:/dev/local-ai-agent/active/scripts/start-dog-mm-day.ps1)
- [close-dog-mm-day.ps1](/c:/dev/local-ai-agent/active/scripts/close-dog-mm-day.ps1)
- [write-dog-mm-local-event-from-file.ps1](/c:/dev/local-ai-agent/active/scripts/write-dog-mm-local-event-from-file.ps1)
- [test-dog-mm-input-readiness.ps1](/c:/dev/local-ai-agent/active/scripts/test-dog-mm-input-readiness.ps1)

## Abertura do Dia

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/start-dog-mm-day.ps1
```

Com backup:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/start-dog-mm-day.ps1 -IncludeBackup
```

## Fechamento do Dia

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/close-dog-mm-day.ps1
```

Com backup:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/close-dog-mm-day.ps1 -IncludeBackup
```

## Log por Arquivo

Quando for melhor evitar escaping no PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/write-dog-mm-local-event-from-file.ps1 `
  -Type "phase0_note" `
  -DetailsPath "CAMINHO_JSON"
```

## Regra

- abrir o dia sempre pelo `start-dog-mm-day.ps1`
- fechar o dia sempre pelo `close-dog-mm-day.ps1`
- nao registrar segredos no log local
- diferenciar arquivo presente de arquivo realmente pronto
