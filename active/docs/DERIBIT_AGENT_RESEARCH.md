# DERIBIT_AGENT_RESEARCH.md

## Objetivo

Este documento consolida o estudo inicial da `Deribit` para orientar a criacao de um agente que opere na exchange com foco inicial em `BTC-PERPETUAL`.

Escopo desta pesquisa:

- entender o produto `BTC-PERPETUAL`
- identificar os componentes minimos de um agente de trading na Deribit
- registrar guardrails tecnicos e operacionais
- definir uma trilha de implementacao comecando por `testnet`

Observacao:

- este material e uma trilha separada do fluxo principal `AIBTC`
- nao autoriza operacao automatica em producao sem fase previa de simulacao, teste e aprovacao humana

## O Que E A Deribit

A Deribit e uma exchange de derivativos de cripto com foco em:

- `futures`
- `perpetuals`
- `options`

Ela expoe tres interfaces principais de API:

- `JSON-RPC over WebSocket`
- `JSON-RPC over HTTP`
- `FIX`

Para um agente de trading, a propria documentacao da Deribit recomenda `WebSocket` como interface principal para uso geral e tempo real.

## Ambiente Correto Para Comecar

A Deribit separa claramente os ambientes:

- `testnet`
  - HTTP: `https://test.deribit.com/api/v2`
  - WebSocket: `wss://test.deribit.com/ws/api/v2`
- `production`
  - HTTP: `https://www.deribit.com/api/v2`
  - WebSocket: `wss://www.deribit.com/ws/api/v2`

Contas e chaves de API sao separadas entre `testnet` e `production`.

Decisao recomendada:

- o agente deve nascer em `testnet`
- a promocao para `production` deve exigir checklist formal e aprovacao humana

## Produto Inicial: BTC-PERPETUAL

O contrato `BTC-PERPETUAL` na Deribit e um `inverse perpetual`.

Pontos operacionais relevantes:

- simbolo: `BTC-PERPETUAL`
- indice subjacente: `Deribit BTC Index`
- categoria: `Perpetual`
- horario: `24/7`
- moeda de cotacao: `USD`
- moeda de margem: `BTC`
- margem inicial de referencia: `2% + (POS Size in BTC) * 0.005%`
- margem de manutencao de referencia: `1% + (POS Size in BTC) * 0.005%`
- alavancagem maxima teorica para posicao muito pequena: `50x`
- tamanho do contrato: `10 USD`
- tamanho minimo da ordem: `10 USD`
- tick minimo: `0.5 USD`
- settlement diario: `8:00 AM UTC`
- taxa de liquidacao indicada no artigo: `0.75%`

Implicacao importante para o agente:

- em `BTC-PERPETUAL`, `amount` nas ordens e posicoes e expresso em `USD`, nao em quantidade de BTC
- o calculo de risco precisa tratar separadamente:
  - `amount` em USD
  - exposicao equivalente em BTC
  - margem disponivel em BTC

## Funding E Comportamento Do Perpetual

No perpetual da Deribit, o funding e usado para manter o preco do contrato proximo ao indice.

Pontos relevantes:

- o funding e aplicado continuamente e refletido no PnL realizado da sessao
- o mark price usa o indice mais uma `EMA` do desvio entre mercado e indice
- para `BTC-PERPETUAL`, o artigo de especificacao mostra:
  - `funding damper`: minimo `-0.025%` e maximo `0.025%`
  - `funding cap`: minimo `-0.5%` e maximo `0.5%`

Implicacao para o agente:

- nao basta olhar so `best bid` e `best ask`
- o agente deve monitorar tambem:
  - `index_price`
  - `mark_price`
  - `funding`
  - `open_interest`

## Custos E Efeito Na Estrategia

Na pagina de fees atual da Deribit, `BTC Futures & Perpetual` aparece com:

- maker: `0.00%`
- taker: `0.05%`

Implicacao pratica:

- estrategia de `market taking` frequente sofre erosao rapida
- um agente inicial deve ser desenhado como:
  - `maker-first` quando possivel
  - uso de ordens taker apenas para defesa, reducao de risco ou stop

## Modelo De Margem E Isolamento Operacional

A Deribit deixa claro que a alavancagem nao e definida por posicao individual de forma tradicional; o controle vem da combinacao entre tamanho da posicao e margem da conta.

A propria documentacao sugere o uso de `subaccounts` para isolar risco.

Decisao recomendada:

- usar uma `subaccount` dedicada ao agente
- nunca operar a partir da conta principal
- manter uma wallet e uma exposicao segregadas do restante da operacao

Vantagens:

- margem separada
- posicoes separadas
- limites de API separados por subconta
- menor risco operacional

## Chaves De API E Escopos

Os escopos relevantes da Deribit incluem:

- `account:read`
- `account:read_write`
- `trade:read`
- `trade:read_write`
- `wallet:read`
- `wallet:read_write`

Para um agente de trading em `BTC-PERPETUAL`, o minimo util e:

- `trade:read`
- `trade:read_write`
- `account:read`

