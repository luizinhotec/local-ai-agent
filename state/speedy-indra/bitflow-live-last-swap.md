# DOG MM Bitflow Swap Plan

- generated_at_utc: 2026-03-22T14:04:36.208Z
- mode: broadcast
- wallet_name: leather
- wallet_id: 11ecfa52-f8c1-4e8f-a305-dedc8fd8a427
- sender_address: SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT
- input_token: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
- output_token: SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx
- amount_in: 3000
- amm_strategy: best
- slippage_tolerance: 3
- quote_amount_out: 2050318
- quote_min_amount_out: 1988808
- route_hops: 1
- swap_contract: SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1
- swap_function: swap-simple-multi
- nonce: 16
- fee: 10813102
- txid: 3a65ef588937846e29bf2f1850f4007d65e1d5bb75949a3ac743ab4fd63617a8

## Fee Diagnostics

- tx_bytes: 614
- fee_stx: 10.813102
- fee_per_byte: 17610.915309446253
- post_condition_count: 2
- typed_parameter_count: 1
- execution_path_length: 3

## Profit Diagnostics

- complete: false
- missing_fields: inputTokenUsd, stxUsd
- input_token_decimals: 8
- output_token_decimals: 6
- input_token_usd: n/a
- output_token_usd: 1
- stx_usd: n/a
- input_amount_human: 0.00003
- expected_output_human: 2.050318
- min_output_human: 1.988808
- input_usd: n/a
- expected_output_usd: 2.050318
- min_output_usd: 1.988808
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

1. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10 | swap-x-for-y | expected_bin_id=36
2. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10 | swap-x-for-y | expected_bin_id=35
3. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10 | swap-x-for-y | expected_bin_id=34

## Broadcast

- response: {"txid":"3a65ef588937846e29bf2f1850f4007d65e1d5bb75949a3ac743ab4fd63617a8"}
