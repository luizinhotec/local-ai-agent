# AIBTC_DOG_MM_HEARTBEAT_RUNBOOK.md

## Objetivo

Criar um heartbeat proprio do `DOG MM Agent`, separado do fluxo principal, para confirmar que a fase 0 segue viva e coerente.

## Artefatos

- [run-dog-mm-heartbeat-local.ps1](/c:/dev/local-ai-agent/active/scripts/run-dog-mm-heartbeat-local.ps1)
- [get-next-dog-mm-heartbeat-window.ps1](/c:/dev/local-ai-agent/active/scripts/get-next-dog-mm-heartbeat-window.ps1)
- [watch-dog-mm-heartbeat-ready.ps1](/c:/dev/local-ai-agent/active/scripts/watch-dog-mm-heartbeat-ready.ps1)
- [show-dog-mm-status.ps1](/c:/dev/local-ai-agent/active/scripts/show-dog-mm-status.ps1)

## Uso

Status somente:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-dog-mm-heartbeat-local.ps1 -StatusOnly
```

Heartbeat real:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-dog-mm-heartbeat-local.ps1
```

Forcando a execucao:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-dog-mm-heartbeat-local.ps1 -Force
```

Watch da janela:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/watch-dog-mm-heartbeat-ready.ps1 -IntervalSeconds 30
```

## O que o heartbeat registra

- status da abertura da fase 0
- bin atual da posicao
- se a posicao ainda cobre o bin ativo
- valor live aproximado em USD
- proxima acao sugerida

## Regra

- nao misturar este heartbeat com o heartbeat do fluxo principal
- usar este heartbeat apenas para a trilha do `DOG MM Agent`
