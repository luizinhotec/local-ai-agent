# AIBTC DOG MM Bitflow Executor Runbook

## Objetivo

Evoluir o `DOG MM Agent` de executor seguro para agente economico observacional, alinhado ao ciclo:

- observe
- decide
- act
- reflect
- repeat

O fluxo continua:

- separado do `Speedy Indra`
- seguro por padrao
- `dry-run` por padrao
- sem broadcast automatico em producao

## Arquivos Principais

- executor: `active/tools/bitflow-runtime/dog-mm-bitflow-swap-executor.cjs`
- safe wrapper: `active/tools/bitflow-runtime/dog-mm-safe-wrapper.cjs`
- resumo de pnl: `active/tools/bitflow-runtime/dog-mm-pnl-summary.cjs`
- estudo de cenarios: `active/tools/bitflow-runtime/dog-mm-dry-run-study.cjs`
- runner recorrente one-shot: `run-dog-mm-once.ps1`
- loop manual de compatibilidade: `run-dog-mm-loop.ps1`
- state do ultimo plano: `active/state/dog-mm/bitflow-last-swap-plan.json`
- resumo markdown do ultimo plano: `active/state/dog-mm/bitflow-last-swap-plan.md`
- log recorrente: `active/state/dog-mm/dog-mm-safe-loop.log`
- ops log estruturado: `active/state/dog-mm/dog-mm-ops-log.jsonl`

## Variaveis Obrigatorias

Obrigatorias para execucao real do executor:

- `DOG_MM_WALLET_PASSWORD`

Obrigatorias para estudo economico completo:

- `DOG_MM_INPUT_TOKEN_USD`
- `DOG_MM_OUTPUT_TOKEN_USD`
- `DOG_MM_STX_USD`

Sem os precos acima, o executor continua funcionando, mas marca `profitDiagnostics.complete=false`.

## Variaveis Opcionais

Selecao de wallet:

- `DOG_MM_WALLET_NAME`
- `DOG_MM_WALLET_ID`
- `DOG_MM_EXPECTED_ADDRESS`

Parametros operacionais:

- `DOG_MM_INPUT_TOKEN`
- `DOG_MM_OUTPUT_TOKEN`
- `DOG_MM_AMOUNT_IN`
- `DOG_MM_AMM_STRATEGY`
- `DOG_MM_PREFERRED_AMM`
- `DOG_MM_SLIPPAGE_TOLERANCE`

Parametros de estudo economico:

- `DOG_MM_INPUT_TOKEN_DECIMALS`
- `DOG_MM_OUTPUT_TOKEN_DECIMALS`
- `DOG_MM_INPUT_TOKEN_USD`
- `DOG_MM_OUTPUT_TOKEN_USD`
- `DOG_MM_STX_USD`

Safety classico:

- `DOG_MM_SAFE_MAX_AMOUNT_IN`
- `DOG_MM_SAFE_MAX_SLIPPAGE_TOLERANCE`
- `DOG_MM_SAFE_MAX_FEE`
- `DOG_MM_SAFE_MAX_ROUTE_HOPS`
- `DOG_MM_SAFE_MIN_OUTPUT_RATIO`
- `DOG_MM_SAFE_MAX_FEE_PER_BYTE`
- `DOG_MM_SAFE_ALLOW_BROADCAST`

Safety economico:

- `DOG_MM_PROFIT_ENFORCEMENT=off|warn|block`
- `DOG_MM_MIN_NET_PROFIT_USD`
- `DOG_MM_MIN_WORST_CASE_NET_PROFIT_USD`
- `DOG_MM_MIN_NET_PROFIT_BPS`
- `DOG_MM_MAX_FEE_AS_PERCENT_OF_GROSS_PROFIT`

Estudo automatizado:

- `DOG_MM_STUDY_AMOUNTS`
- `DOG_MM_STUDY_AMM_STRATEGIES`

## Fee Diagnostics

