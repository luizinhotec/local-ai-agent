# AIBTC_DOG_MM_AGENT_OPERATIONS.md

## Objetivo

Este documento organiza a operacao da trilha separada do `DOG MM Agent`.

Ele nao cobre o fluxo principal do `Speedy Indra`.

## Escopo Atual

No estado atual, este agente cobre:

- shadow training em pools `HODLMM/DLMM` ja existentes
- market making manual de `DOG GO TO THE MOON`
- controle de inventario entre `sBTC` e `DOG`
- operacao restrita a uma unica pool aprovada
- observacao operacional antes de qualquer automacao

## Escopo Fora do Estado Atual

- leverage
- borrowing
- CEX
- cross-venue
- autonomia irrestrita
- uso da wallet do agente principal
- uso da wallet principal

## Pool e Asset Base Vigentes

- pool: `sBTC-DOG`
- venue: `Bitflow`
- tipo atual: `XYK`
- asset base: `sBTC`

## Ordem Operacional Atual

1. usar [AIBTC_DOG_MM_WALLET_SETUP_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_WALLET_SETUP_RUNBOOK.md)
2. validar [AIBTC_DOG_MM_WALLET_AND_FUNDING_CHECKLIST.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_WALLET_AND_FUNDING_CHECKLIST.md)
3. monitorar `HODLMM` em [AIBTC_DOG_MM_HODLMM_MONITOR_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_HODLMM_MONITOR_RUNBOOK.md)
4. seguir [AIBTC_DOG_MM_PHASE0_SHADOW_TRAINING.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE0_SHADOW_TRAINING.md)
5. executar [AIBTC_DOG_MM_PHASE0_EXECUTION_DECISION.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE0_EXECUTION_DECISION.md)
6. rodar [AIBTC_DOG_MM_PHASE0_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE0_RUNBOOK.md)
7. confirmar [AIBTC_DOG_MM_PHASE1_PRETRADE_CHECKLIST.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_PRETRADE_CHECKLIST.md)
8. executar [AIBTC_DOG_MM_PHASE1_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_RUNBOOK.md)
9. registrar resultado em [dog-mm-phase1-log-entry.template.md](/c:/dev/local-ai-agent/active/templates/aibtc/dog-mm/dog-mm-phase1-log-entry.template.md)

## Guardrails Operacionais

- capital total de fase 1 limitado a `US$ 100`
- capital maximo por operacao limitado a `US$ 60`
- reserva minima fora da posicao de `US$ 40`
- primeira abertura alvo de ate `US$ 50`
- intervalo minimo entre ajustes de `24h`, salvo evento de risco
- stop se `pool_status != true`
- stop se TVL abaixo de `US$ 5.000`
- stop se friccao acima de `3%`

## Estado de Mercado Relevante

Validacao atual:

- `DOG` nao aparece nas pools publicas de `DLMM/HODLMM`
- a fase 1 precisa usar `sBTC-DOG` no `Bitflow` principal
- a trilha de liquidez concentrada para `DOG` segue como etapa futura

Premissa operacional adicional:

- o operador informou expectativa de lancamento da pool `DOG` em `HODLMM` nos proximos `15` dias
- enquanto isso nao for confirmado de forma publica e atual, a referencia operacional continua sendo `sBTC-DOG` em `XYK`
- se o lancamento ocorrer antes da primeira abertura manual, reavaliar a ordem de execucao da fase 1

## Resultado Esperado da Fase 1

- aprender friccao real de entrada e saida
- medir comportamento de inventario
- entender necessidade de rebalanceamento
- produzir base objetiva para a fase 2
