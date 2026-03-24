# DOG MM Bitflow Swap Plan

- generated_at_utc: 2026-03-20T04:03:15.583Z
- mode: dry_run
- wallet_name: dog-mm-mainnet
- wallet_id: c904721f-b3c4-4056-9f67-3f806ab380b4
- sender_address: SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF
- input_token: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
- output_token: SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx
- amount_in: 269580
- amm_strategy: best
- slippage_tolerance: 3
- quote_amount_out: 190044325
- quote_min_amount_out: 184342995
- route_hops: 1
- swap_contract: SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1
- swap_function: swap-simple-multi
- nonce: 2
- fee: 255814
- txid: dbb98c2d4cce171bdd6b58b51688caa7d380d589c31fd461269d7262131fdaf1

## Fee Diagnostics

- tx_bytes: 614
- fee_stx: 0.255814
- fee_per_byte: 416.63517915309444
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
- input_amount_human: 0.0026958
- expected_output_human: 190.044325
- min_output_human: 184.342995
- input_usd: n/a
- expected_output_usd: 190.044325
- min_output_usd: 184.342995
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

1. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10 | swap-x-for-y | expected_bin_id=66
