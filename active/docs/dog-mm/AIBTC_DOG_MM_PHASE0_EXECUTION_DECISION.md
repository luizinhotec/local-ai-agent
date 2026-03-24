# AIBTC_DOG_MM_PHASE0_EXECUTION_DECISION.md

## Objetivo

Congelar a decisao operacional da fase `0` do `DOG MM Agent`.

## Decisao Consolidada

Pool principal de treino:

- `sBTC-USDCx`
- `bin_step = 1`
- venue: `Bitflow HODLMM/DLMM`

Pool secundaria de comparacao:

- `STX-USDCx`
- `bin_step = 1`

Pools explicitamente nao prioritarias para o primeiro ciclo:

- `sBTC-USDCx` com `bin_step = 10`
- `STX-USDCx` com `bin_step = 4` ou `10`
- `STX-sBTC` com `bin_step = 15`
- `aeUSDC-USDCx`

## Motivo da Escolha

`sBTC-USDCx` com `bin_step = 1` foi escolhida porque:

- mantem `sBTC` no centro do treino
- aproxima o comportamento do ativo base pretendido para `DOG`
- oferece range mais fino para observar recentragem e disciplina
- e o melhor compromisso entre relevancia e simplicidade

## Regra de Capital da Fase 0

- envelope total de treino: `US$ 20` a `US$ 40`
- primeiro ciclo recomendado: `US$ 20`
- uma unica pool por vez
- uma unica hipotese de range por ciclo
- nao consumir a reserva destinada ao teste final em `DOG`

## Heuristica Inicial

Objetivo desta heuristica:

- ser simples
- ser observavel
- gerar aprendizado transferivel

Regra inicial:

- abrir com range moderado, nao maximo estreito
- nao recentrar no primeiro sinal pequeno de drift
- recentrar apenas quando houver saida material da zona planejada ou perda clara de utilidade do range

Traducao operacional minima:

- janela inicial de observacao: `24h`
- sem recentragem antes de `12h`, salvo evento de risco
- uma unica recentragem maxima por ciclo
- encerrar o ciclo se a segunda recentragem parecer necessaria

## Criterios Iniciais de Recentragem

Recentrar apenas se pelo menos um ocorrer:

- o preco ativo se deslocar claramente para fora da faixa util planejada
- a posicao perder utilidade de captura de fee no desenho original
- o inventario final do range ficar desbalanceado de forma nao intencional para o treino

## Criterios Iniciais de Stop

- pool inativa
- friccao pior que o esperado
- necessidade de segunda recentragem no mesmo ciclo
- necessidade de ampliar capital para salvar a hipotese
- qualquer desvio do mandato de treino

## Resultado Esperado

Ao final do primeiro ciclo da fase `0` deve existir:

- log fechado de abertura e fechamento
- avaliacao da regra de recentragem
- decisao se `sBTC-USDCx bin_step 1` continua como melhor campo de treino
