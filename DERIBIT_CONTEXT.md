# Deribit Bot — Contexto para Nova Sessão

## Estado atual (2026-04-11 23h)
- Produção ativa: mainnet, BTC-PERPETUAL
- Equity: 0.00012737 BTC (~$19)
- Acesso Linux: AnyDesk ID 736635741
- Processo: systemd (`sudo systemctl restart local-ai-agent`)
- Logs: `tail -f workspace/deribit/state/deribit-bot-loop.log`

## Métricas acumuladas (2026-04-11 23h)
| Métrica | Valor |
|---|---|
| entry_executions | 10 |
| exit_executions | 6 |
| cumulative_fees_btc | 2.8e-7 |
| realized_pnl_btc | 1.3e-7 |
| resultado líquido | positivo (pnl > fees após otimizações) |

## Configuração ativa
| Arquivo | Parâmetro | Valor |
|---|---|---|
| deribit.execution.json | environment | production |
| deribit.execution.json | defaultOrderSizeUsd | 10 |
| deribit.execution.json | maxOrderSizeUsd | 10 |
| deribit.execution.json | allowProductionExecution | true |
| deribit.execution.json | timeInForce | immediate_or_cancel |
| deribit.risk.json | maxPositionUsd | 15 |
| deribit.risk.json | minAvailableFundsBtc | 0.0001 |
| deribit.risk.json | maxSnapshotAgeMs | 60000 |
| deribit.strategy.json | minDirectionalEdgeUsd | 2 |
| deribit.strategy.json | shortEntryPremiumUsd | 3 |
| deribit.strategy.json | longEntryDiscountUsd | 3 |
| deribit.strategy.json | maxPositionUsd | 15 |
| deribit.strategy.json | takeProfitBtc | 0.0000002 |

## Otimizações aplicadas (2026-04-11)

### 1. Ordens penduradas horas — deribit.execution.json
- `timeInForce`: `good_til_cancelled` → **`immediate_or_cancel`**
- Motivo: ordens maker não preenchidas imediatamente eram canceladas automaticamente,
  evitando que ficassem penduradas quando o preço se movia

### 2. Saídas como taker consumindo lucro — deribit-execution.cjs
- Saídas normais agora usam `postOnly: true` (maker, sem taxa)
- Apenas `stop-loss`, `loss-timeout`, `time-stop`, `risk-reduction` saem como taker
- `break-even-exit` **removido** de `CRITICAL_EXIT_MODES` → agora sai como maker
- Lógica: `postOnly: isCriticalExit ? false : true`

### 3. Break-even disparando cedo demais — deribit-strategy.cjs
- `breakEvenHoldMs`: 45000 → **120000** (aguarda 2 min antes de sair no break-even)
- `breakEvenToleranceBtc`: 0.0000001 → **0.0000003** (mais tolerância a pequeno prejuízo)

### 4. Take-profit muito alto — deribit.strategy.json
- `takeProfitBtc`: 0.000001 → **0.0000002**

## Bugs e soluções

### same_direction_reentry_blocked recorrente
**Causa:** bot coloca nova ordem antes do cleanup completar.
```bash
export DERIBIT_CLIENT_ID=oIb-AgN5
export DERIBIT_CLIENT_SECRET=7OnZjKYqkPbYfCKZTlrMxmgQ4w1k5KrgtuFARLg1ii8
export DERIBIT_ENVIRONMENT=production

node workspace/deribit/runtime/deribit-cancel-open-orders.cjs
rm workspace/deribit/state/deribit-execution-latest.json
```

### Audit travado em "sent"/"open"
**Causa:** credenciais erradas ou `defaultOrderSizeUsd < 10 USD` → ordem rejeitada sem
atualizar audit.
```bash
rm workspace/deribit/state/deribit-execution-latest.json
```

### managementActions review_open_orders nunca executado no loop
**Status:** identificado, **não corrigido ainda**.
O loop não chama `review_open_orders` nas `managementActions`. Pode deixar ordens
abertas sem revisão. Próxima sessão deve investigar e implementar fix.

## Arquitetura geral

```
workspace/deribit/
├── config/           ← configs de risco, estratégia, execução, bot, env
├── runtime/
│   ├── *.cjs         ← 29 scripts de operação, diagnóstico e teste
│   └── lib/          ← 11 módulos core
└── state/            ← arquivos de estado runtime (JSON/JSONL)
```

## Módulos core (runtime/lib/)
- deribit-bot.cjs              → orquestração, createCyclePlan
- deribit-client.cjs           → WebSocket com a exchange
- deribit-private-snapshot.cjs → posição, equity, ordens
- deribit-reconcile.cjs        → sincronização local ↔ exchange
- deribit-risk.cjs             → evaluateRisk
- deribit-strategy.cjs         → decideAction
- deribit-execution.cjs        → sendOrder (postOnly dinâmico)
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

Flags: `--once` (1 ciclo), `--execute` (real)

## Comandos úteis
```bash
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
```

## Perguntas para a próxima sessão
1. `immediate_or_cancel` está gerando trades suficientes?
2. `cumulative_fees` parou de crescer rápido após postOnly nas saídas?
3. Resultado líquido continua positivo?
4. `same_direction_reentry_blocked` ainda ocorre com frequência?
5. Implementar fix do `managementActions review_open_orders` no loop
