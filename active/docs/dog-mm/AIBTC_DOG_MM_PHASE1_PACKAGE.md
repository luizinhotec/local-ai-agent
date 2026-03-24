# AIBTC_DOG_MM_PHASE1_PACKAGE.md

## Objetivo

Servir como indice unico da fase 1 do `DOG MM Agent`.

Este pacote existe para manter a trilha de `DOG` separada do fluxo principal do `Speedy Indra`.

## Escopo da Fase 1

- agente separado
- wallet separada
- capital segregado
- operacao manual
- uma unica pool
- sem leverage
- sem borrowing
- sem CEX

## Decisao Operacional Vigente

- pool inicial: `sBTC-DOG`
- venue: `Bitflow`
- tipo de pool atual: `XYK`
- asset base: `sBTC`
- capital total: `US$ 100`

Janela de reavaliacao:

- existe expectativa operacional de pool `DOG` em `HODLMM` nos proximos `15` dias
- se isso ocorrer antes da primeira operacao manual, reavaliar a venue inicial antes da execucao

## Ordem de Uso dos Documentos

1. [AIBTC_DOG_MM_AGENT_BLUEPRINT.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_AGENT_BLUEPRINT.md)
2. [AIBTC_DOG_MM_PHASE1_DECISION.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_DECISION.md)
3. [AIBTC_DOG_MM_PHASE0_SHADOW_TRAINING.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE0_SHADOW_TRAINING.md)
4. [AIBTC_DOG_MM_WALLET_AND_FUNDING_CHECKLIST.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_WALLET_AND_FUNDING_CHECKLIST.md)
5. [AIBTC_DOG_MM_WALLET_SETUP_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_WALLET_SETUP_RUNBOOK.md)
6. [AIBTC_DOG_MM_PHASE1_PRETRADE_CHECKLIST.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_PRETRADE_CHECKLIST.md)
7. [AIBTC_DOG_MM_PHASE1_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_RUNBOOK.md)
8. [dog-mm-phase1-log-entry.template.md](/c:/dev/local-ai-agent/active/templates/aibtc/dog-mm/dog-mm-phase1-log-entry.template.md)

## Resultado Esperado

Ao final deste pacote deve existir:

- wallet nova e exclusiva do `DOG MM Agent`
- funding inicial separado e pequeno
- decisao fechada de pool e asset base
- checklist pre-trade pronto
- log operacional padronizado para a primeira abertura manual