Escopos a evitar no inicio:

- `wallet:read_write`
- `account:read_write`

Politica recomendada:

- chave separada para `read-only`
- chave separada para `trading`
- `IP whitelist` obrigatoria quando o host for estavel
- sem permissao de saque

Observacao importante:

- a Deribit permite ate `8` API keys por conta ou subconta
- a documentacao de conexao indica limite de `16` sessoes por API key

## Autenticacao

A autenticacao passa por `public/auth`.

Metodos relevantes:

- `client_credentials`
  - mais simples para servidor
- `client_signature`
  - mais seguro, evita transmitir o segredo bruto da mesma forma
- `refresh_token`
  - renova sessao existente

Recomendacao pragmatica:

- `testnet`: `client_credentials`
- fase mais madura ou producao: avaliar `client_signature`

## Dados De Mercado Que O Agente Precisa

Camada minima de leitura:

- metadados do instrumento
  - `public/get_instrument`
  - `public/get_instruments`
- ticker
  - `public/ticker`
- order book
  - `book.BTC-PERPETUAL.{interval}` via subscribe
- trades
  - canal de trades via WebSocket, se a estrategia precisar
- estado de instrumento
  - `instrument.state` para lifecycle

A Deribit recomenda evitar polling excessivo e preferir subscriptions por WebSocket.

## Eventos Privados Que O Agente Precisa

Para operar com confiabilidade, o agente deve consumir eventos privados em tempo real:

- `user.orders.BTC-PERPETUAL.100ms`
- `user.trades.BTC-PERPETUAL.100ms`
- `user.portfolio.BTC`

Isso reduz reconciliacao por polling e melhora:

- confirmacao de fills
- sincronizacao de ordens abertas
- atualizacao de PnL e margem
- deteccao rapida de risco

## Endpoints Minimos Para Um MVP

Leitura:

- `public/auth`
- `public/get_instrument`
- `public/ticker`
- `private/get_position`
- `private/get_open_orders`
- `private/get_account_summary`

Execucao:

- `private/buy`
- `private/sell`
- `private/edit_by_label`
- `private/cancel`
- `private/cancel_all`
- `private/close_position`

Observacao:

- o uso de `label` nas ordens deve ser obrigatorio no agente
- isso simplifica reconciliacao, reprecificacao e cancelamento direcionado

## Rate Limits E Politica De Uso

A Deribit usa um sistema de `credits` e reforca uma politica de uso de API acima dos limites nominais.

Pontos importantes:

- limites existem por subconta
- requests autenticadas sao preferiveis a requests publicas anonimas
- excesso pode gerar erro `10028 too_many_requests` e encerramento da sessao
- a propria interface web consome creditos da API
- `public/subscribe` e `private/subscribe` tem custo proprio
- ha limite de ate `500` canais por subscription

Implicacao para o agente:

- separar conexao de mercado e conexao de trading
- evitar polling de `ticker`, `order_book` e `open_orders` quando subscription resolver
- implementar `backoff`, `retry` e `reconnect` disciplinados
- jamais entrar em loop de erro repetitivo

## Guardrails Obrigatorios

Um agente minimamente serio na Deribit deve bloquear operacao quando qualquer uma destas condicoes ocorrer:

- sem conectividade WebSocket estavel
- sem sincronizacao de estado de ordens
- sem leitura valida de posicao e margem
- numero de erros acima de limite local
- saldo abaixo do minimo operacional definido
- spread acima do maximo permitido pela estrategia
- desvio entre `mark_price` e `index_price` acima do limite
- perda diaria acima do limite
- tamanho de posicao acima do teto
- tentativa de aumentar posicao perto de liquidacao

Controles recomendados:

- `kill switch` manual
- `cancel_all` no desligamento controlado
- modo `reduce-only` para rotinas de defesa
- teto de nocional por ordem
- teto de nocional agregado por direcao
- limite de ordens abertas por instrumento abaixo do maximo da conta

## Limites Operacionais Relevantes

No artigo atual de limites padrao, a Deribit mostra para `BTC`:

- conta `standard margin`
  - maximo de `200` ordens abertas em derivativos
  - maximo de `100` ordens abertas por instrumento
  - limite maximo de posicao em futures de `50,000,000 USD`

Tambem aparecem limites padrao por janela de trigger e por tipo de ordem.

Implicacao:

- o agente deve operar muito abaixo desses tetos
- limites internos do agente devem ser mais conservadores que os da exchange

## Arquitetura Recomendada Do Agente

Arquitetura minima sugerida:

1. `market-data worker`
   - conecta no WebSocket publico/autenticado
   - mantem book, ticker, index, mark e funding em memoria
2. `execution worker`
   - envia ordens
   - faz edit/cancel
   - controla retries e labels
3. `account-state worker`
   - acompanha posicao, margem, equity, open orders e limites
4. `risk engine`
   - aprova ou bloqueia cada acao
   - aplica kill switch e limites
5. `strategy engine`
   - decide quotes, entradas, saidas e reducoes
