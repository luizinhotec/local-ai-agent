# DOG MM Bitflow Swap Plan

- generated_at_utc: 2026-03-19T21:21:15.303Z
- mode: dry_run
- wallet_name: dog-mm-mainnet
- wallet_id: c904721f-b3c4-4056-9f67-3f806ab380b4
- sender_address: SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF
- input_token: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
- output_token: SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx
- amount_in: 12000
- amm_strategy: best
- slippage_tolerance: 3
- quote_amount_out: 8442656
- quote_min_amount_out: 8189376
- route_hops: 1
- swap_contract: SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1
- swap_function: swap-simple-multi
- nonce: 2
- fee: 4238949
- txid: 87bee6a3ed4c59d7c10f7b31298443a4feb40416603581d4daf7eef26bd7961f

## Fee Diagnostics

- tx_bytes: 614
- fee_stx: 4.238949
- fee_per_byte: 6903.825732899023
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
- input_amount_human: 0.00012
- expected_output_human: 8.442656
- min_output_human: 8.189376
- input_usd: 8.44704
- expected_output_usd: 8.442656
- min_output_usd: 8.189376
- network_fee_usd: 1.037533635138
- gross_profit_usd: -0.0043839999999999435
- worst_case_profit_usd: -0.2576640000000001
- net_profit_usd: -1.041917635138
- worst_case_net_profit_usd: -1.2951976351380001
- net_profit_bps: -1233.4707011426487
- worst_case_net_profit_bps: -1533.3153804622686
- fee_as_percent_of_input: 12.282807174323787
- fee_as_percent_of_expected_output: 12.289185241445347
- fee_as_percent_of_gross_profit: 23666.36941464447

## Execution Path

1. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10 | swap-x-for-y | expected_bin_id=64
