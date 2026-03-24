# AIBTC_OPS_LOG_RUNBOOK.md

## Objetivo

Este runbook cobre o historico operacional local do agente.

Ele existe para registrar eventos uteis sem depender dos endpoints publicos que podem falhar com `403/1010` fora do contexto aceito pela AIBTC.

## Arquivo de Estado

O helper local grava eventos em:

- `active/state/aibtc-ops-log.jsonl`

Formato:

- um JSON por linha
- sem mnemonic
- sem senha
- sem chave privada
- sem assinatura completa

## Eventos Gravados

No estado atual, o workspace registra:

- `heartbeat_success`
- `heartbeat_attempt`
- `viral_claim_success`
- `viral_claim_attempt`
- `registry_check`
- `ops_report_export`
- `local_state_repair`
- `local_state_prune`
- `local_state_backup`
- `local_state_restore`

## Consultas Disponiveis

### Dashboard

Abra:

- `http://127.0.0.1:8765/aibtc-ops-dashboard.html`

Depois use:

- `Atualizar historico`

### PowerShell

Ultimos eventos:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-log.ps1
```

Limitar quantidade:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-log.ps1 -Limit 10
```

Filtrar por tipo:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-log.ps1 -Type heartbeat_success
```

Resumo curto:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-log.ps1 -Plain
```

Inferir a proxima janela do heartbeat:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/get-next-aibtc-heartbeat-window.ps1
```

## Uso Recomendado

- consultar o historico local depois de cada heartbeat
- usar o log para separar falha visual do dashboard de acao realmente concluida
- usar o log para ter trilha operacional mesmo quando a AIBTC bloquear leituras publicas
- usar o script de janela quando a leitura publica do heartbeat falhar
- usar `-Plain` para checagem rapida do ultimo evento e do ultimo heartbeat bem-sucedido
- usar `-Plain` para checagem rapida tambem da ultima manutencao local e da ultima exportacao de relatorio
- usar `-Plain` para checagem rapida tambem do ultimo backup local
- combinar o log com `show-aibtc-ops-alerts.ps1` quando precisar separar evento historico de alerta ativo no estado atual

## Guardrails

- nao gravar segredos no log
- nao gravar seed phrase
- nao gravar senha
- nao gravar assinatura completa se nao for estritamente necessario
