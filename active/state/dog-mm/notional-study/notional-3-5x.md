# DOG MM Bitflow Swap Plan

- generated_at_utc: 2026-03-20T03:54:41.462Z
- mode: dry_run
- wallet_name: dog-mm-mainnet
- wallet_id: c904721f-b3c4-4056-9f67-3f806ab380b4
- sender_address: SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF
- input_token: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
- output_token: SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx
- amount_in: 67395
- amm_strategy: best
- slippage_tolerance: 3
- quote_amount_out: 47511081
- quote_min_amount_out: 46085749
- route_hops: 1
- swap_contract: SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1
- swap_function: swap-simple-multi
- nonce: 2
- fee: 163082
- txid: 90e6571c09085d39a548800b0e4faea928c8935be7bca7eb18288ae448ac97c3

## Fee Diagnostics

- tx_bytes: 614
- fee_stx: 0.163082
- fee_per_byte: 265.6058631921824
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
- input_amount_human: 0.00067395
- expected_output_human: 47.511081
- min_output_human: 46.085749
- input_usd: n/a
- expected_output_usd: 47.511081
- min_output_usd: 46.085749
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
