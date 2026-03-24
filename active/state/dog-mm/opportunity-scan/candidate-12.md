# DOG MM Bitflow Swap Plan

- generated_at_utc: 2026-03-20T06:01:49.840Z
- mode: dry_run
- wallet_name: dog-mm-mainnet
- wallet_id: c904721f-b3c4-4056-9f67-3f806ab380b4
- sender_address: SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF
- input_token: SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx
- output_token: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
- amount_in: 269580
- amm_strategy: best
- slippage_tolerance: 3
- quote_amount_out: 401
- quote_min_amount_out: 389
- route_hops: 1
- swap_contract: SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1
- swap_function: swap-simple-multi
- nonce: 2
- fee: 239548
- txid: f25eb54d20be4136005e797c9fc6758bffdaf72c19a3aafeb68cab733a33eb4f

## Fee Diagnostics

- tx_bytes: 612
- fee_stx: 0.239548
- fee_per_byte: 391.41830065359477
- post_condition_count: 2
- typed_parameter_count: 1
- execution_path_length: 1

## Profit Diagnostics

- complete: false
- missing_fields: stxUsd
- input_token_decimals: 6
- output_token_decimals: 8
- input_token_usd: 1
- output_token_usd: 1
- stx_usd: n/a
- input_amount_human: 0.26958
- expected_output_human: 0.00000401
- min_output_human: 0.00000389
- input_usd: 0.26958
- expected_output_usd: 0.00000401
- min_output_usd: 0.00000389
- network_fee_usd: n/a
- gross_profit_usd: -0.26957599
- worst_case_profit_usd: -0.26957611
- net_profit_usd: n/a
- worst_case_net_profit_usd: n/a
- net_profit_bps: n/a
- worst_case_net_profit_bps: n/a
- fee_as_percent_of_input: n/a
- fee_as_percent_of_expected_output: n/a
- fee_as_percent_of_gross_profit: n/a

## Execution Path

1. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-1 | swap-y-for-x | expected_bin_id=103