6. `journal/logger`
   - grava decisoes, fills, erros, funding e mudancas de estado

Decisao importante:

- separar `market data` de `execution` em conexoes diferentes
- essa recomendacao esta alinhada com as boas praticas da propria Deribit

## Estrategia Inicial Recomendada

Para um primeiro agente, o caminho mais prudente nao e um market maker completo nem uma estrategia agressiva.

MVP recomendado:

- `read-only monitor`
  - sem ordens
  - apenas le mercado, posicao, margem e funding
- `paper decision engine`
  - decide o que faria, mas nao envia ordens
- `testnet trader`
  - envia ordens pequenas em `testnet`
  - usa `post_only` por padrao
  - usa `reduce_only` para saidas defensivas
- `production shadow mode`
  - le mercado real e gera sinais/logs sem executar
- `production guarded mode`
  - execucao real com limite de nocional muito baixo

## Parametros Iniciais Recomendados

Valores de partida conservadores para o primeiro piloto:

- operar apenas `BTC-PERPETUAL`
- uma unica subconta dedicada
- uma unica estrategia por vez
- uma unica direcao de inventario maxima pequena
- tamanho maximo por ordem muito abaixo do minimo economico de risco relevante
- `post_only = true` por padrao
- `reject_post_only = true` quando a estrategia exigir certeza de nao cruzar
- `reduce_only = true` em rotinas de flatten
- sem martingale
- sem averaging-down automatico
- sem reentrada imediata apos stop

Os numeros exatos de risco devem ser definidos a partir do capital real reservado para a subconta.

## Riscos Especificos Da Deribit Para O Agente

- produto inverse: PnL e margem nao se comportam como linear USDC
- funding pode distorcer desempenho de estrategias lentas
- uso simultaneo da web e do bot consome os mesmos creditos de API
- varias conexoes na mesma conta compartilham fila por usuario/moeda para acoes de matching engine
- excesso de `edit/cancel` pode piorar `OTV`
- ordens `IOC` e `FOK` canceladas contam pior na metrica operacional da exchange

Conclusao pratica:

- um agente ruidoso, com excesso de repricing e cancelamento, pode degradar tanto performance quanto conformidade operacional

## Roadmap Recomendado

Fase 1:

- criar subconta dedicada
- criar API key read-only
- implementar cliente WebSocket + auth + subscriptions
- implementar snapshot local de book, ticker e posicao

Fase 2:

- adicionar `private/get_account_summary`
- adicionar reconciliacao de ordens e trades
- persistir logs e eventos
- criar dashboard/CLI de risco

Fase 3:

- adicionar ordens em `testnet`
- suporte a `buy`, `sell`, `edit`, `cancel`, `close_position`
- labels padronizadas
- kill switch

Fase 4:

- paper trading em dados reais
- validar estrategia, latencia, erros e guardrails

Fase 5:

- producao com capital minimo e aprovacao humana

## Requisitos Minimos Antes De Codar

- definir se o agente sera:
  - `market maker`
  - `trend follower`
  - `mean reversion`
  - `hedger`
- definir limite de capital por subconta
- definir perda maxima diaria
- definir posicao maxima e nocional maximo por ordem
- definir se havera apenas `BTC-PERPETUAL` ou tambem outros instrumentos
- definir se a primeira entrega sera monitoramento ou execucao

## Decisao Recomendada Para Este Repositorio

Como este repositorio hoje e orientado ao fluxo `Codex + AIBTC MCP`, a integracao com Deribit deve entrar como trilha separada e modular.

Recomendacao de escopo:

- primeiro entregar uma pasta dedicada a `Deribit`
- com cliente de API, runtime, config e docs proprios
- sem misturar com o fluxo operacional principal do `Speedy Indra`

## Fontes Oficiais Consultadas Em 2026-03-17

- Deribit API overview: `https://docs.deribit.com/`
- Authentication: `https://docs.deribit.com/articles/authentication`
- public/auth: `https://docs.deribit.com/api-reference/authentication/public-auth`
- Access scopes: `https://docs.deribit.com/articles/access-scope`
- Rate limits: `https://docs.deribit.com/articles/rate-limits`
- API usage policy: `https://docs.deribit.com/articles/api-usage-policy`
- Notifications: `https://docs.deribit.com/articles/notifications`
- Market data collection: `https://docs.deribit.com/articles/market-data-collection-best-practices`
- Order management: `https://docs.deribit.com/articles/order-management-best-practices`
- Creating API key: `https://docs.deribit.com/articles/creating-api-key`
- BTC inverse perpetual specs: `https://support.deribit.com/hc/en-us/articles/31424954847133-Inverse-Perpetual`
- Fees: `https://support.deribit.com/hc/en-us/articles/25944746248989-Fees`
- Leverage: `https://support.deribit.com/hc/en-us/articles/25944769401373-Leverage`
- Subaccounts: `https://support.deribit.com/hc/en-us/articles/25944616386973-Subaccounts`
- Account limits: `https://support.deribit.com/hc/en-us/articles/25944766925725-Account-order-and-size-limits-default`
