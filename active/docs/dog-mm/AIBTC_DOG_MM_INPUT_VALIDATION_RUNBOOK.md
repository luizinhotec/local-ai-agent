# AIBTC_DOG_MM_INPUT_VALIDATION_RUNBOOK.md

## Objetivo

Validar de forma objetiva os arquivos JSON de input e exportar a matriz de readiness da trilha.

## Artefatos

- [validate-dog-mm-json-inputs.ps1](/c:/dev/local-ai-agent/active/scripts/validate-dog-mm-json-inputs.ps1)
- [test-dog-mm-input-readiness.ps1](/c:/dev/local-ai-agent/active/scripts/test-dog-mm-input-readiness.ps1)
- [export-dog-mm-readiness-matrix.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-readiness-matrix.ps1)
- [dog-mm-readiness-matrix.csv](/c:/dev/local-ai-agent/active/state/dog-mm/dog-mm-readiness-matrix.csv)

## Comandos

Validar JSON:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/validate-dog-mm-json-inputs.ps1 -Plain
```

Validar prontidao:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/test-dog-mm-input-readiness.ps1 -Plain
```

Exportar matriz:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-readiness-matrix.ps1
```
