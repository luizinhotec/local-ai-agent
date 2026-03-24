# Deribit

## Objetivo

Este `README` e o ponto de entrada da trilha separada de estudo e futura implementacao de um agente para a `Deribit`, com foco inicial em `BTC-PERPETUAL`.

Escopo:

- entender o produto `BTC-PERPETUAL`
- identificar os componentes minimos de um agente de trading na Deribit
- registrar guardrails tecnicos e operacionais
- definir uma trilha de implementacao comecando por `testnet`

Observacao:

- esta trilha e separada do fluxo principal `AIBTC`
- nao autoriza operacao automatica em producao sem simulacao, testes e aprovacao humana

## Estrutura Desta Trilha

- [API.md](/c:/dev/local-ai-agent/active/docs/deribit/API.md): autenticacao, canais, endpoints e arquitetura tecnica minima
- [RISK.md](/c:/dev/local-ai-agent/active/docs/deribit/RISK.md): guardrails, limites, custos e politica operacional
- [ROADMAP.md](/c:/dev/local-ai-agent/active/docs/deribit/ROADMAP.md): sequencia recomendada de implementacao
- [OBJECTIVE.md](/c:/dev/local-ai-agent/active/docs/deribit/OBJECTIVE.md): funcao-objetivo do agente em sats
- [AUTONOMY_POLICY.md](/c:/dev/local-ai-agent/active/docs/deribit/AUTONOMY_POLICY.md): regras da autonomia antes da execucao
- [DERIBIT_AGENT_RESEARCH.md](/c:/dev/local-ai-agent/active/docs/DERIBIT_AGENT_RESEARCH.md): pesquisa consolidada original

## Resumo Executivo

A Deribit e uma exchange de derivativos de cripto com foco em:

- `futures`
- `perpetuals`
- `options`

Para um agente de trading:

- `WebSocket` deve ser o canal principal
- a implementacao deve comecar em `testnet`
- o primeiro instrumento recomendado e `BTC-PERPETUAL`
- o agente deve operar em `subaccount` dedicada
- a trilha inicial deve ser `read-only` antes de qualquer execucao

## Produto Inicial

O `BTC-PERPETUAL` da Deribit e um `inverse perpetual`.

Pontos principais:

- `amount` e expresso em `USD`
- margem e PnL sao em `BTC`
- tick minimo: `0.5 USD`
- ordem minima: `10 USD`
- fees atuais para `BTC Futures & Perpetual`:
  - maker: `0.00%`
  - taker: `0.05%`

Implicacao:

- o agente inicial deve ser `maker-first`
- ordens taker devem ficar restritas a defesa e reducao de risco

## Guardrails Minimos

Antes de produzir ordens, o agente precisa de:

- `kill switch`
- `cancel_all` em desligamento controlado
- bloqueio por perda diaria
- bloqueio por saldo minimo
- bloqueio por risco de liquidacao
- teto de nocional por ordem
- teto de posicao agregada
- sincronizacao confiavel de ordens, posicao e margem

## Ordem Recomendada

1. estudar [API.md](/c:/dev/local-ai-agent/active/docs/deribit/API.md)
2. fechar os limites em [RISK.md](/c:/dev/local-ai-agent/active/docs/deribit/RISK.md)
3. seguir as fases em [ROADMAP.md](/c:/dev/local-ai-agent/active/docs/deribit/ROADMAP.md)

## Decisao Para Este Repositorio

A trilha Deribit deve ficar modular e separada do fluxo principal `Codex + AIBTC MCP`.

Escopo recomendado:

- pasta propria para `Deribit`
- cliente de API proprio
- runtime proprio
- configuracao propria
- docs proprias
