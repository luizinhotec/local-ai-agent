# Checklist Diario: Safe Replies Only

1. Confirmar policy ativa:
   - `ENABLE_MESSAGING=true`
   - `ENABLE_MESSAGING_SAFE_REPLIES_ONLY=true`
   - `ENABLE_MESSAGING_FULL_OUTBOUND=false`

2. Validar gate antes de agir:
   - `npm run agent:next-action -- --dry-run --amount-sats=3000`

3. Se `recommendedAction = messaging_only`:
   - o loop padrao pode executar reply seguro
   - comando manual equivalente:
   - `npm run agent:messages -- --live --reply-pending --max-replies-per-cycle=1`

4. Se `recommendedAction = quote_only`:
   - nao agir com valor
   - usar somente:
   - `npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=3000`

5. Verificar auditoria local:
   - `npm run agent:status`
   - conferir `skills.messaging.policyMode`
   - conferir `skills.messaging.lastSkipReason`
   - conferir `skills.messaging.lastActionType`
   - conferir `skills.messaging.lastActionResult`

6. Nao prosseguir quando:
   - `policyMode != safe_replies_only`
   - `reason = feature_disabled`
   - `reason = invalid_policy_combination`
   - `reason = messaging_policy_ambiguous_fail_closed`
   - houver qualquer comando com `--approve-live`

7. Nao permitido neste modo:
   - sender pago
   - outbound allowlist seed
   - DeFi live
   - approve-live
