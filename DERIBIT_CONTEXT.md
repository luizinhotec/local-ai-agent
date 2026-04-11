# Deribit Bot — Contexto para Nova Sessão

## Estado atual (2026-04-11 ~16h)
- Produção ativa: mainnet, BTC-PERPETUAL
- Equity: ~0.000127 BTC (~$19)
- Acesso Linux: AnyDesk ID 736635741 (sem precisar de WhatsApp)
- Processo: systemd (`sudo systemctl restart local-ai-agent`)
- Logs: `tail -f workspace/deribit/state/deribit-bot-loop.log`

## Métricas acumuladas
| Métrica | Valor |
|---|---|
| entry_executions | 7 |
| exit_executions | 5 |
| cumulative_fees_btc | 2.8e-7 |
| realized_pnl_btc | 9e-8 |
| resultado líquido | negativo (otimizações aplicadas) |

## Configuração ativa
| Arquivo | Parâmetro | Valor |
|---|---|---|
| deribit.execution.json | environment | production |
| deribit.execution.json | defaultOrderSizeUsd | 10 |
| deribit.execution.json | maxOrderSizeUsd | 10 |
| deribit.execution.json | allowProductionExecution | true |
| deribit.risk.json | maxPositionUsd | 15 |
| deribit.risk.json | minAvailableFundsBtc | 0.0001 |
| deribit.risk.json | maxSnapshotAgeMs | 60000 |
| deribit.strategy.json | minDirectionalEdgeUsd | 2 |
| deribit.strategy.json | shortEntryPremiumUsd | 3 |
| deribit.strategy.json | longEntryDiscountUsd | 3 |
| deribit.strategy.json | maxPositionUsd | 15 |
| deribit.strategy.json | takeProfitBtc | 0.0000002 |

## Otimizações de taxa aplicadas (2026-04-11 tarde)

### Problema identificado
Bot entrava como maker (sem taxa) mas saía **sempre** como taker (com taxa 0.05%).
Com posição de $10 USD → $0.005 por saída. `break-even-exit` disparava após 45s sem
dar tempo do preço se mover. Resultado: taxas acumuladas > lucro bruto.

### Mudanças em deribit-execution.cjs
- Saídas normais agora usam `postOnly: true` (maker, sem taxa)
- Apenas `stop-loss`, `loss-timeout`, `time-stop` e `risk-reduction` saem como taker
- `break-even-exit` **removido** da lista `CRITICAL_EXIT_MODES` → agora sai como maker
- Lógica: `postOnly: isCriticalExit ? false : true`

### Mudanças em deribit-strategy.cjs (DEFAULT_STRATEGY_CONFIG)
- `breakEvenHoldMs`: 45000 → **120000** (aguarda 2 min antes de sair no break-even)
- `breakEvenToleranceBtc`: 0.0000001 → **0.0000003** (mais tolerância a pequeno prejuízo)

### Mudança em config/deribit.strategy.json
- `takeProfitBtc`: 0.000001 → **0.0000002**

## Bug recorrente: same_direction_reentry_blocked

**Sintoma:** blocker ativa mesmo após deletar `deribit-execution-latest.json`.

**Causa:** bot coloca nova ordem antes do cleanup completar.

**Solução completa:**
```bash
# exportar credenciais primeiro
export DERIBIT_CLIENT_ID=oIb-AgN5
export DERIBIT_CLIENT_SECRET=7OnZjKYqkPbYfCKZTlrMxmgQ4w1k5KrgtuFARLg1ii8
export DERIBIT_ENVIRONMENT=production

node workspace/deribit/runtime/deribit-cancel-open-orders.cjs
rm workspace/deribit/state/deribit-execution-latest.json
```

## Bug anterior resolvido: audit travado em "sent"
**Causa raiz:** credenciais testnet com `DERIBIT_ENVIRONMENT=production` → ordens rejeitadas
sem atualizar audit. **Causa secundária:** `defaultOrderSizeUsd=5` abaixo do mínimo (10 USD).

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
1. As saídas como maker estão funcionando? `cumulative_fees` parou de crescer rápido?
2. `breakEvenHoldMs` de 120s está dando tempo suficiente para lucro?
3. Resultado líquido melhorou após as otimizações?
4. `same_direction_reentry_blocked` ainda ocorre com frequência?
5. Considerar aumentar posição se resultado líquido ficar positivo por 24h
