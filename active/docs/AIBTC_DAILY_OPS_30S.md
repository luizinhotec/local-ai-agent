# AIBTC_DAILY_OPS_30S.md

## Objetivo

Este roteiro existe para a rotina mais curta possivel do agente.

Use quando voce so quiser:

- checar se esta tudo saudavel
- manter a manutencao local em dia
- saber se precisa fazer heartbeat

## Roteiro 30s

1. ver o estado consolidado:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-status.ps1 -Plain
```

2. rodar a manutencao local completa:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/run-aibtc-maintenance-cycle.ps1 -Prune
```

3. se quiser fazer o heartbeat:

- abrir `http://127.0.0.1:8765/aibtc-ops-dashboard.html`
- clicar `Atualizar estado local`
- clicar `Rodar heartbeat`
- aprovar na Leather

4. confirmar o heartbeat no log:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/show-aibtc-ops-log.ps1 -Plain
```

5. acompanhar o gatilho externo:

```powershell
powershell -ExecutionPolicy Bypass -File active/scripts/watch-aibtc-mainnet-registry.ps1
```

## Leitura Rapida

Se o terminal mostrar:

- `alertas: nenhum`
- `auditoria: auditoria de integridade sem divergencias`
- `backup: backup local disponivel`
- `daily check: daily check executado com ok`

entao a camada local esta saudavel.

Se mostrar:

- `heartbeat liberado agora`

voce pode fazer um novo check-in quando fizer sentido operacionalmente.

## Regra Simples

- tooling local: pronto
- rotina local: manutencao + heartbeat
- proximo salto do projeto: registry on-chain em `mainnet`
