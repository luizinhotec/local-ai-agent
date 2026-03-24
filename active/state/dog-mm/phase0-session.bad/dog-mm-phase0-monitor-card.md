# DOG MM Phase 0 Monitor Card

Generated at UTC: 2026-03-17T14:30:42.9120920Z

## Live Position

- open_txid: 016846ea5517449a33f42c59e0f3a4851142214d2d011b263c97056aaffc2bf8
- open_tx_status: success
- unsigned_bin_id: 603
- lp_token_amount: 33297668
- covers_active_bin: True
- live_value_usd: 23.82971111

## First 24h

- do not recenter before 12h unless there is a real risk event
- maximum recenter count: 1
- if a second recenter seems necessary, close the cycle and log the failure
- watch inventory drift, fee friction, and whether the chosen range stays useful

## Checkpoints

- t+0h: capture tx hash and open time
- t+1h: confirm position is live and note first friction impression
- t+6h: note whether inventory drift looks benign or material
- t+12h: decide whether recenter is still unnecessary
- t+24h: close, or record the reason to keep it open with explicit justification

## What To Record

- tx_hash_open
- open_tx_status
- unsigned_bin_id
- observed_bin_or_range_context
- stayed_in_range
- range_breach_detected
- recenter_needed
- friction_observed
- what_was_validated
- what_failed

