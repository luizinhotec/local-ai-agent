---
name: bitflow-liquidity-strategy-manager
description: Manage concentrated liquidity positions on Bitflow HODLMM using predefined strategy shapes (`spot`, `curve`, `bid_ask`). Use when Codex needs to inspect a Bitflow LP position, detect whether it is in range, estimate recenter value, compare strategy shapes in dry-run, recommend `HOLD`/`WATCH`/`RECENTER`/`BLOCK`, or maintain telemetry for recurring liquidity management decisions.
---

# Bitflow Liquidity Strategy Manager

Use this skill to reason about concentrated LP maintenance on Bitflow HODLMM without defaulting to unnecessary repositioning.

Keep `spot` as the baseline. Treat `curve` as the more concentrated mode. Treat `bid_ask` as the advanced asymmetric mode. Only recommend execution when expected net benefit is above estimated repositioning cost and all cooldown or daily-limit rules pass.

## Workflow

1. Read the pool state and the current position state.
2. Detect the active `strategy_shape`.
3. Measure whether the position is `in-range` and how much active liquidity remains effective.
4. Estimate the value of staying put versus `remove + reopen` with the same shape.
5. Compare alternative shapes only in `dry-run`, unless the user explicitly asks to migrate shape.
6. Apply risk gates and produce one of: `HOLD`, `WATCH`, `RECENTER`, `BLOCK`.
7. Persist telemetry by `pool_id + position_id + strategy_shape`.

## Strategy Model

### `spot`

Use as the default baseline for comparison.

- Assume simpler and more stable liquidity placement.
- Use as the first candidate when no strategy metadata is present.
- Prefer this mode when data quality is weak or reposition cost is uncertain.

### `curve`

Use as the concentrated mode.

- Assume higher fee capture near the target zone.
- Expect higher sensitivity to price movement and out-of-range drift.
- Demand stronger expected net return before recommending recenter.

### `bid_ask`

Use as the advanced asymmetric mode.

- Assume distribution can be intentionally skewed to one side.
- Require explicit confidence in pool state and shape interpretation.
- Degrade to `WATCH` or `BLOCK` when the underlying position layout cannot be reconstructed reliably.

## Required Decisions

Always compute or infer these fields:

- `strategy_shape`
- `is_in_range`
- `in_range_ratio`
- `active_liquidity_ratio`
- `estimated_fee_capture_usd`
- `estimated_recenter_cost_usd`
- `estimated_net_return_usd`
- `recommended_action`

Use these action meanings:

- `HOLD`: position is healthy and repositioning does not improve net outcome enough.
- `WATCH`: there is drift or weakening efficiency, but not enough to justify action yet.
- `RECENTER`: expected net benefit is positive and materially above cost.
- `BLOCK`: execution should not happen because of policy, uncertainty, or economics.

## Minimum Policy

Apply all of these rules:

- Do not rebalance on small price movement alone.
- Do not recommend execution when `estimated_net_return_usd <= 0`.
- Enforce a minimum edge above cost to avoid churn.
- Enforce cooldown before another recenter.
- Enforce a daily rebalance cap.
- Prefer `WATCH` over `RECENTER` when data confidence is incomplete.

## Commands

### `status-only`

Use for non-invasive inspection.

Input shape:

```json
{
  "command": "status-only",
  "pool_id": "string",
  "position_id": "string"
}
```

Return:

```json
{
  "pool_id": "string",
  "position_id": "string",
  "strategy_shape": "spot",
  "is_in_range": true,
  "in_range_ratio": 0.91,
  "active_liquidity_ratio": 0.84,
  "estimated_fee_capture_usd": 12.4,
  "estimated_recenter_cost_usd": 3.1,
  "estimated_net_return_usd": 9.3,
  "recommended_action": "WATCH"
}
```

### `dry-run`

Use to simulate `remove + reopen` while keeping the same shape.

Input shape:

```json
{
  "command": "dry-run",
  "pool_id": "string",
  "position_id": "string",
  "strategy_shape": "curve"
}
```

Return:

```json
{
  "current_shape": "curve",
  "simulated_shape": "curve",
  "action": "RECENTER",
  "estimated_fee_capture_usd": 18.7,
  "estimated_recenter_cost_usd": 5.2,
  "estimated_net_return_usd": 13.5,
  "passes_cooldown": true,
  "passes_daily_limit": true,
  "should_execute": true
}
```

### `compare-shapes`

Use to compare `spot`, `curve`, and `bid_ask` analytically without execution.

Return a JSON payload shaped like:

```json
{
  "command": "compare-shapes",
  "pool_id": "string",
  "position_id": "string",
  "results": [
    {
      "strategy_shape": "spot",
      "estimated_fee_capture_usd": 10.2,
      "estimated_recenter_cost_usd": 2.4,
      "estimated_net_return_usd": 7.8,
      "recommended_action": "HOLD"
    },
    {
      "strategy_shape": "curve",
      "estimated_fee_capture_usd": 14.1,
      "estimated_recenter_cost_usd": 5.7,
      "estimated_net_return_usd": 8.4,
      "recommended_action": "WATCH"
    },
    {
      "strategy_shape": "bid_ask",
      "estimated_fee_capture_usd": 16.5,
      "estimated_recenter_cost_usd": 9.8,
      "estimated_net_return_usd": 6.7,
      "recommended_action": "BLOCK"
    }
  ],
  "best_shape_by_net_return": "curve"
}
```

## Telemetry

Persist these metrics by strategy:

- `in_range_ratio`
- `active_liquidity_ratio`
- `rebalance_count`
- `estimated_fee_capture_usd`
- `estimated_recenter_cost_usd`
- `estimated_net_return_usd`
- `strategy_shape`
- `recommended_action`

Also persist:

- `last_rebalance_at`
- `cooldown_until`
- `daily_rebalance_count`
- simulation timestamps
- action history

Read [references/state-schema.json](references/state-schema.json) when the implementation needs a concrete state contract.

## Execution Notes

- Read Bitflow pool and position data before making any recommendation.
- Keep shape-specific logic isolated so `spot`, `curve`, and `bid_ask` can be scored independently.
- Simulate remove and reopen before proposing live execution.
- Separate analytic comparison from execution planning.
- Report uncertainty explicitly when shape detection or pool reconstruction is incomplete.

## Risks And Limits

- Fee estimates can diverge from realized fees.
- `curve` and `bid_ask` can amplify reposition frequency.
- Dry-run estimates do not guarantee executable cost at decision time.
- Shape detection depends on the quality of Bitflow/HODLMM position data.
- If pool state is incomplete, prefer `WATCH` or `BLOCK`.
