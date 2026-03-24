# Deribit API

## Objetivo

Este documento descreve a base tecnica de API para um agente operar na `Deribit`, com foco inicial em `BTC-PERPETUAL`.

## Interfaces

A Deribit expoe:

- `JSON-RPC over WebSocket`
- `JSON-RPC over HTTP`
- `FIX`

Para um agente de trading, `WebSocket` deve ser o canal principal. `HTTP` pode ficar como apoio para bootstrap, debug e consultas pontuais.

## Ambientes

- `testnet`
  - HTTP: `https://test.deribit.com/api/v2`
  - WebSocket: `wss://test.deribit.com/ws/api/v2`
- `production`
  - HTTP: `https://www.deribit.com/api/v2`
  - WebSocket: `wss://www.deribit.com/ws/api/v2`

Regra:

- `testnet` e `production` usam contas e API keys separadas

## Autenticacao

A autenticacao usa `public/auth`.

Metodos principais:

- `client_credentials`
- `client_signature`
- `refresh_token`

Recomendacao:

- `testnet`: usar `client_credentials`
- `production`: avaliar `client_signature` quando a trilha estiver madura

## API Keys E Escopos

Escopos relevantes:

- `account:read`
- `account:read_write`
- `trade:read`
- `trade:read_write`
- `wallet:read`
- `wallet:read_write`

Minimo recomendado para um agente de trading:

- `trade:read`
- `trade:read_write`
- `account:read`

Politica recomendada:

- uma key `read-only`
- uma key de `trading`
- `IP whitelist` quando o host for estavel
- nunca habilitar saque

Observacoes operacionais:

- a Deribit permite ate `8` API keys por conta ou subconta
- a documentacao indica limite de ate `16` sessoes por API key

## Produto Inicial: BTC-PERPETUAL

O `BTC-PERPETUAL` e um `inverse perpetual`.

Parametros operacionais importantes:

- simbolo: `BTC-PERPETUAL`
- cotacao: `USD`
- margem: `BTC`
- tamanho do contrato: `10 USD`
- ordem minima: `10 USD`
- tick minimo: `0.5 USD`
- settlement diario: `8:00 AM UTC`

Implicacao:

- `amount` nas ordens e posicoes e em `USD`
- margem e risco real precisam ser tratados em `BTC`

## Dados Publicos Minimos

Metodos e canais mais importantes para o MVP:

- `public/get_instrument`
- `public/get_instruments`
- `public/ticker`
- canal de `book`
- canal de trades, se a estrategia usar agressao ou tape
- `instrument.state`

Regra pratica:

- evitar polling excessivo
- preferir subscription por WebSocket

## Eventos Privados Minimos

O agente deve assinar pelo menos:

- `user.orders.BTC-PERPETUAL.100ms`
- `user.trades.BTC-PERPETUAL.100ms`
- `user.portfolio.BTC`

Esses canais suportam:

- confirmacao de fills
- sincronizacao de ordens abertas
- atualizacao de PnL e margem
- defesa de risco em tempo real

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

Regra obrigatoria:

- toda ordem deve usar `label`

## Rate Limits

A Deribit usa um sistema de `credits`.

Pontos praticos:

- limites existem por subconta
- requests autenticadas sao preferiveis a publicas anonimas
- excesso pode gerar `10028 too_many_requests`
- a propria web consome os mesmos creditos
- `subscribe` tambem tem custo
- existe limite de ate `500` canais por subscription

Consequencias para a implementacao:

- separar conexao de mercado e conexao de execucao
- usar subscriptions em vez de polling continuo
- implementar `backoff`, `retry` e `reconnect`
- nunca entrar em loop de erro

## Arquitetura Tecnica Minima

Componentes recomendados:

1. `market-data worker`
2. `execution worker`
3. `account-state worker`
4. `risk engine`
5. `strategy engine`
6. `journal/logger`

Decisao importante:

- `market data` e `execution` devem ficar em conexoes diferentes

## Fontes Oficiais

- `https://docs.deribit.com/`
- `https://docs.deribit.com/articles/authentication`
- `https://docs.deribit.com/api-reference/authentication/public-auth`
- `https://docs.deribit.com/articles/access-scope`
- `https://docs.deribit.com/articles/rate-limits`
- `https://docs.deribit.com/articles/api-usage-policy`
- `https://docs.deribit.com/articles/notifications`
- `https://docs.deribit.com/articles/market-data-collection-best-practices`
- `https://docs.deribit.com/articles/order-management-best-practices`
- `https://docs.deribit.com/articles/creating-api-key`
- `https://support.deribit.com/hc/en-us/articles/31424954847133-Inverse-Perpetual`
