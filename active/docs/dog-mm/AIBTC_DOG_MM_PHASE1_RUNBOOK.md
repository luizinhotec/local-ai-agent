# AIBTC_DOG_MM_PHASE1_RUNBOOK.md

## Objetivo

Este runbook organiza a fase 1 do agente `DOG MM Agent`.

Fase 1 significa:

- operar manualmente
- usar uma unica pool alvo
- validar abertura, acompanhamento e fechamento de posicao
- aprender friccao operacional antes de qualquer automacao

## Premissas Aprovadas

- agente: `DOG MM Agent`
- capital inicial: `US$ 100`
- venue inicial: `Bitflow`
- estrategia inicial: uma unica pool manual de `DOG` no `Bitflow` atual
- escopo inicial: manejar posicoes e observar necessidade de rebalanceamento

Observacao de estado validada em `2026-03-15` local / `2026-03-16 UTC`:

- `DOG` nao aparece nas pools `DLMM/HODLMM` expostas publicamente pelo `Bitflow`
- a fase 1 deve usar a pool `sBTC-DOG` do `Bitflow` principal
- a trilha de liquidez concentrada para `DOG` fica adiada ate existir pool compativel e aprovada

## O Que Precisa Estar Definido Antes da Primeira Operacao

- wallet dedicada criada e validada
- capital inicial fundeado na wallet correta
- pool alvo escolhida
- asset base da estrategia definido
- limite de perda e criterio de parada definidos

## Pool Alvo

Preencher antes de executar:

- pool: `sBTC-DOG`
- assets da pool: `sBTC` e `DOG`
- motivo da escolha: `maior liquidez entre as pools DOG ativas observadas no Bitflow atual, com pool_status ativo e profundidade materialmente superior a pBTC-DOG`
- faixa inicial pretendida: `nao aplicavel na fase 1 atual porque a pool DOG disponivel em Bitflow e XYK; o parametro operacional inicial passa a ser tamanho pequeno de posicao, nao range concentrado`

Referencia objetiva da escolha:

- `sBTC-DOG` observado com TVL proximo de `US$ 12.5k`
- `pBTC-DOG` observado com TVL proximo de `US$ 375`
- conclusao: `sBTC-DOG` e a unica pool DOG do Bitflow atual com profundidade minima razoavel para o teste manual de fase 1

Asset base da estrategia:

- asset base: `sBTC`
- motivo:
  - ancora contabil e de risco mais forte que `DOG`
  - facilita medir exposicao direcional residual contra o ativo mais volatil
  - mantem a reserva operacional em um ativo mais defensivo dentro do mandato atual

Limites operacionais da fase 1:

- capital total aprovado: `US$ 100`
- capital maximo por operacao: `US$ 60`
- reserva minima fora da posicao: `US$ 40`
- perda maxima tolerada da fase 1: `US$ 15`
- intervalo minimo entre ajustes manuais: `24h`, salvo evento de risco
- criterio de parada:
  - `pool_status != true`
  - TVL abaixo de `US$ 5.000`
  - friccao de entrada ou saida acima de `3%`
  - necessidade de usar wallet do agente atual ou wallet principal

## Checklist Pre-Trade

- confirmar que a wallet e exclusiva do `DOG MM Agent`
- confirmar que o capital e apenas o lote experimental de `US$ 100`
- confirmar que a pool esta aprovada no mandato atual
- confirmar que nao ha leverage nem borrowing envolvidos
- confirmar que o objetivo e aprendizado operacional, nao maximizacao agressiva de retorno

## Primeira Operacao Manual

1. consultar estado da pool alvo
2. registrar preco, liquidez e composicao observada
3. abrir posicao pequena com alvo inicial de ate `US$ 50` em LP, preservando reserva fora da pool
4. registrar hash, hora e parametros
5. observar a posicao por uma janela inicial de `24h` a `72h`
6. fechar ou ajustar a posicao apenas conforme criterio predefinido

## O Que Registrar

Registrar no log operacional do agente:

- pool usada
- assets usados
- capital alocado
- composicao inicial do inventario
- horario de abertura
- horario de fechamento ou ajuste
- friccao percebida
- inventario final
- observacoes sobre necessidade de rebalanceamento

## O Que Ainda Nao Fazer

- nao usar mais de uma pool
- nao aumentar capital no primeiro teste
- nao integrar `Kraken`, `Gate.io` ou `MEXC`
- nao automatizar rebalanceamento
- nao transformar a fase 1 em market making multi-venue

## Criterio de Saida da Fase 1

A fase 1 so termina quando existir:

- wallet dedicada funcionando
- primeira operacao manual concluida
- registro do resultado operacional
- entendimento minimo de inventario, friccao e comportamento da pool
- criterio inicial para rebalanceamento definido
