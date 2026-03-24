# AIBTC_DOG_MM_PHASE1_DECISION.md

## Objetivo

Registrar a decisao operacional da fase 1 do `DOG MM Agent` sem misturar esta trilha com o fluxo principal do `Speedy Indra`.

## Decisao Consolidada

Validacao feita em `2026-03-15` no contexto local e confirmada com dados atuais do `Bitflow` em `2026-03-16 UTC`.

Escolhas aprovadas para a fase 1:

- pool alvo inicial: `sBTC-DOG`
- venue inicial: `Bitflow`
- tipo de pool realmente disponivel hoje: `XYK`
- asset base da estrategia: `sBTC`
- capital total aprovado: `US$ 100`
- capital maximo por operacao: `US$ 60`
- reserva minima fora da posicao: `US$ 40`
- primeira abertura pretendida: ate `US$ 50`

## Motivo da Escolha da Pool

Entre as pools `DOG` observadas no `Bitflow` atual:

- `sBTC-DOG` apresenta TVL proximo de `US$ 12.5k`
- `pBTC-DOG` apresenta TVL proximo de `US$ 375`

Decisao:

- usar `sBTC-DOG` como unica pool da fase 1
- nao usar `pBTC-DOG` na fase 1

## Motivo da Escolha do Asset Base

`sBTC` vira o asset base da estrategia porque:

- funciona melhor como ancora de inventario
- reduz a dependencia de manter caixa residual em `DOG`
- facilita medir exposicao e perda em um denominador mais estavel
- e compativel com a futura ideia de rebalancear entre os mesmos assets da pool

## Restricao Importante

O blueprint original fala em liquidez concentrada, mas a disponibilidade atual de mercado nao suporta isso para `DOG` no `Bitflow`.

Estado atual observado:

- nao ha pool `DOG` listada no conjunto publico de pools `DLMM/HODLMM`
- portanto a fase 1 precisa usar a pool spot `sBTC-DOG` do `Bitflow` principal
- a trilha de liquidez concentrada para `DOG` continua valida apenas como proxima etapa, nao como requisito de entrada da fase 1

## Guardrails da Fase 1

- sem leverage
- sem borrowing
- sem CEX
- sem usar wallet do agente atual
- sem usar wallet principal
- sem operar mais de uma pool
- sem ajuste manual antes de `24h`, salvo evento de risco
- stop se `pool_status != true`
- stop se TVL cair abaixo de `US$ 5.000`
- stop se a friccao de entrada ou saida passar de `3%`

## Proximo Passo

Executar apenas a preparacao operacional:

- criar wallet nova e exclusiva do `DOG MM Agent`
- fundear a wallet com lote experimental separado
- entrar na fase 1 manual usando apenas `sBTC-DOG`
