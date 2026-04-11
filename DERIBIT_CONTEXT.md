# Deribit Bot — Contexto para Nova Sessão

## Estado atual (2026-04-11)
- Produção ativa: mainnet, BTC-PERPETUAL
- Equity: ~0.000127 BTC (~$19)
- Primeiro trade executado com sucesso (lucro positivo) — trade_id: 424623283
- Processo: systemd (`sudo systemctl restart local-ai-agent`)
- Logs: `tail -f workspace/deribit/state/deribit-bot-loop.log`

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

## Bug resolvido: audit travado em "sent"
**Sintoma:** `state/deribit-execution-latest.json` ficava com `status: "sent"` permanentemente,
ativando o blocker `same_direction_reentry_blocked` e impedindo novos trades.

**Causa raiz:** credenciais de testnet sendo usadas com `DERIBIT_ENVIRONMENT=production` → ordens
rejeitadas pela exchange, mas o audit não era atualizado para `failed`.

**Causa secundária:** `defaultOrderSizeUsd=5` abaixo do mínimo da Deribit (10 USD).

**Solução aplicada:** deletar manualmente `state/deribit-execution-latest.json` + corrigir
credenciais e tamanho mínimo. Após essas correções, o bug não deve se repetir.

**Se travar novamente:**
```bash
rm workspace/deribit/state/deribit-execution-latest.json
```

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
1. Quantos trades executados? P&L acumulado?
2. Blockers frequentes? Ver `deribit-decision-latest.json`
3. Auto-calibração ajustou parâmetros? Ver `deribit-calibration-latest.json`
4. `deribit-economic-viability-report` mostra edge positivo consistente?
5. `minDirectionalEdgeUsd: 2` está gerando trades suficientes sem ruído?
6. Considerar aumentar `defaultOrderSizeUsd` se equity crescer acima de $25?
