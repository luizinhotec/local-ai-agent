# DOG MM Bitflow Swap Plan

- generated_at_utc: 2026-03-20T06:01:26.388Z
- mode: dry_run
- wallet_name: dog-mm-mainnet
- wallet_id: c904721f-b3c4-4056-9f67-3f806ab380b4
- sender_address: SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF
- input_token: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
- output_token: SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx
- amount_in: 673950
- amm_strategy: best
- slippage_tolerance: 3
- quote_amount_out: 474842322
- quote_min_amount_out: 460597052
- route_hops: 2
- swap_contract: SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1
- swap_function: swap-simple-multi
- nonce: 2
- fee: 1805878
- txid: 731ca0c0c11e8693e6d1fe6670944d7e96e5a373d5b561d8c057fc07925aaabf

## Fee Diagnostics

- tx_bytes: 968
- fee_stx: 1.805878
- fee_per_byte: 1865.5764462809918
- post_condition_count: 4
- typed_parameter_count: 2
- execution_path_length: 5

## Profit Diagnostics

- complete: false
- missing_fields: inputTokenUsd, stxUsd
- input_token_decimals: 8
- output_token_decimals: 6
- input_token_usd: n/a
- output_token_usd: 1
- stx_usd: n/a
- input_amount_human: 0.0067395
- expected_output_human: 474.842322
- min_output_human: 460.597052
- input_usd: n/a
- expected_output_usd: 474.842322
- min_output_usd: 460.597052
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

1. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-1-bps-15 | swap-y-for-x | expected_bin_id=-110
2. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-1-bps-15 | swap-y-for-x | expected_bin_id=-109
3. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-1-bps-15 | swap-y-for-x | expected_bin_id=-108
4. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-sbtc-v-1-bps-15 | swap-y-for-x | expected_bin_id=-107
5. SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-stx-usdcx-v-1-bps-10 | swap-x-for-y | expected_bin_id=-94
