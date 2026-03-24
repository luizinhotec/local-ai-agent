# AIBTC_DOG_MM_PUBLIC_PROFILE_RUNBOOK.md

## Objetivo

Preparar o profile publico do `DOG MM Agent` apenas com enderecos publicos e metadados nao sensiveis.

## Scripts

- [apply-dog-mm-wallet-public-input.ps1](/c:/dev/local-ai-agent/active/scripts/apply-dog-mm-wallet-public-input.ps1)
- [set-dog-mm-wallet-addresses.ps1](/c:/dev/local-ai-agent/active/scripts/set-dog-mm-wallet-addresses.ps1)
- [mark-dog-mm-wallet-validated.ps1](/c:/dev/local-ai-agent/active/scripts/mark-dog-mm-wallet-validated.ps1)
- [export-dog-mm-agent-profile.ps1](/c:/dev/local-ai-agent/active/scripts/export-dog-mm-agent-profile.ps1)
- [show-dog-mm-status.ps1](/c:/dev/local-ai-agent/active/scripts/show-dog-mm-status.ps1)

## Regra

- registrar apenas enderecos publicos
- nao registrar seed phrase
- nao registrar senha
- nao registrar assinatura
- nao reutilizar enderecos do agente principal

## Fluxo

1. criar a wallet segregada do `DOG MM Agent`
2. copiar apenas os enderecos publicos
3. registrar os enderecos no estado local
4. exportar um preview do profile
5. revisar o JSON gerado antes de qualquer uso externo

## Exemplo

```powershell
Copy-Item active/state/dog-mm/dog-mm-wallet-public-input.template.json active/state/dog-mm/dog-mm-wallet-public-input.json
```

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/apply-dog-mm-wallet-public-input.ps1
```

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/export-dog-mm-agent-profile.ps1
```

## Saidas

- estado local atualizado em `active/state/dog-mm/dog-mm-setup-status.json`
- preview do profile em `active/state/dog-mm/dog-mm-agent-profile.preview.json`
- evento `wallet_validated` registrado no log local
