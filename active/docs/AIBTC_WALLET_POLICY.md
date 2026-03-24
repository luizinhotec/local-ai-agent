# AIBTC_WALLET_POLICY.md

## Objetivo

Este documento define a politica operacional da wallet principal do `Speedy Indra`.

Ele existe para transformar criterio verbal em regra reutilizavel no workspace.

Ele nao autoriza automacao irrestrita.

Ele define:

- objetivo da estrategia
- limites de risco
- gatilhos de revisao
- criterios minimos para trocar de posicao
- escopo de autonomia financeira permitida

## Escopo

Wallet monitorada:

- `SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT`

Rede:

- `mainnet`

Ativos foco:

- `sBTC`
- `STX`

Protocolos permitidos no baseline atual:

- `Zest`
- `StackingDAO`
- `Hermetica`
- alternativas AIBTC previamente revisadas no chat antes da execucao

## Objetivo Principal

Maximizar retorno ajustado por risco em BTC-equivalente, preservando capital e evitando churn operacional.

Na pratica:

- preservar fundos vale mais do que buscar upside marginal
- fees e friccao importam
- uma estrategia so deve mudar quando o ganho esperado superar custo e risco

## Prioridades

1. preservar capital
2. manter liquidez minima operacional
3. evitar fees desnecessarias
4. manter exposicao simples e auditavel
5. revisar oportunidades com disciplina diaria

## Guardrails

- sem alavancagem
- sem LP no baseline atual
- sem borrowing aberto
- sem protocolo novo sem revisao previa
- sem mover 100 por cento dos fundos para uma estrategia unica
- sem execucao fora dos protocolos e limites explicitamente autorizados

## Reservas Minimas

Reserva minima operacional da wallet:

- `5000 sats` livres de `sBTC`
- `5 STX` livres para gas

Esses pisos existem para:

- evitar travamento operacional
- reduzir necessidade de resgate imediato
- manter flexibilidade para fees e testes pequenos

## Frequencia de Revisao

Cadencia padrao:

- `1 vez por dia`

Revisao extraordinaria:

- mudanca relevante de APY
- queda de yield efetivo
- aumento de risco
- alteracao material de saldo
- nova oportunidade claramente superior

## Regra de Permanencia

Uma posicao pode ser mantida quando:

- o retorno esperado for coerente com o risco
- a friccao para sair nao compensar
- houver valor adicional em pontos ou relacionamento com protocolo

Uma posicao deve ser reavaliada quando:

- o yield efetivo cair para perto de zero
- fees consumirem a maior parte do retorno esperado
- a posicao deixar de servir ao objetivo principal

## Regra de Troca

So trocar de estrategia quando:

- o ganho esperado superar o custo total da mudanca
- o ganho esperado for maior que `2x` o custo estimado de fees
- a nova estrategia nao aumente risco fora do baseline permitido
- a troca respeitar as reservas minimas de `sBTC` e `STX`
- a troca permanecer dentro dos protocolos autorizados nesta politica

Nao trocar por:

- variacao pequena de taxa
- ruido de curto prazo
- incentivo pouco claro

## Modo Operacional Atual

- modo atual:

- semiautomatico com troca autorizada

- isso autoriza execucao sem confirmacao humana previa apenas quando:

- a mudanca ficar dentro dos guardrails deste documento
- nao houver leverage
- nao houver LP
- nao houver borrowing
- o protocolo de destino estiver na lista permitida
- o ganho esperado superar `2x` as fees estimadas
- as reservas minimas permanecerem intactas

- modo ainda proibido:

- automatico total

## Escopo da Autorizacao

Autorizacao concedida no baseline atual:

- sair de uma estrategia conservadora para outra estrategia conservadora dentro dos protocolos permitidos
- reduzir exposicao quando o retorno ajustado por risco piorar materialmente
- sacar parcial ou totalmente de uma posicao que deixe de compensar economicamente
- usar `Hermetica` apenas para estrategia conservadora BTC-denominada, sem leverage e sem composicao com LP

Autorizacao nao concedida:

- entrar em leverage
- abrir borrowing
- fornecer LP
- usar protocolo novo fora da lista permitida sem revisao previa
- comprometer a reserva minima operacional

## Metricas Minimas por Revisao

Toda revisao deve considerar:

- saldo livre de `sBTC`
- saldo livre de `STX`
- valor estimado em protocolo
- `suppliedShares`
- `borrowed`
- `healthFactor`
- fees para sair
- fees para entrar em nova estrategia
- PnL bruto estimado
- PnL liquido estimado

## Interpretacao Atual do Baseline

Baseline atual:

- `5000 sats` de `sBTC` liquidos preservados na wallet como reserva operacional
- `102511 sats` alocados em `Hermetica`
- `101949 hBTC` recebidos no `deposit` inicial
- sem borrowing
- sem leverage
- com reserva liquida local separada
- pronto para comparacao entre `Hermetica`, `Zest` e `StackingDAO` dentro da politica

Tx de entrada atual:

- `9fd152c65774b0e83f5359a4488814a0928ffe192943d6bd0df6d6b1b95e83ae`

Isso nao significa manter para sempre.

Significa apenas:

- usar como ponto de referencia
- comparar novas alternativas contra esse baseline
- sair quando retorno ajustado por custo deixar de fazer sentido

## Regra Final

Quando houver duvida entre duas estrategias parecidas:

- escolher a mais simples
- escolher a mais liquida
- escolher a de menor risco operacional
- executar a troca apenas se ela continuar claramente dentro desta politica
