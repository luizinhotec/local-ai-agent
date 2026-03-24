# DOG_MM_ROADMAP.md

## Objetivo

Este roadmap cobre apenas a trilha separada do `DOG MM Agent`.

Ele nao cobre o fluxo principal do `Speedy Indra`.

## Estado Atual

Estado consolidado em `2026-03-15` local / `2026-03-16 UTC`:

- agente separado definido
- ainda nao implantado
- fase atual: `blueprint/preparacao`
- venue inicial aprovado: `Bitflow`
- pool inicial aprovada: `sBTC-DOG`
- asset base aprovado: `sBTC`
- capital inicial aprovado: `US$ 100`
- `DOG` ainda sem pool ativa em `DLMM/HODLMM`
- expectativa operacional informada: lancamento de pool `DOG` em `HODLMM` dentro dos proximos `15` dias

## Fases

### 1. Estrutura e Separacao

Status:

- `concluido`

Ja existe:

- identidade separada
- indice proprio em `DOG_MM_CODEX.md`
- docs e templates movidos para pastas proprias
- guardrails documentados

### 2. Wallet e Funding

Status:

- `em preparacao`

Falta:

- criar wallet nova e exclusiva
- validar enderecos publicos
- preparar funding experimental separado
- testar lock e unlock operacional
- deixar a trilha pronta para pivot rapido caso a pool `DOG` no `HODLMM` seja lancada

### 3. Fase 0 de Shadow Training em HODLMM

Status:

- `decidido e pronto para execucao`

Escopo:

- treinar logica de MM em pools ja existentes
- priorizar `sBTC-USDCx`
- validar range, recentragem e disciplina
- preservar capital principal destinado a `DOG`

### 4. Fase 1 Manual em Bitflow

Status:

- `planejado`

Escopo:

- operar apenas `sBTC-DOG`
- abrir uma posicao pequena
- observar inventario
- registrar friccao
- fechar ou ajustar manualmente

Observacao:

- se a pool `DOG` no `HODLMM` for lancada antes da primeira abertura manual em `XYK`, reavaliar o venue inicial antes de executar

### 5. Regras de Rebalanceamento

Status:

- `futuro`

Escopo:

- definir gatilhos objetivos
- rebalancear entre `sBTC` e `DOG`
- manter mandato restrito aos mesmos assets

### 6. Liquidez Concentrada e Cross-Venue

Status:

- `futuro proximo para HODLMM`

Dependencias:

- existir pool `DOG` em `DLMM/HODLMM` ou venue equivalente aprovado
- runbook especifico para integracao com `Kraken`, `Gate.io` e `MEXC`
- nova aprovacao de governanca

## Prioridades Atuais

1. criar wallet segregada do `DOG MM Agent`
2. validar funding inicial experimental
3. executar ao menos um ciclo de shadow training em `sBTC-USDCx`
4. registrar a heuristica validada ou rejeitada
5. preparar pre-trade final da pool `sBTC-DOG`
6. monitorar abertura da pool `DOG` em `HODLMM` durante a janela dos proximos `15` dias
7. executar primeira operacao manual pequena no melhor venue aprovado disponivel
8. registrar resultado, inventario e friccao

## Condicao de Saida da Preparacao

A trilha sai de `blueprint/preparacao` quando existir:

- wallet nova pronta
- funding inicial separado
- checklist pre-trade concluido
- primeira abertura manual pronta para execucao
