# DOG_MM_CODEX.md

## Objetivo

Este arquivo e a porta de entrada da trilha separada do `DOG MM Agent`.

Ele nao faz parte do fluxo principal do `Speedy Indra`.

## Estado da Trilha

Estado consolidado em `2026-03-15` local / `2026-03-16 UTC`:

- agente separado do `Speedy Indra`
- ainda nao implantado
- fase atual: `blueprint/preparacao`
- foco: market making de `DOG GO TO THE MOON`
- venue inicial aprovado: `Bitflow`
- pool inicial aprovada: `sBTC-DOG`
- asset base aprovado: `sBTC`
- capital inicial aprovado para fase 1: `US$ 100`
- fase 1 manual, observacional e restrita a uma unica pool
- sem leverage
- sem borrowing
- sem uso da wallet do agente atual
- sem uso da wallet principal

## Nome da Janela Desta Trilha

Quando esta trilha for discutida em conversa propria, o contexto deve ser nomeado como:

- `DOG MM Agent`

Regra:

- esta janela nao deve misturar assuntos do `Speedy Indra`
- qualquer retorno ao agente principal deve acontecer em outra janela nomeada

## Decisao Importante

Validacao feita com dados atuais do `Bitflow`:

- nao ha pool `DOG` em `DLMM/HODLMM`
- por isso a fase 1 precisa usar `sBTC-DOG` no `Bitflow` principal
- a trilha de liquidez concentrada para `DOG` fica como fase futura

Premissa operacional adicional informada pelo operador em `2026-03-15`:

- existe expectativa de lancamento da pool `DOG` no `HODLMM` nos proximos `15` dias
- essa expectativa ainda nao foi confirmada aqui por fonte publica primaria da `Bitflow`
- a preparacao atual deve preservar capacidade de migrar rapidamente de `XYK` para `HODLMM` quando o lancamento ocorrer

## Ordem de Leitura

1. [DOG_MM_ROADMAP.md](/c:/dev/local-ai-agent/DOG_MM_ROADMAP.md)
2. [AIBTC_DOG_MM_AGENT_BLUEPRINT.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_AGENT_BLUEPRINT.md)
3. [AIBTC_DOG_MM_AGENT_IDENTITY.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_AGENT_IDENTITY.md)
4. [AIBTC_DOG_MM_AGENT_OPERATIONS.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_AGENT_OPERATIONS.md)
5. [AIBTC_DOG_MM_HODLMM_MONITOR_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_HODLMM_MONITOR_RUNBOOK.md)
6. [AIBTC_DOG_MM_LOCAL_STATE_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_LOCAL_STATE_RUNBOOK.md)
7. [AIBTC_DOG_MM_WALLET_EXECUTION_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_WALLET_EXECUTION_RUNBOOK.md)
8. [AIBTC_DOG_MM_PUBLIC_PROFILE_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PUBLIC_PROFILE_RUNBOOK.md)
9. [AIBTC_DOG_MM_WALLET_HANDOFF_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_WALLET_HANDOFF_RUNBOOK.md)
10. [AIBTC_DOG_MM_PREPARATION_TRANSITION_CHECKLIST.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PREPARATION_TRANSITION_CHECKLIST.md)
11. [AIBTC_DOG_MM_READINESS_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_READINESS_RUNBOOK.md)
12. [AIBTC_DOG_MM_OPS_BUNDLE_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_OPS_BUNDLE_RUNBOOK.md)
13. [AIBTC_DOG_MM_LAUNCH_GATES_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_LAUNCH_GATES_RUNBOOK.md)
14. [AIBTC_DOG_MM_CONTROL_CENTER_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_CONTROL_CENTER_RUNBOOK.md)
15. [AIBTC_DOG_MM_DAILY_OPERATIONS_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_DAILY_OPERATIONS_RUNBOOK.md)
16. [AIBTC_DOG_MM_INPUT_VALIDATION_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_INPUT_VALIDATION_RUNBOOK.md)
17. [AIBTC_DOG_MM_FUNDING_PLAN_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_FUNDING_PLAN_RUNBOOK.md)
18. [AIBTC_DOG_MM_GO_LIVE_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_GO_LIVE_RUNBOOK.md)
19. [AIBTC_DOG_MM_SESSION_START_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_SESSION_START_RUNBOOK.md)
20. [AIBTC_DOG_MM_SESSION_CLOSE_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_SESSION_CLOSE_RUNBOOK.md)
21. [AIBTC_DOG_MM_READY_TO_TRADE_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_READY_TO_TRADE_RUNBOOK.md)
22. [AIBTC_DOG_MM_BITFLOW_EXECUTOR_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_BITFLOW_EXECUTOR_RUNBOOK.md)
23. [AIBTC_DOG_MM_OPERATOR_COMMANDS.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_OPERATOR_COMMANDS.md)
24. [AIBTC_DOG_MM_PHASE0_SHADOW_TRAINING.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE0_SHADOW_TRAINING.md)
25. [AIBTC_DOG_MM_PHASE0_EXECUTION_DECISION.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE0_EXECUTION_DECISION.md)
26. [AIBTC_DOG_MM_PHASE0_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE0_RUNBOOK.md)
27. [AIBTC_DOG_MM_PHASE0_LAUNCH_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE0_LAUNCH_RUNBOOK.md)
28. [AIBTC_DOG_MM_PHASE1_PACKAGE.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_PACKAGE.md)
29. [AIBTC_DOG_MM_PHASE1_LAUNCH_RUNBOOK.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_LAUNCH_RUNBOOK.md)

## Pacote Operacional

O pacote completo da fase 1 esta centralizado em:

- [AIBTC_DOG_MM_PHASE1_PACKAGE.md](/c:/dev/local-ai-agent/active/docs/dog-mm/AIBTC_DOG_MM_PHASE1_PACKAGE.md)

## Fronteira de Separacao

Esta trilha nao deve:

- reutilizar a wallet do `Speedy Indra`
- reutilizar a wallet principal
- alterar o baseline operacional do agente principal
- misturar heartbeat, registro, yield ou rotinas do fluxo principal

## Proximo Gate Operacional

Antes de qualquer funding:

- criar a wallet segregada
- registrar e validar os enderecos publicos
- exportar o preview do profile
- rodar o readiness e confirmar que o proximo passo e `fund_wallet`
