# AIBTC_DOG_MM_PREPARATION_TRANSITION_CHECKLIST.md

## Objetivo

Fechar a transicao de `blueprint/preparacao` para operacao controlada do `DOG MM Agent`.

## Etapa 1. Wallet

- wallet criada
- wallet validada
- enderecos publicos registrados no estado local
- preview do profile exportado
- readiness reavaliada apos a validacao

## Etapa 2. Funding

- funding experimental separado
- wallet marcada como fundeada no estado local
- reserva principal para `DOG` preservada
- readiness local reavaliada apos o funding
- funding nao marcado antes da validacao da wallet

## Etapa 3. Fase 0

- pool de treino principal confirmada como `sBTC-USDCx` `bin_step = 1`
- heuristica inicial registrada
- ciclo inicial pronto para execucao

## Etapa 4. Fase 1

- monitor de `HODLMM` rodando ou verificado recentemente
- pool `sBTC-DOG` continua valida em `XYK`
- criterio de reavaliacao para `DOG` em `HODLMM` documentado

## Condicao de Pronto

O `DOG MM Agent` esta pronto para sair da preparacao quando:

- wallet validada = `true`
- wallet fundeada = `true`
- fase `0` pronta
- fase `1` pronta
- sem dependencia de wallet principal ou do `Speedy Indra`
