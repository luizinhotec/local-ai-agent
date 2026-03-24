# DOG MM Phase 0 Execution Brief

Generated at UTC: 2026-03-17T14:56:38.1364318Z

## Track

- agent: DOG MM Agent
- stage: wallet_funded
- phase0_pool: sBTC-USDCx
- phase0_bin_step: 1
- phase1_pool: sBTC-DOG
- phase1_asset_base: sBTC

## Wallet

- wallet_name: dog-mm-mainnet
- wallet_created: True
- wallet_validated: True
- wallet_funded: True

## Readiness

- phase0_ready: True
- phase1_ready: True
- next_action: phase0_can_start

## Phase 0 Preflight

- phase0_launch_ready: True
- preflight_next_action: monitor_open_phase0_position
- selected_pool_listed_in_hodlmm_snapshot: True
- selected_pool_active: True
- selected_pool_status: True
- hodlmm_dog_pool_still_absent: True

## First Cycle Policy

- capital_initial_recommended: USD 20
- observation_window: 24h
- recenter_max: 1
- no_recenter_before: 12h unless risk
- if_second_recenter_needed: close_cycle_and_record_failure

