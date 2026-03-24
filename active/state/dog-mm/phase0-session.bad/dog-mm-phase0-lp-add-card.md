# DOG MM Phase 0 LP Add Card

- generated_at_local: 2026-03-17 11:04:14
- generated_at_utc: 2026-03-17T14:04:14.6462120Z
- phase0_state: phase0_open
- swap_txid: 82b3e4f470f538ff48dfd41cb8db3c9a52c692f49e4bf6a558c3e7ef3fbe7d1e
- lp_add_txid: 016846ea5517449a33f42c59e0f3a4851142214d2d011b263c97056aaffc2bf8
- wallet_stx: 2.553507
- wallet_sbtc_sats_ready_for_lp: 0
- wallet_usdcx_ready_for_lp: 0
- lp_token_amount: 33297668
- lp_bin_id_unsigned: 603

## Position Opened

1. The LP add already executed successfully.
2. The phase 0 position now sits on unsigned bin `603` for `sBTC-USDCx`.
3. Use the monitoring card and checkpoint script for the first 24h.
4. Do not perform another swap unless the phase 0 thesis changes materially.

## Guardrails

- do not perform a second inventory swap during the initial observation window without a documented reason
- do not recenter before `12h` unless a real range or utility problem appears
- use `record-dog-mm-phase0-checkpoint.ps1` for the first formal follow-up
