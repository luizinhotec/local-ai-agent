# Deribit Bot

## Status (2026-04-11)
- **Ambiente:** production (mainnet)
- **Instrumento:** BTC-PERPETUAL
- **Equity:** ~0.000127 BTC
- **Primeiro trade:** executado com sucesso (trade_id: 424623283, lucro positivo)
- **Processo:** systemd — `sudo systemctl restart local-ai-agent`
- **Logs:** `tail -f workspace/deribit/state/deribit-bot-loop.log`

## Objetivo

Bot autônomo de market-making em BTC-PERPETUAL na Deribit. Acumula sats via
maker orders com gerenciamento de posição, take-profit, stop-loss e redução
por funding adverso.

## Estrutura

```
workspace/deribit/
├── config/
│   ├── deribit.bot.json
│   ├── deribit.execution.json   ← environment, orderSize, allowProductionExecution
│   ├── deribit.risk.json        ← limites de risco
│   ├── deribit.strategy.json    ← parâmetros de entrada e saída
│   ├── deribit.config.json      ← config geral (gitignored)
│   └── deribit.env.example.ps1  ← template de variáveis
├── runtime/
│   ├── lib/                     ← 11 módulos core
│   └── *.cjs                    ← 29 scripts de operação e diagnóstico
└── state/                       ← arquivos de estado runtime (gitignored)
```

## Configuração ativa

### deribit.execution.json
```json
{
  "environment": "production",
  "defaultOrderSizeUsd": 10,
  "maxOrderSizeUsd": 10,
  "allowProductionExecution": true,
  "postOnly": true,
  "labelPrefix": "codex-deribit"
}
```
> Mínimo de ordem na Deribit: 10 USD. Usar valor menor causa rejeição silenciosa.

### deribit.risk.json
```json
{
  "maxPositionUsd": 15,
  "minAvailableFundsBtc": 0.0001,
  "maxSnapshotAgeMs": 60000,
  "maxSpreadUsd": 5,
  "maxMarkIndexGapUsd": 25,
  "maxFundingAbs": 0.0005
}
```

### deribit.strategy.json
```json
{
  "minDirectionalEdgeUsd": 2,
  "shortEntryPremiumUsd": 3,
  "longEntryDiscountUsd": 3,
  "maxPositionUsd": 15,
  "entryConfidenceThreshold": 0.55,
  "makerOnlyEntry": true,
  "takeProfitBtc": 0.000001,
  "stopLossBtc": 0.000003
}
```

## Módulos core (runtime/lib/)

| Módulo | Responsabilidade |
|---|---|
| deribit-bot.cjs | orquestração, createCyclePlan |
| deribit-client.cjs | WebSocket com a exchange |
| deribit-private-snapshot.cjs | posição, equity, ordens |
| deribit-reconcile.cjs | sincronização local ↔ exchange |
| deribit-risk.cjs | evaluateRisk |
| deribit-strategy.cjs | decideAction |
| deribit-execution.cjs | sendOrder |
| deribit-execution-audit.cjs | audit trail |
| deribit-state-store.cjs | leitura/escrita de estado |
| deribit-calibration.cjs | auto-calibração |
| deribit-process-lock.cjs | processo único |

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

## Comandos úteis

```bash
# Diagnóstico
node workspace/deribit/runtime/deribit-bot-summary.cjs
node workspace/deribit/runtime/deribit-status.cjs
node workspace/deribit/runtime/deribit-risk-summary.cjs
node workspace/deribit/runtime/deribit-decision-preview.cjs
node workspace/deribit/runtime/deribit-economic-viability-report.cjs
node workspace/deribit/runtime/deribit-edge-decomposition-report.cjs

# Operação
node workspace/deribit/runtime/deribit-bot-loop.cjs --once           # dry-run
node workspace/deribit/runtime/deribit-bot-loop.cjs --once --execute  # real
node workspace/deribit/runtime/deribit-cancel-open-orders.cjs
node workspace/deribit/runtime/deribit-flatten-position.cjs

# Utilitários
node workspace/deribit/runtime/deribit-validate-auth.cjs
node workspace/deribit/runtime/deribit-private-sync.cjs
node workspace/deribit/runtime/deribit-check.cjs
```

## Variáveis de ambiente

| Variável | Default | Descrição |
|---|---|---|
| DERIBIT_ENVIRONMENT | testnet | `testnet` ou `production` |
| DERIBIT_CLIENT_ID | — | API key |
| DERIBIT_CLIENT_SECRET | — | API secret |
| DERIBIT_CURRENCY | BTC | moeda base |
| DERIBIT_INSTRUMENT | BTC-PERPETUAL | instrumento |

Credenciais ficam em `.env.local` na raiz (nunca commitado).

## Bugs conhecidos e soluções

### Audit travado em `status: "sent"`
**Sintoma:** `state/deribit-execution-latest.json` fica com `status: "sent"` permanentemente,
ativando `same_direction_reentry_blocked` e impedindo novos trades.

**Causa:** credenciais erradas (ex: testnet com `DERIBIT_ENVIRONMENT=production`) ou
`defaultOrderSizeUsd` abaixo do mínimo da exchange (10 USD) → ordem rejeitada sem
atualizar o audit.

**Solução:**
```bash
rm workspace/deribit/state/deribit-execution-latest.json
```
Após corrigir credenciais e tamanho mínimo.

## Observações

- `--execute` é obrigatório para envio real de ordens
- `deribit-status.cjs` retorna código `2` quando houver blocker
- `deribit-check.cjs` executa snapshot fresco + status em sequência
- o loop respeita cooldown e limite de ordens abertas
- `position-management` pode reduzir por take-profit, stop-loss, time-stop e funding adverso
- ordens abertas envelhecidas são canceladas automaticamente pelo loop
