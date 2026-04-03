# AIBTC_DAILY_OPS_30S.md

## Objetivo

Este roteiro existe para a rotina mais curta possivel do agente.

## Protecao local: Hermetica direct_redeem

- Ao detectar `ERR_NOT_PROTOCOL` / `missing_protocol_role` / `vault-hbtc-v1` sem role PROTOCOL / registry indisponivel:
  - Bloquear `direct_redeem` localmente
  - Marcar `HERMETICA_DIRECT_REDEEM_BLOCKED` em estado local
  - Recomendacao: `bridge_recovery` ou `manual_bridge_fallback`
  - Aplicar cooldown por default 24h
- Comando de verificacao/guard:
  - `powershell -ExecutionPolicy Bypass -File active/scripts/check-hermetica-direct-redeem-guard.ps1`
- Comando de desbloqueio manual:
  - `powershell -ExecutionPolicy Bypass -File active/scripts/check-hermetica-direct-redeem-guard.ps1 -ForceUnblock`

## Quando NÃO usar ForceUnblock

- Não liberar `direct_redeem` se o registro do Jacen esteja ainda indisponível (`registry mainnet indisponivel`).
- Não usar quando houver ocorrências de `ERR_NOT_PROTOCOL` ou `missing_protocol_role` no histórico local e não foram corrigidas on-chain.
- Não usar se não houver evidência clara e recente de que o `vault-hbtc-v1` agora possui role `PROTOCOL` em `hq-v1`.
- Em vez disso, investigue `bridge_recovery` / `manual_bridge_fallback` e confirme operação segura antes de tentar.

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
