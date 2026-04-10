# Deribit Bot — Contexto para Nova Sessão

## Objetivo desta sessão
Aperfeiçoar o deribit-bot: atualmente em produção, observando mercado, 0 trades executados.
Equity ~$19, instrumento BTC-PERPETUAL, mainnet ativa.

## Arquitetura geral

workspace/deribit/
├── config/           ← configs de risco, estratégia, execução, bot, env
├── runtime/
│   ├── *.cjs         ← 29 scripts de operação, diagnóstico e teste
│   └── lib/          ← 11 módulos core
└── state/            ← arquivos de estado runtime (JSON/JSONL)

## Módulos core (runtime/lib/)
- deribit-bot.cjs              → orquestração, createCyclePlan
- deribit-client.cjs           → WebSocket com a exchange
- deribit-private-snapshot.cjs → posição, equity, ordens
- deribit-reconcile.cjs        → sincronização local ↔ exchange
- deribit-risk.cjs             → evaluateRisk
- deribit-strategy.cjs         → decideAction
- deribit-execution.cjs        → sendOrder
- deribit-execution-audit.cjs  → audit trail
- deribit-state-store.cjs      → leitura/escrita de estado
- deribit-calibration.cjs      → auto-calibração
- deribit-process-lock.cjs     → processo único

## Fluxo de um ciclo
1. acquireProcessLock
2. reconcileWithExchange
3. createCyclePlan → decision + orderIntent
4. getStaleOrders → cancelOrders se necessário
5. verifica blockers → sai se bloqueado
6. dry-run (sem --execute) → loga intenção
7. execução real (--execute) → sendOrder
8. persiste estado → metrics, botState, events, audit
9. maybeAutoCalibrate → recalibra se posição flat

Flags: --once (1 ciclo), --execute (real)

## Comandos úteis
node workspace/deribit/runtime/deribit-bot-summary.cjs
node workspace/deribit/runtime/deribit-decision-preview.cjs
node workspace/deribit/runtime/deribit-status.cjs
node workspace/deribit/runtime/deribit-risk-summary.cjs
node workspace/deribit/runtime/deribit-economic-viability-report.cjs
node workspace/deribit/runtime/deribit-edge-decomposition-report.cjs
node workspace/deribit/runtime/deribit-bot-loop.cjs --once
node workspace/deribit/runtime/deribit-bot-loop.cjs --once --execute
node workspace/deribit/runtime/deribit-cancel-open-orders.cjs
node workspace/deribit/runtime/deribit-flatten-position.cjs

## Estado atual
- Produção ativa: mainnet, BTC-PERPETUAL
- Equity: ~$19
- Trades executados: 0 (observando, sem execução)
- Processo: systemd (sudo systemctl restart local-ai-agent)
- Logs: tail -f workspace/deribit/state/deribit-bot-loop.log

## Perguntas para a próxima sessão
1. Por que 0 trades? Quais blockers no deribit-decision-latest.json?
2. Estratégia muito conservadora? Ver deribit.strategy.json
3. deribit-economic-viability-report mostra edge positivo?
4. deribit-edge-decomposition-report: em quais condições o bot tem vantagem?
5. Auto-calibração funcionando? Último maybeAutoCalibrate?
6. Risco adequado para equity de $19?
