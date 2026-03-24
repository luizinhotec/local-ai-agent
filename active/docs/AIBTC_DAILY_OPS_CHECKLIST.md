# AIBTC_DAILY_OPS_CHECKLIST.md

## Objetivo

Este checklist resume a rotina minima para operar o agente no estado atual do projeto.

Roteiro ultracurto:

- [AIBTC_DAILY_OPS_30S.md](/c:/dev/local-ai-agent/active/docs/AIBTC_DAILY_OPS_30S.md)

## Rotina Curta

1. consultar o estado consolidado:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-status.ps1 -Plain
```

2. se o heartbeat estiver liberado, abrir:

- `http://127.0.0.1:8765/aibtc-ops-dashboard.html`

3. clicar em:

- `Atualizar estado local`

4. se o painel indicar que o heartbeat esta liberado:

- usar `Rodar heartbeat`

5. conferir no painel:

- ultima batida bem-sucedida
- origem da janela
- estado do registry on-chain
- proxima acao recomendada no topo

## Rotina de Verificacao

Quando quiser mais detalhe:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-status.ps1
```

Historico local:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-log.ps1 -Limit 10
```

Resumo rapido do log:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-log.ps1 -Plain
```

Resumo rapido do ultimo relatorio:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-report.ps1 -Plain
```

Gerar backup local do estado:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/backup-aibtc-local-state.ps1
```

Restaurar o ultimo backup local:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/restore-aibtc-local-state.ps1 -UseLatest
```

Resumo rapido dos alertas operacionais:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-alerts.ps1
```

Resumo rapido da politica e da reserva de posicao:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-position-status.ps1 -Plain
```

Monitor continuo no terminal:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/watch-aibtc-ops.ps1
```

Daily check completo:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-daily-check.ps1
```

Ciclo completo de manutencao:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-maintenance-cycle.ps1
```

Snapshot local do registry:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-registry-snapshot.ps1 -Plain
```

Registry on-chain:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/check-aibtc-mainnet-registry.ps1
```

## Quando Agir

- se `heartbeat` estiver `liberado agora`
  - executar o check-in
- se `registry publicado`
  - revisar imediatamente o contrato e os proximos passos on-chain
- se o dashboard estiver com leituras bloqueadas
  - usar o log local e o script consolidado como referencia
- se houver alertas operacionais ativos
  - priorizar heartbeat antigo, snapshot do registry antigo, relatorio antigo, daily check antigo ou auditoria antiga antes de qualquer polimento de UI
- se a confirmacao da posicao estiver antiga ou a reserva liquida estiver abaixo do piso
  - revisar [AIBTC_WALLET_POLICY.md](/c:/dev/local-ai-agent/active/docs/AIBTC_WALLET_POLICY.md) antes de aportar, sacar ou trocar de estrategia

## Guardrails

- nao expor seed phrase
- nao expor senhas
- nao tratar o dashboard local como substituto da AIBTC
- nao iniciar acao on-chain sem revisar o estado real do registry
