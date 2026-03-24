# Speedy Indra Safe Mode Operations

## Arquitetura

O modo operacional seguro do Speedy Indra tem quatro camadas:

1. `skill-route-evaluator.cjs`
   - avalia contexto social, wallet, defi e bridge
   - decide apenas a `recommendedAction`

2. `agent-next-action.cjs`
   - transforma `recommendedAction` em comando sugerido ao operador
   - expõe tambem se esse comando e autoexecutavel pelo loop

3. `execution-policy.cjs`
   - policy centralizada de execucao do loop padrao
   - allowlist explicita
   - fail-closed para qualquer ambiguidade

4. `agent-standard-loop.cjs`
   - executa apenas o que a policy permitir
   - nunca executa `--approve-live`
   - nunca executa swap live

## Politica efetiva de execucao

- `messaging_only`
  - pode autoexecutar somente:
  - `npm run agent:messages -- --live --reply-pending --max-replies-per-cycle=1`

- `quote_only`
  - pode autoexecutar somente:
  - `npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=<valor>`

- `defi_swap_execute`
  - nunca autoexecuta
  - pode ser sugerido ao operador, mas fica bloqueado no loop

- `wait`
  - nao executa nada

Bloqueios por design:
- qualquer comando com `--approve-live`
- qualquer swap live
- qualquer acao desconhecida
- qualquer comando fora da allowlist
- qualquer combinacao ambigua de flags

## Flags obrigatorias

Modo seguro baseline:

- `ENABLE_MESSAGING=true`
- `ENABLE_MESSAGING_SAFE_REPLIES_ONLY=true`
- `ENABLE_MESSAGING_FULL_OUTBOUND=false`
- `REQUIRE_APPROVAL_FOR_DEFI_LIVE=true`
- `REQUIRE_APPROVAL_FOR_WALLET_LIVE=true`

## Defaults seguros

- messaging fail-closed quando flags estiverem ambiguas
- outbound pago bloqueado em `safe_replies_only`
- `agent-next-action` pode sugerir comando manual, mas tambem marca se o loop pode ou nao autoexecuta-lo
- loop padrao nunca relaxa policy por conta propria

## Comandos de validacao

Auditoria rapida:

```powershell
npm run agent:audit:safe
```

Gate manual:

```powershell
npm run agent:next-action -- --dry-run --amount-sats=3000
```

Loop padrao em modo seguro:

```powershell
npm run agent:loop:once -- --amount-sats=3000
```

Tests:

```powershell
npm test
npm run agent:test:safe-e2e
```

## Checklist diario

1. Rodar `npm run agent:audit:safe`
2. Confirmar:
   - `policyMode = safe_replies_only`
   - `fullOutboundEnabled = false`
   - `safeModeBaselineReady = true`
3. Rodar `npm run agent:next-action -- --dry-run --amount-sats=3000`
4. Conferir:
   - `recommendedAction`
   - `recommendedCommand`
   - `autoExecutableByStandardLoop`
   - `autoExecutionBlockReason`
5. Se `recommendedAction = messaging_only`, o loop pode executar reply seguro
6. Se `recommendedAction = quote_only`, so quote/read-only
7. Se `recommendedAction = defi_swap_execute`, nao autoagir
8. Se `recommendedAction = wait`, nao agir

## Cenarios bloqueados por design

- sender pago em modo seguro
- outbound pago por fila antiga
- qualquer comando com `--approve-live`
- qualquer `agent:defi:sbtc-usdcx -- --live ...`
- qualquer nova acao recomendada nao allowlisted

## Interpretacao operacional

- `recommendedCommand`
  - comando sugerido ao operador humano

- `autoExecutableByStandardLoop`
  - se o loop pode executar esse comando

- `autoExecutionBlockReason`
  - motivo tecnico/politico do bloqueio no loop

Se houver divergencia entre sugestao humana e autoexecucao, prevalece sempre a policy do loop.
