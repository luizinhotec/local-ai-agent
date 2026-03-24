# AIBTC_DOG_MM_PHASE0_SHADOW_TRAINING.md

## Objetivo

Definir uma fase `0` de treino para o `DOG MM Agent` usando pools ja existentes do `HODLMM/DLMM`, antes da abertura da pool alvo de `DOG`.

Esta fase nao muda o mandato final do agente.

Ela existe para:

- treinar heuristica de range e recentragem
- medir disciplina operacional
- validar processo de observacao e log
- reduzir erro de execucao quando `DOG` entrar no `HODLMM`

## Principio

Nesta fase, o bot treina o comportamento de market making.

Ele nao treina a tese direcional de `DOG`.

Ou seja:

- o alvo final continua sendo `DOG`
- o treino ocorre em assets diferentes
- quando a pool `DOG` abrir, muda-se o asset, nao o processo basico

## Pools de Treino Prioritarias

Estado observado no conjunto publico atual do `Bitflow DLMM`:

- `sBTC-USDCx` com `bin_step` de `1`
- `sBTC-USDCx` com `bin_step` de `10`
- `STX-USDCx` com `bin_step` de `1`
- `STX-USDCx` com `bin_step` de `4`
- `STX-USDCx` com `bin_step` de `10`
- `STX-sBTC` com `bin_step` de `15`
- `aeUSDC-USDCx` com `bin_step` de `1`

## Escolha Recomendada

Prioridade de treino:

1. `sBTC-USDCx` com `bin_step = 1`
2. `STX-USDCx` com `bin_step = 1` ou `4`
3. `aeUSDC-USDCx` apenas para treino mecanico de baixa volatilidade

## Motivo da Escolha

`sBTC-USDCx` e a melhor candidata principal porque:

- mantem `sBTC` no centro da disciplina de inventario
- aproxima o treino da ancora de risco que ja foi escolhida para `DOG`
- permite observar comportamento de range em um ativo relevante para a trilha final

`STX-USDCx` serve como treino secundario porque:

- oferece outro perfil de volatilidade
- ajuda a comparar como o bot reage em um mercado menos alinhado ao ativo final

`aeUSDC-USDCx` serve apenas como treino mecanico porque:

- ajuda a validar processo
- nao e boa proxy para o comportamento final do mandato

## O Que Treinar

Nesta fase, treinar:

- escolha de range inicial
- criterio de recentragem
- criterio de espera
- criterio de stop
- registro disciplinado
- comparacao entre range estreito e range mais largo

## O Que Nao Treinar

- tese direcional de `DOG`
- hedge cross-venue
- leverage
- borrowing
- CEX
- aumento de capital

## Regra de Capital

Como esta fase existe para treino e nao para PnL final:

- usar subalocacao menor que a fase 1 final
- manter capital claramente experimental
- nao comprometer a reserva destinada ao teste em `DOG`

Envelope sugerido:

- treino total: `US$ 20` a `US$ 40`
- uma unica pool por vez
- uma unica hipotese por ciclo de treino

## Criterio de Sucesso

A fase `0` so cumpre seu papel quando existir:

- pelo menos um ciclo completo de abertura e fechamento
- log estruturado de observacao
- criterio inicial de recentragem documentado
- clareza sobre o que sera reaproveitado quando `DOG` entrar no `HODLMM`
