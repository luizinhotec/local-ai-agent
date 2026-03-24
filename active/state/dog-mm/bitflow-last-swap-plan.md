# DOG MM Bitflow Swap Plan

- generated_at_utc: 2026-03-24T15:32:13.683Z
- mode: dry_run
- wallet_name: dog-mm-mainnet
- wallet_id: b16b73a5-69bf-4b64-b8ca-4abf733c0da0
- sender_address: SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF
- input_token: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
- output_token: SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx
- amount_in: 13479
- amm_strategy: best
- slippage_tolerance: 3
- quote_amount_out: 9455128
- quote_min_amount_out: 9171474
- route_hops: 1
- swap_contract: SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1
- swap_function: swap-simple-multi
- nonce: 2
- fee: 170443
- txid: 94f30e62291dab874913774b83e5f8ba22592698cf8b6f69617c09fd70f7ef7a

## Fee Diagnostics

- tx_bytes: 614
- fee_stx: 0.170443
- fee_per_byte: 277.5944625407166
- post_condition_count: 2
- typed_parameter_count: 1
- execution_path_length: 1

## Profit Diagnostics

- complete: false
- missing_fields: inputTokenUsd, stxUsd
- input_token_decimals: 8
- output_token_decimals: 6
- input_token_usd: n/a
- output_token_usd: 1
- stx_usd: n/a
- input_amount_human: 0.00013479
- expected_output_human: 9.455128
- min_output_human: 9.171474
- input_usd: n/a
- expected_output_usd: 9.455128
- min_output_usd: 9.171474
- network_fee_usd: n/a
- gross_profit_usd: n/a
- worst_case_profit_usd: n/a
- net_profit_usd: n/a
- worst_case_net_profit_usd: n/a
- net_profit_bps: n/a
- worst_case_net_profit_bps: n/a
- fee_as_percent_of_input: n/a
- fee_as_percent_of_expected_output: n/a
- fee_as_percent_of_gross_profit: n/a

## Execution Path

1. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10 | swap-x-for-y | expected_bin_id=61
