# AIBTC_POSITION_REVALIDATION_RUNBOOK.md

Objetivo: registrar uma confirmacao real da posicao ativa do `Speedy Indra` sem editar JSON manualmente.

## Quando usar

- depois de validar a posicao real no protocolo ativo
- quando o helper mostrar `confirmacao de posicao antiga`
- antes de decidir novo aporte, saque ou troca de estrategia

## Estado atual

- protocolo ativo no baseline local: `Hermetica`
- o helper ainda usa saldos publicos via `Hiro` para `sBTC` e `STX`
- a confirmacao detalhada continua sendo registrada localmente pelo operador

## Confirmacao minima

Colete estes campos do protocolo ativo:

- `suppliedShares`
- `borrowed`
- `healthFactor`
- `checkedAtUtc`

Campos extras recomendados para `Hermetica`:

- `deployedSbtcSats`
- `liquidSbtcSats`
- `hbtcUnits`
- `entryTxid`

## Comando pronto para `Hermetica`

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/confirm-aibtc-position.ps1 `
  -Protocol Hermetica `
  -SuppliedShares 0 `
  -Borrowed 0 `
  -HealthFactor 100000000 `
  -DeployedSbtcSats 102511 `
  -LiquidSbtcSats 5000 `
  -HbtcUnits 101949 `
  -EntryTxid 9fd152c65774b0e83f5359a4488814a0928ffe192943d6bd0df6d6b1b95e83ae
```

## Comando pronto para `Zest`

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/confirm-aibtc-position.ps1 `
  -Protocol Zest `
  -SuppliedShares <shares> `
  -Borrowed <borrowed> `
  -HealthFactor <healthFactor>
```

## Depois de confirmar

Rode:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-position-status.ps1 -Plain
```

Se quiser reconstruir o estado consolidado:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-maintenance-cycle.ps1
```
