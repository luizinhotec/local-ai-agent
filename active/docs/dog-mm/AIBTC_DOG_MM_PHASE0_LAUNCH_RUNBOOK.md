# AIBTC_DOG_MM_PHASE0_LAUNCH_RUNBOOK.md

## Objetivo

Fechar a liberacao operacional da fase `0` do `DOG MM Agent` antes do primeiro ciclo manual em `sBTC-USDCx`.

## Artefatos

- [dog-mm-funding-input.template.json](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-funding-input.template.json)
- [apply-dog-mm-funding-input.ps1](/c:/dev/local-ai-agent/active/scripts/apply-dog-mm-funding-input.ps1)
- [test-dog-mm-phase0-preflight.ps1](/c:/dev/local-ai-agent/active/scripts/test-dog-mm-phase0-preflight.ps1)
- [export-dog-mm-phase0-execution-brief.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-phase0-execution-brief.ps1)
- [dog-mm-phase0-execution-brief.md](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-phase0-execution-brief.md)

## Sequencia Recomendada

1. validar os enderecos publicos da wallet segregada
2. aplicar o funding experimental separado
3. rodar o preflight da fase `0`
4. exportar o brief de execucao
5. abrir o ciclo manual apenas se o preflight retornar `phase0_can_launch`

## Funding

Criar o arquivo de trabalho a partir do template:

```powershell
Copy-Item active/state/dog-mm/dog-mm-funding-input.template.json active/state/dog-mm/dog-mm-funding-input.json
```

Aplicar o funding:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/apply-dog-mm-funding-input.ps1
```

## Preflight

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/test-dog-mm-phase0-preflight.ps1 -Plain
```

## Brief

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-phase0-execution-brief.ps1
```

## Gate de Execucao

Somente executar a fase `0` quando:

- `wallet_validated = true`
- `wallet_funded = true`
- `phase0_launch_ready = true`
- a pool `sBTC-USDCx` com `bin_step = 1` seguir ativa
- o mandato separado do `DOG MM Agent` seguir intacto
