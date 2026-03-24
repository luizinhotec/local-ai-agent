# AIBTC_DOG_MM_PHASE0_RUNBOOK.md

## Objetivo

Executar o primeiro ciclo de shadow training do `DOG MM Agent` em `HODLMM/DLMM`.

## Setup do Primeiro Ciclo

- pool: `sBTC-USDCx`
- `bin_step`: `1`
- capital inicial recomendado: `US$ 20`
- ativo ancora do treino: `sBTC`
- janela inicial de observacao: `24h`

## Checklist Pre-Trade

- confirmar wallet segregada do `DOG MM Agent`
- confirmar que o capital usado pertence ao envelope da fase `0`
- confirmar que a pool `sBTC-USDCx` com `bin_step = 1` segue ativa
- rodar o preflight automatico da fase `0`
- exportar o brief de execucao da fase `0`
- rodar o `dry-run` do executor Bitflow antes de qualquer broadcast
- confirmar que a fase `1` de `DOG` nao sera contaminada por este treino
- abrir o template de log da fase `0` antes da execucao

## Passos

1. consultar estado atual da pool
2. registrar pool, `bin_step`, contexto e hipotese
3. abrir a posicao de treino
4. registrar hash, horario e tese operacional
5. observar por `24h`
6. decidir entre manter, recentrar uma vez ou encerrar
7. fechar o ciclo e registrar o aprendizado

## Executor Bitflow

O runtime agora consegue preparar e assinar o swap de montagem do inventario no proprio ambiente local.

Comando de `dry-run`:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/invoke-dog-mm-bitflow-swap.ps1 -AmountIn 13479 -WalletPassword "PREENCHER"
```

Comando de broadcast:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/invoke-dog-mm-bitflow-swap.ps1 -AmountIn 13479 -WalletPassword "PREENCHER" -Broadcast
```

Observacao operacional:

- o executor usa a rota que a Bitflow expuser no momento
- isso pode resultar em `multi-hop` via `STX`, mesmo quando a intencao operacional final e montar inventario para a pool `sBTC-USDCx`
- por isso o operador deve revisar `active/state/dog-mm/bitflow-last-swap-plan.md` antes de transmitir
- o swap executado monta inventario, mas nao abre a LP por si so
- o `phase0_open` so deve ser registrado depois do `add liquidity`

## Estado Intermediario

Depois do swap e antes do LP add:

- estado correto: `inventory_staged_lp_pending`
- artefato local: `active/state/dog-mm/phase0-session/dog-mm-phase0-execution-status.md`
- snapshot local: `active/state/dog-mm/phase0-session/dog-mm-phase0-postswap-snapshot.md`
- card de proxima acao: `active/state/dog-mm/phase0-session/dog-mm-phase0-lp-add-card.md`

Registrar esse estado:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/record-dog-mm-bitflow-swap-execution.ps1 -SwapTxId "PREENCHER_TXID" -StxBalance 0 -SbtcBalanceSats 0 -UsdcxBalance 0
```

## Comandos de Registro Assistido

Registrar abertura:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/record-dog-mm-phase0-open.ps1 -TxHashOpen "PREENCHER_TXID"
```

Registrar checkpoint:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/record-dog-mm-phase0-checkpoint.ps1 -CheckpointLabel "t+1h" -StayedInRange "yes" -RangeBreachDetected "no" -RecenterNeeded "no" -FrictionObserved "PREENCHER"
```

Registrar fechamento:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/record-dog-mm-phase0-close.ps1 -TxHashClose "PREENCHER_TXID" -ReasonForClose "manual_close_after_24h" -StayedInRange "PREENCHER" -RangeBreachDetected "PREENCHER" -RecenterNeeded "PREENCHER" -FrictionObserved "PREENCHER" -WhatWasValidated "PREENCHER" -WhatFailed "PREENCHER" -WhatChangesForDog "PREENCHER" -ReusableRuleForHodlmmDog "PREENCHER"
```

## Regra de Recentragem

Neste primeiro ciclo:

- no maximo uma recentragem
- nao recentrar antes de `12h`, salvo evento de risco
- se uma segunda recentragem parecer necessaria, encerrar e registrar a falha da hipotese

## O Que Registrar

- pool usada
- `bin_step`
- capital usado
- tese de range
- tese de recentragem
- horario de abertura
- horario de eventual recentragem
- horario de fechamento
- friccao percebida
- principal aprendizado reaproveitavel para `DOG`

## Criterio de Encerramento Bem-Sucedido

- ciclo fechado
- log completo
- avaliacao objetiva da heuristica
- decisao sobre manter ou trocar a pool de treino
