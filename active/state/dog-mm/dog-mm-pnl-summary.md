# DOG MM PnL Summary

- generated_at_utc: 2026-03-19T20:37:47.261Z
- cycle_status: open
- wallet_address: SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF
- inventory_snapshot_age_hours: 45.59

## Swap Entry

- amount_in_sats: 13479
- amount_in_btc: 0.00013479
- amount_out_usdcx: 9.890354
- swap_txid: 82b3e4f470f538ff48dfd41cb8db3c9a52c692f49e4bf6a558c3e7ef3fbe7d1e

## Gas

- swap_gas_stx: 0.396493
- swap_gas_usd: 0.097058
- lp_add_gas_stx: 0.05
- lp_add_gas_usd: 0.01224
- close_gas_stx: unavailable
- close_gas_usd: unavailable
- total_gas_paid_stx_known: 0.446493
- total_gas_paid_usd_known: 0.109298

## Inventory

- deployed_sbtc: 0.00019021
- deployed_usdcx: 9.890354
- deployed_value_usd_at_entry_mark: 23.881827
- latest_observed_sbtc: 0.00018862
- latest_observed_usdcx: 9.996847
- latest_observed_total_value_usd: 23.885395
- marked_now_value_usd_from_last_observed_balances: 23.282979

## PnL

- fees_accumulated_lp_usd: unavailable
- gross_pnl_usd_vs_entry_mark: -0.598848
- net_pnl_usd_after_known_gas: -0.708146

## Notes

- Current inventory uses the latest observed heartbeat snapshot at 2026-03-17T23:02:39.5239513Z.
- Close gas is unavailable because there is no valid close transaction recorded yet.
- feesAccumulatedLpUsd remains unavailable because local state does not expose a trustworthy fee-accrual field separate from inventory drift.
- grossUsd is mark-to-market against the LP add inventory at the entry sBTC/USD mark from the local DOG MM ops bundle.
- netAfterKnownGasUsd subtracts only known on-chain gas for swap and LP add, plus close if a real close transaction exists.
