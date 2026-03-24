# AIBTC_DOG_MM_FULL_SETUP_RUNBOOK.md

## Objetivo

Executar em uma unica sequencia a validacao da wallet, o funding e o refresh final da trilha do `DOG MM Agent`.

## Artefatos

- [complete-dog-mm-setup.ps1](/c:/dev/local-ai-agent/active/scripts/complete-dog-mm-setup.ps1)
- [validate-dog-mm-json-inputs.ps1](/c:/dev/local-ai-agent/active/scripts/validate-dog-mm-json-inputs.ps1)
- [test-dog-mm-input-readiness.ps1](/c:/dev/local-ai-agent/active/scripts/test-dog-mm-input-readiness.ps1)
- [show-dog-mm-remediation-plan.ps1](/c:/dev/local-ai-agent/active/scripts/show-dog-mm-remediation-plan.ps1)

## Precondicoes

- `dog-mm-wallet-public-input.json` precisa estar com enderecos publicos reais
- `dog-mm-funding-input.json` precisa estar pronto
- a trilha deve continuar separada da wallet principal e do `Speedy Indra`

## Comandos

Setup completo:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/complete-dog-mm-setup.ps1
```

Setup completo com backup:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/complete-dog-mm-setup.ps1 -IncludeBackup
```

Setup completo com abertura do control center:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/complete-dog-mm-setup.ps1 -IncludeBackup -OpenControlCenter
```

## Regra

- se houver placeholder no input da wallet, o script deve falhar cedo
- se houver problema estrutural nos JSONs, o script deve falhar cedo
- o setup completo nao deve inventar enderecos
