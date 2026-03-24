# Deribit Risk

## Objetivo

Este documento consolida os guardrails e os riscos operacionais para um agente na `Deribit`.

## Riscos Estruturais Do Produto

O `BTC-PERPETUAL` tem caracteristicas que mudam a modelagem de risco:

- e um produto `inverse`
- ordens e posicoes usam `amount` em `USD`
- margem e PnL sao em `BTC`
- funding afeta desempenho ao longo do tempo
- `mark_price` e `index_price` podem divergir em momentos de estresse

Implicacao:

- o agente nao pode usar a mesma logica de risco de um perp linear em `USDT` ou `USDC`

## Custos

Na estrutura atual de fees para `BTC Futures & Perpetual`:

- maker: `0.00%`
- taker: `0.05%`

Implicacao:

- `market taking` frequente destroi edge com facilidade
- o agente inicial deve ser `maker-first`
- ordens taker devem ficar reservadas para defesa

## Funding

O agente deve monitorar continuamente:

- `index_price`
- `mark_price`
- `funding`
- `open_interest`

Porque isso importa:

- funding pode corroer estrategias lentas
- mark distante do indice pode sinalizar estresse
- open interest ajuda a contextualizar regime de mercado

## Isolamento Operacional

Politica recomendada:

- usar `subaccount` dedicada
- nao operar da conta principal
- segregar saldo, posicoes e limites do agente

Vantagens:

- margem separada
- risco separado
- menos contaminacao operacional

## Guardrails Obrigatorios

O agente deve bloquear execucao quando houver:

- perda de conectividade WebSocket
- falha de sincronizacao de ordens
- falha de leitura de posicao ou margem
- saldo abaixo do minimo operacional
- perda diaria acima do limite
- spread acima do limite da estrategia
- desvio excessivo entre `mark_price` e `index_price`
- risco de liquidacao acima do tolerado
- excesso de erros operacionais
- tentativa de expandir posicao acima do teto

## Controles Obrigatorios

Controles minimos:

- `kill switch` manual
- `cancel_all` em desligamento controlado
- modo `reduce-only` para defesa e flatten
- teto de nocional por ordem
- teto de nocional agregado por direcao
- teto de perda diaria
- teto de numero de ordens abertas
- cooldown apos erro critico

## Limites Da Exchange

No artigo atual de limites padrao para `BTC`:

- maximo de `200` ordens abertas em derivativos
- maximo de `100` ordens abertas por instrumento
- limite maximo de posicao em futures de `50,000,000 USD`

Regra:

- o agente deve operar muito abaixo desses tetos
- limites internos devem ser mais conservadores que os da exchange

## Riscos De Infraestrutura

Riscos relevantes de operacao:

- `10028 too_many_requests`
- uso simultaneo do bot e da web consumindo os mesmos creditos
- varias conexoes na mesma conta dividindo fila por usuario/moeda
- excesso de `edit/cancel` piorando `OTV`
- uso exagerado de `IOC` e `FOK`

Implicacao:

- o agente nao pode ser ruidoso
- repricing precisa ser disciplinado

## Parametros Iniciais Recomendados

Parametros conservadores para o primeiro piloto:

- operar apenas `BTC-PERPETUAL`
- uma unica subconta
- uma unica estrategia por vez
- inventario pequeno
- tamanho por ordem baixo
- `post_only = true` por padrao
- `reduce_only = true` no flatten
- sem martingale
- sem averaging-down automatico
- sem reentrada imediata apos stop

## Checklist Antes De Produzir Ordens

Antes de habilitar execucao, definir:

- capital reservado para a subconta
- perda maxima diaria
- nocional maximo por ordem
- posicao maxima agregada
- criterio de stop operacional
- criterio de desligamento automatico

## Fontes Oficiais

- `https://support.deribit.com/hc/en-us/articles/31424954847133-Inverse-Perpetual`
- `https://support.deribit.com/hc/en-us/articles/25944746248989-Fees`
- `https://support.deribit.com/hc/en-us/articles/25944769401373-Leverage`
- `https://support.deribit.com/hc/en-us/articles/25944616386973-Subaccounts`
- `https://support.deribit.com/hc/en-us/articles/25944766925725-Account-order-and-size-limits-default`
- `https://docs.deribit.com/articles/rate-limits`
- `https://docs.deribit.com/articles/api-usage-policy`
