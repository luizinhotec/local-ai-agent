# AIBTC_DOG_MM_WALLET_AND_FUNDING_CHECKLIST.md

## Objetivo

Este checklist organiza a criacao da wallet e o funding inicial do segundo agente `DOG MM`.

## Wallet

Antes de criar:

- decidir um nome exclusivo para a wallet
- confirmar que ela nao sera reutilizada pelo agente atual
- preparar um local offline para guardar seed phrase
- preparar uma senha separada da wallet atual

Depois de criar:

- registrar offline a seed phrase
- validar o endereco BTC
- validar o endereco STX
- validar o endereco Taproot
- confirmar que nenhum segredo foi salvo no repositorio

## Funding Inicial

Politica recomendada:

- comecar pequeno
- usar capital explicitamente experimental
- nao misturar com caixa do agente atual

Decisao atual:

- funding inicial aprovado: `US$ 100`

Checklist:

- definir capital inicial maximo
- definir pool alvo aprovada
- definir o asset base da estrategia
- definir o capital maximo por operacao
- definir a perda maxima tolerada

Estado atual:

- capital inicial maximo aprovado para fase 1: `US$ 100`
- pool alvo inicial aprovada para fase 1: `sBTC-DOG` em `Bitflow`
- asset base inicial aprovado: `sBTC`
- capital maximo por operacao na fase 1: `US$ 60`
- reserva minima fora da posicao: `US$ 40`
- perda maxima tolerada na fase 1: `US$ 15`
- intervalo minimo entre ajustes manuais: `24h`, salvo evento de risco
- criterio de parada inicial:
  - `pool_status` diferente de `true`
  - TVL abaixo de `US$ 5.000`
  - friccao de entrada ou saida acima de `3%`
  - necessidade de usar wallet do agente atual ou wallet principal

## Fase 1

Funding inicial sugerido para fase 1:

- pequeno o suficiente para aprendizado
- grande o suficiente para observar comportamento real da pool
- no estado atual: `US$ 100`

O funding inicial deve servir para:

- abrir posicao pequena
- fechar posicao pequena
- medir friccao operacional
- observar inventario

## O Que Nao Fazer

- nao usar a wallet principal
- nao usar a wallet do agente atual
- nao enviar capital grande no primeiro lote
- nao integrar `Kraken`, `Gate.io` ou `MEXC` antes de validar a fase 1
- nao operar sem log de entrada e saida

## Saida Esperada

Ao final deste checklist deve existir:

- wallet nova e segregada
- funding inicial definido
- pool alvo definida
- limites operacionais definidos
- runbook de fase 1 pronto para teste manual

Decisao operacional vigente:

- nao usar `pBTC-DOG` como pool inicial
- motivo: liquidez observada muito inferior a `sBTC-DOG`
- concentrar a fase 1 em um unico par com melhor profundidade relativa dentro do universo `DOG`
