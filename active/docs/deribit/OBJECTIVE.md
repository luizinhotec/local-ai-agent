# Deribit Objective

## Objetivo

Este documento define a funcao-objetivo do agente autonomo da `Deribit`.

Diretriz central:

- o agente existe para `acumular sats`

## O Que Isso Significa

A metrica principal do agente nao deve ser:

- PnL em `USD`
- taxa de acerto isolada
- quantidade de trades

A metrica principal deve ser:

- crescimento sustentavel de `BTC equity`

Metricas secundarias:

- drawdown em `BTC`
- volatilidade da equity em `BTC`
- eficiencia por trade apos fees e funding
- preservacao de capital em regimes ruins

## Consequencias Para O Design

Se o objetivo e acumular sats, entao:

- risco deve ser medido em `BTC`
- sucesso deve ser medido em `BTC`
- comparacoes entre estrategias devem usar impacto liquido em `BTC`

Isso importa especialmente porque `BTC-PERPETUAL` e um produto `inverse`.

## Regras De Decisao Derivadas

O agente deve evitar:

- trades com edge pequeno demais para compensar ruido
- aumento de exposicao em mercado desorganizado
- operacao quando spread e funding pioram a expectativa em sats
- reentrada impulsiva apos perda
- expandir posicao quando a leitura de risco estiver incompleta

O agente deve priorizar:

- operacao `maker-first`
- baixo churn
- preservacao de BTC em fases ruins
- aumento gradual de agressividade apenas quando o risco estiver sob controle

## Hierarquia De Objetivos

1. proteger o stack atual de sats
2. evitar perda estrutural de BTC
3. buscar crescimento incremental de `BTC equity`
4. expandir apenas quando a qualidade do ambiente justificar

## Implicacao Para A Autonomia

Autonomia nao significa liberdade irrestrita.

Autonomia aceitavel significa:

- o agente decide sozinho dentro de limites predefinidos
- o agente bloqueia a si mesmo fora desses limites
- o agente reduz risco quando o ambiente piora
- o agente aceita ficar sem operar quando nao houver edge claro

## Criterio De Qualidade

Uma estrategia boa para este agente nao e a que mais movimenta.

E a que:

- aumenta `BTC equity`
- sobrevive a maus regimes
- nao depende de alavancagem irresponsavel
- mantem risco compreensivel e audivel
