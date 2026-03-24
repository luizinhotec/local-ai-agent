# DOG MM Phase 0 Action Sheet

Generated at UTC: 2026-03-17T14:06:53.9201077Z

## Live Context

- wallet_stx: 2.603507
- wallet_sbtc_sats: 19021
- wallet_usdcx: 9.890354
- training_pool: sBTC-USDCx
- bin_step: 1
- pool_active: True
- pool_status: True
- hodlmm_dog_pool_available: False
- sbtc_price_usd_used: 73558.03196415

## First-Cycle Capital

- target_cycle_usd: 20
- target_cycle_sats: 27190
- reserve_sbtc_outside_cycle_sats: 0

## Current Inventory State

- inventory_already_staged: true
- staged_sbtc_sats_for_lp: 19021
- staged_usdcx_for_lp: 9.890354
- rationale: swap leg already completed onchain; the remaining action is LP add only

## Manual Steps Now

1. Open Bitflow and select the HODLMM/DLMM pool sBTC-USDCx with bin_step = 1.
2. Do not perform another inventory swap before the LP add.
3. Use the currently staged inventory: 19021 sats of sBTC and 9.890354 USDCx.
4. Add liquidity with a moderate range bias, not the narrowest possible configuration.
5. Copy the LP add tx hash immediately after submission.
6. Record phase 0 open only after the LP add tx exists.
7. Do not recenter before 12h unless there is a real risk event.

## Guardrails

- phase0_first_cycle_capital_usd: 20
- no_second_recenter: true
- if_second_recenter_seems_needed: close_the_cycle_and_record_failure
- do_not_touch_phase1_capital_path: true

