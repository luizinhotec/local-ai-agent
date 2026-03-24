# Speedy Indra Next Action Runbook

## Quando rodar

- Antes de qualquer operacao manual relevante.
- Depois de atualizar inbox, wallet ou quote DeFi.
- Quando houver duvida entre responder, monitorar quote ou nao agir.

## Comando padrao

```powershell
npm run agent:next-action -- --dry-run --amount-sats=3000
```

## Como interpretar `recommendedAction`

- `messaging_only`
  - Ha reply pendente e a melhor acao de baixo custo e responder inbox.
  - Comando sugerido:

```powershell
npm run agent:messages -- --live --reply-pending --max-replies-per-cycle=1
```

- `quote_only`
  - O par `sbtc-usdcx` merece monitoramento, mas nao ha justificativa para live.
  - Comando sugerido:

```powershell
npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=3000
```

- `defi_swap_execute`
  - O setup tecnico/economico esta favoravel, mas ainda exige aprovacao explicita.
  - Comando sugerido:

```powershell
npm run agent:defi:sbtc-usdcx -- --live --approve-live --amount-sats=3000
```

- `wait`
  - Nao agir agora. Use apenas status.
  - Comando sugerido:

```powershell
npm run agent:status
```

## Quando nao agir

- Se `recommendedAction = wait`
- Se o helper marcar `approvalRequired = true` e nao houver aprovacao manual
- Se houver blockers criticos no contexto atual
- Se a bridge BTC -> sBTC ainda for o gargalo e nao houver sBTC novo para operar
