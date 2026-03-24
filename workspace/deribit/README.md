# Deribit Runtime

## Objetivo

Esta pasta contem a base tecnica inicial da trilha `Deribit` no repositorio.

Entrega atual:

- monitor `read-only`
- suporte a `testnet` e `production`
- WebSocket com `JSON-RPC`
- autenticacao opcional
- subscriptions de mercado
- leitura opcional de conta e posicao quando houver credenciais
- persistencia do ultimo snapshot local
- log local de eventos
- CLI local de resumo de risco

## Estrutura

- `config/deribit.config.example.json`
- `config/deribit.env.example.ps1`
- `runtime/deribit-read-only-monitor.cjs`
- `runtime/deribit-show-latest.cjs`
- `runtime/deribit-risk-summary.cjs`
- `runtime/deribit-status.cjs`
- `runtime/deribit-decision-preview.cjs`
- `runtime/deribit-evaluate.cjs`
- `runtime/deribit-execute-decision.cjs`
- `runtime/deribit-show-open-orders.cjs`
- `runtime/deribit-private-sync.cjs`
- `runtime/deribit-execution-status.cjs`
- `runtime/deribit-cancel-open-orders.cjs`
- `runtime/deribit-flatten-position.cjs`
- `runtime/deribit-bot-loop.cjs`
- `runtime/lib/deribit-client.cjs`
- `runtime/lib/deribit-risk.cjs`
- `runtime/lib/deribit-strategy.cjs`
- `runtime/lib/deribit-execution.cjs`

## Como Usar

Via `npm` no Windows PowerShell:

```powershell
npm.cmd run deribit:testnet-monitor
```

Com credenciais:

```powershell
. .\workspace\deribit\config\deribit.env.example.ps1
npm.cmd run deribit:testnet-monitor
```

Via `node`:

```powershell
node workspace/deribit/runtime/deribit-read-only-monitor.cjs
```

Snapshot unico e saida imediata:

```powershell
node workspace/deribit/runtime/deribit-read-only-monitor.cjs --once
```

Leitura do ultimo snapshot persistido:

```powershell
node workspace/deribit/runtime/deribit-show-latest.cjs
```

Leitura das ultimas ordens abertas persistidas:

```powershell
node workspace/deribit/runtime/deribit-show-open-orders.cjs
```

Status de execucao:

```powershell
node workspace/deribit/runtime/deribit-execution-status.cjs
```

Resumo de risco sobre o ultimo snapshot:

```powershell
node workspace/deribit/runtime/deribit-risk-summary.cjs
```

Status operacional resumido:

```powershell
node workspace/deribit/runtime/deribit-status.cjs
```

Checagem completa em um comando:

```powershell
node workspace/deribit/runtime/deribit-check.cjs
```

Preview da decisao autonoma sobre o ultimo snapshot:

```powershell
node workspace/deribit/runtime/deribit-decision-preview.cjs
```

Avaliacao completa com snapshot fresco, risco e decisao:

```powershell
node workspace/deribit/runtime/deribit-evaluate.cjs
```

Preflight de execucao da decisao:

```powershell
node workspace/deribit/runtime/deribit-execute-decision.cjs
```

Envio real em `testnet`:

```powershell
node workspace/deribit/runtime/deribit-execute-decision.cjs --execute
```

Sincronizacao privada one-shot:

```powershell
node workspace/deribit/runtime/deribit-private-sync.cjs
```

Cancelar ordens abertas:

```powershell
node workspace/deribit/runtime/deribit-cancel-open-orders.cjs
node workspace/deribit/runtime/deribit-cancel-open-orders.cjs --execute
```

Flatten da posicao:

```powershell
node workspace/deribit/runtime/deribit-flatten-position.cjs
node workspace/deribit/runtime/deribit-flatten-position.cjs --execute
```

Loop autonomo controlado:

```powershell
node workspace/deribit/runtime/deribit-bot-loop.cjs --once
node workspace/deribit/runtime/deribit-bot-loop.cjs
node workspace/deribit/runtime/deribit-bot-loop.cjs --execute
```

Operacao em background no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/start-deribit-bot.ps1 -Execute
powershell -ExecutionPolicy Bypass -File active/scripts/show-deribit-bot-status.ps1
powershell -ExecutionPolicy Bypass -File active/scripts/stop-deribit-bot.ps1
```

Validacao simples da autenticacao privada:

```powershell
node workspace/deribit/runtime/deribit-validate-auth.cjs
```

## Variaveis De Ambiente

- `DERIBIT_ENVIRONMENT`
  - `testnet` ou `production`
  - default: `testnet`
- `DERIBIT_CLIENT_ID`
- `DERIBIT_CLIENT_SECRET`
- `DERIBIT_CURRENCY`
  - default: `BTC`
- `DERIBIT_INSTRUMENT`
  - default: `BTC-PERPETUAL`
- `DERIBIT_LOG_INTERVAL_MS`
  - default: `5000`
- `DERIBIT_PRIVATE_REFRESH_INTERVAL_MS`
  - default: `10000`

Config local opcional:

- `workspace/deribit/config/deribit.config.json`
- `workspace/deribit/config/deribit.risk.json`
- `workspace/deribit/config/deribit.strategy.json`
- `workspace/deribit/config/deribit.execution.json`
- `workspace/deribit/config/deribit.bot.json`
- preencha o template local em `workspace/deribit/config/deribit.env.example.ps1` antes dos comandos privados

## Comportamento

Sem credenciais:

- conecta no WebSocket
- assina `ticker` e `book`
- mostra snapshot publico

Com credenciais:

- autentica via `public/auth`
- consulta `private/get_account_summary`
- consulta `private/get_position`
- consulta `private/get_open_orders_by_instrument`
- assina `user.portfolio`, `user.orders` e `user.trades`
- faz refresh periodico de `account summary` e `position`
- persiste o ultimo snapshot em `workspace/deribit/state/deribit-latest.json`
- registra eventos em `workspace/deribit/state/deribit-events.jsonl`
- persiste o ultimo resumo de risco em `workspace/deribit/state/deribit-risk-latest.json`
- persiste a ultima decisao em `workspace/deribit/state/deribit-decision-latest.json`
- persiste as ultimas ordens abertas em `workspace/deribit/state/deribit-open-orders-latest.json`

## Observacoes

- o runtime atual nao envia ordens
- o foco e observabilidade e base de infraestrutura
- a camada atual ja produz decisao sugerida, mas ainda nao executa
- a camada de execucao existe em `dry-run` por padrao
- envio real exige autenticacao privada e `--execute`
- o loop autonomo respeita cooldown e limite de ordens abertas
- o loop agora separa `entry` de `position-management`
- com posicao aberta, o bot nao deve abrir nova entrada na mesma logica de entry
- `position-management` agora pode reduzir por `take-profit`, `stop-loss`, `time-stop` e funding adverso
- ordens abertas envelhecidas podem ser canceladas pelo loop
- `deribit-status.cjs` retorna codigo `2` quando houver `block`
- `deribit-check.cjs` executa snapshot fresco e depois o status
- `deribit-evaluate.cjs` executa snapshot, risco e decisao em sequencia
