# AIBTC_REGISTRY_MONITOR.md

## Objetivo

Este documento cobre o monitoramento local do registry on-chain da AIBTC em `mainnet`.

## Contexto

O agente ja esta operacional na plataforma AIBTC:

- registro concluido
- `claims/viral` concluido
- `heartbeat` validado

O proximo marco externo e a publicacao do registry on-chain em `mainnet`.

## Script Local

Use:

- [check-aibtc-mainnet-registry.ps1](/c:/dev/local-ai-agent/active/scripts/check-aibtc-mainnet-registry.ps1)
- [watch-aibtc-mainnet-registry.ps1](/c:/dev/local-ai-agent/active/scripts/watch-aibtc-mainnet-registry.ps1)
- [show-aibtc-registry-snapshot.ps1](/c:/dev/local-ai-agent/active/scripts/show-aibtc-registry-snapshot.ps1)
- [show-aibtc-ops-status.ps1](/c:/dev/local-ai-agent/active/scripts/show-aibtc-ops-status.ps1)
- [aibtc-ops-dashboard.html](/c:/dev/local-ai-agent/active/tools/aibtc-ops-dashboard.html)

Execucao:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/check-aibtc-mainnet-registry.ps1
```

Watch com snapshot local:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/watch-aibtc-mainnet-registry.ps1
```

Resumo do ultimo snapshot local:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-registry-snapshot.ps1 -Plain
```

Resumo consolidado:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-status.ps1
```

Modo curto:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-status.ps1 -Plain
```

## Endpoint Monitorado

- `https://stx402.com/agent/registry`

Estado confirmado localmente em 2026-03-15:

- o endpoint responde `HTTP 200`
- `networks.testnet` esta publicado
- `networks.mainnet` segue `null`
- portanto, o bloqueio atual e externo a este repositorio

## Interpretacao

- `networks.mainnet = null`
  - registry on-chain ainda nao publicado
- `networks.mainnet != null`
  - revisar imediatamente contrato, endereco e proximos passos on-chain

Observacao importante:

- se o endpoint continuar retornando `HTTP 200` com `networks.mainnet = null`, nao ha correcao local que publique o registry
- a acao correta neste caso e manter monitoramento, heartbeat e rotina operacional enquanto aguarda publicacao pela AIBTC

## Frequencia Recomendada

- consultar quando houver anuncio publico da AIBTC
- consultar antes de iniciar qualquer tentativa de identidade on-chain
- consultar periodicamente durante a fase atual de espera
- usar o watch local se quiser detectar a mudanca de `mainnet = null` para publicado sem depender de consulta manual

## Atalho Visual

Se o helper local estiver em execucao:

- `http://127.0.0.1:8765/aibtc-ops-dashboard.html`
- use `Ver snapshot local` como leitura padrao
- use `Consultar ao vivo` apenas quando quiser forcar uma consulta externa manual

Observacao:

- o dashboard usa o snapshot local como caminho principal para reduzir ruido operacional
- a consulta ao vivo continua disponivel como acao explicita
- o watch local grava o ultimo snapshot em `active/state/aibtc-mainnet-registry-status.json`
- quando detecta mudanca de estado do `mainnet`, o watch grava `registry_state_change` no log local
- o status consolidado passa a preferir o snapshot local do registry antes de consultar ao vivo
- o estado consolidado tambem marca quando o snapshot local ficou antigo
