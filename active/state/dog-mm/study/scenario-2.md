# DOG MM Bitflow Swap Plan

- generated_at_utc: 2026-03-19T21:21:18.517Z
- mode: dry_run
- wallet_name: dog-mm-mainnet
- wallet_id: c904721f-b3c4-4056-9f67-3f806ab380b4
- sender_address: SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF
- input_token: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
- output_token: SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx
- amount_in: 13479
- amm_strategy: best
- slippage_tolerance: 3
- quote_amount_out: 9483522
- quote_min_amount_out: 9199016
- route_hops: 1
- swap_contract: SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1
- swap_function: swap-simple-multi
- nonce: 2
- fee: 2196934
- txid: be84276ddf60ad075b55ec75dd1418a5411d246d9ae4452a4b6c4d88dbf67ad7

## Fee Diagnostics

- tx_bytes: 614
- fee_stx: 2.196934
- fee_per_byte: 3578.0684039087946
- post_condition_count: 2
- typed_parameter_count: 1
- execution_path_length: 1

## Profit Diagnostics

- complete: true
- missing_fields: none
- input_token_decimals: 8
- output_token_decimals: 6
- input_token_usd: 70392
- output_token_usd: 1
- stx_usd: 0.244762
- input_amount_human: 0.00013479
- expected_output_human: 9.483522
- min_output_human: 9.199016
- input_usd: 9.48813768
- expected_output_usd: 9.483522
- min_output_usd: 9.199016
- network_fee_usd: 0.5377259597080001
- gross_profit_usd: -0.00461567999999879
- worst_case_profit_usd: -0.28912167999999916
- net_profit_usd: -0.5423416397079989
- worst_case_net_profit_usd: -0.8268476397079992
- net_profit_bps: -571.5996731910818
- worst_case_net_profit_bps: -871.4540909865879
- fee_as_percent_of_input: 5.667349883017297
- fee_as_percent_of_expected_output: 5.670108211991284
- fee_as_percent_of_gross_profit: 11649.983528063927

## Execution Path

1. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10 | swap-x-for-y | expected_bin_id=64
