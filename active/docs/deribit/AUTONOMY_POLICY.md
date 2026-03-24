# Deribit Autonomy Policy

## Objetivo

Este documento define como a autonomia do agente deve funcionar na trilha `Deribit`.

## Principio

O agente pode tomar decisoes sozinho, mas apenas dentro de um envelope de risco fixado antes da execucao.

## Regras Minimas

O agente so pode aumentar exposicao quando:

- snapshot estiver fresco
- spread estiver aceitavel
- `mark_price` e `index_price` nao estiverem excessivamente distantes
- funding nao estiver fora do limite
- saldo disponivel estiver acima do minimo
- posicao atual estiver dentro do teto
- nao houver sinal de degradacao operacional

O agente deve apenas reduzir risco quando:

- algum check estiver em `block`
- houver degradacao de liquidez
- o risco de liquidacao encurtar
- houver falha de sincronizacao

O agente deve ficar em `hold` quando:

- o estado estiver incompleto
- o risco estiver em `warn` sem edge claro
- a estrategia nao tiver confianca suficiente

## Postura Inicial

Na primeira fase autonoma:

- `hold` e a decisao padrao
- `buy` e `sell` devem ser excecoes
- `reduce` deve ter prioridade sobre `expand`

## Politica De Escalada

Sequencia recomendada:

1. `observe`
2. `decide`
3. `paper trade`
4. `testnet execution`
5. `guarded production`

## Politica De Falha

Se o agente perder contexto suficiente para confiar na propria decisao, ele deve:

1. parar de expandir exposicao
2. cancelar novas entradas
3. permitir apenas defesa ou flatten
4. registrar o motivo