O executor calcula e persiste:

- `txBytes`
- `txHexLength`
- `feeMicroStx`
- `feeStx`
- `feePerByte`
- `routeHops`
- `routePathLength`
- `executionPathLength`
- `postConditionCount`
- `typedParameterCount`

Esses campos aparecem:

- no console
- no JSON de state
- no markdown do plano

## Profit Diagnostics

O executor agora calcula, quando houver dados suficientes:

- `inputTokenDecimals`
- `outputTokenDecimals`
- `inputTokenUsd`
- `outputTokenUsd`
- `stxUsd`
- `inputAmountHuman`
- `expectedOutputHuman`
- `minOutputHuman`
- `inputUsd`
- `expectedOutputUsd`
- `minOutputUsd`
- `networkFeeMicroStx`
- `networkFeeStx`
- `networkFeeUsd`
- `grossProfitUsd`
- `worstCaseProfitUsd`
- `netProfitUsd`
- `worstCaseNetProfitUsd`
- `netProfitBps`
- `worstCaseNetProfitBps`
- `feeAsPercentOfInput`
- `feeAsPercentOfExpectedOutput`
- `feeAsPercentOfGrossProfit`

Campos auxiliares:

- `complete`
- `missingFields`

## DOG_MM_PROFIT_ENFORCEMENT

Comportamento:

- `off`: nao usa diagnostico economico para decidir
- `warn`: registra e avisa quando a operacao parece economicamente ruim
- `block`: bloqueia quando os checks economicos falham

Default atual:

- `warn`

## PASS, BLOCKED, WARN

- `PASS`: passou no safety classico e nao houve bloqueio economico
- `BLOCKED`: falhou em algum guardrail classico ou em regra economica com enforcement `block`
- `WARN`: aparece na secao `Warnings` quando o enforcement economico esta em `warn`

## Dry Run

Com o ambiente carregado:

```powershell
. .\.env.ps1
npm run dog-mm:safe
```

Ou com overrides explicitos:

```powershell
. .\.env.ps1
npm run dog-mm:safe -- --amount-in 13479 --wallet-name $env:DOG_MM_WALLET_NAME
```

## Loop

Execucao recorrente one-shot, adequada para tarefa agendada:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-dog-mm-once.ps1
```

Loop manual de compatibilidade:

```powershell
powershell -ExecutionPolicy Bypass -File .\run-dog-mm-loop.ps1
```

O runner recorrente:

- carrega `.env.ps1` explicitamente
- escreve log local
- usa lock file para evitar concorrencia
- continua recorrente mesmo se um ciclo falhar

## Resumo de PnL

```powershell
npm run dog-mm:pnl
```

Gera:

- `active/state/dog-mm/dog-mm-pnl-summary.json`
- `active/state/dog-mm/dog-mm-pnl-summary.md`

## Estudo Automatizado

```powershell
. .\.env.ps1
npm run dog-mm:study
```

Com overrides:

```powershell
. .\.env.ps1
npm run dog-mm:study -- --amounts 8000,12000,16000,20000 --amm-strategies best
```

Gera:

- `active/state/dog-mm/study/dog-mm-dry-run-study.json`
- `active/state/dog-mm/study/dog-mm-dry-run-study.md`

## Historico Estruturado

Cada ciclo do wrapper registra um evento `agent_cycle_evaluated` em:

- `active/state/dog-mm/dog-mm-ops-log.jsonl`

Campos principais registrados:

- timestamp
- wallet name
- amount in
- route hops
- execution path length
- fee
- fee per byte
- expected output
- min output
- net profit estimado
- worst case net profit estimado
- validation final
- motivos de bloqueio e warning

## Regras Operacionais

- nao hardcode credenciais
- nao assumir wallet fixa fora de defaults legados nao sensiveis
- nao habilitar broadcast automatico
- priorizar modo observacional antes de modo bloqueante
- preservar o `dry-run`
