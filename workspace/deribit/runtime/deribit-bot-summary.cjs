#!/usr/bin/env node

const {
  readLatestSnapshot,
  readBotState,
  readBotMetrics,
  readProcessLockStatus,
  readLatestReconcile,
  readLatestExecutionAudit,
} = require('./lib/deribit-state-store.cjs');

function formatValue(value) {
  return value === null || typeof value === 'undefined' ? 'n/a' : String(value);
}

function main() {
  const snapshot = readLatestSnapshot();
  const botState = readBotState();
  const botMetrics = readBotMetrics();
  const processLockStatus = readProcessLockStatus();
  const reconcile = readLatestReconcile();
  const executionAudit = readLatestExecutionAudit();

  if (!snapshot) {
    console.error('missing latest snapshot');
    process.exit(1);
  }

  console.log(`snapshot_at: ${snapshot.snapshotAt}`);
  console.log(`environment: ${snapshot.environment}`);
  console.log(`instrument: ${snapshot.instrument}`);
  console.log(`position: ${snapshot.positionDirection} ${snapshot.positionSizeUsd} USD`);
  console.log(`open_orders: ${snapshot.openOrderCount}`);
  console.log(`equity_btc: ${formatValue(snapshot.accountEquity)}`);
  console.log(`available_funds_btc: ${formatValue(snapshot.availableFunds)}`);

  if (botState) {
    console.log(`last_cycle_id: ${formatValue(botState.lastCycleId)}`);
    console.log(`last_cycle_started_at: ${formatValue(botState.lastCycleStartedAt)}`);
    console.log(`last_cycle_finished_at: ${formatValue(botState.lastCycleFinishedAt)}`);
    console.log(`last_cycle_duration_ms: ${formatValue(botState.lastCycleDurationMs)}`);
    console.log(`last_cycle_status: ${formatValue(botState.lastCycleStatus)}`);
    console.log(`last_cycle_skipped_because_running: ${formatValue(botState.lastCycleSkippedBecauseRunning)}`);
    console.log(`active_cycle_id: ${formatValue(botState.activeCycleId)}`);
    console.log(`skipped_because_running_count: ${formatValue(botState.skippedBecauseRunningCount)}`);
    console.log(`last_reconciled_at: ${formatValue(botState.lastReconciledAt)}`);
    console.log(`last_reconciled_trade_seq: ${formatValue(botState.lastReconciledTradeSeq)}`);
    console.log(`last_divergence_detected: ${formatValue(botState.lastDivergenceDetected)}`);
    console.log(`last_divergence_type: ${formatValue(Array.isArray(botState.lastDivergenceType) ? botState.lastDivergenceType.join(',') : botState.lastDivergenceType)}`);
    console.log(`unexpected_position_open: ${formatValue(botState.unexpectedPositionOpen)}`);
    console.log(`partial_fill_detected: ${formatValue(botState.partialFillDetected)}`);
    console.log(`last_action: ${formatValue(botState.lastAction)}`);
    console.log(`last_execution_mode: ${formatValue(botState.lastExecutionMode)}`);
    console.log(`last_reduce_reason: ${formatValue(botState.lastReduceReason)}`);
    console.log(`consecutive_losing_exits: ${formatValue(botState.consecutiveLosingExits)}`);
    console.log(`consecutive_winning_exits: ${formatValue(botState.consecutiveWinningExits)}`);
    console.log(`pause_entries_until: ${formatValue(botState.pauseEntriesUntil)}`);
    console.log(`global_pause_until: ${formatValue(botState.globalPauseUntil)}`);
  }

  if (botMetrics) {
    console.log(`metrics_cycle_count: ${formatValue(botMetrics.cycleCount)}`);
    console.log(`metrics_skipped_because_running_count: ${formatValue(botMetrics.skippedBecauseRunningCount)}`);
    console.log(`metrics_entry_executions: ${formatValue(botMetrics.entryExecutions)}`);
    console.log(`metrics_exit_executions: ${formatValue(botMetrics.exitExecutions)}`);
    console.log(`metrics_cancel_executions: ${formatValue(botMetrics.cancelExecutions)}`);
    console.log(`metrics_blocked_cycles: ${formatValue(botMetrics.blockedCycles)}`);
    console.log(`metrics_dry_run_cycles: ${formatValue(botMetrics.dryRunCycles)}`);
    console.log(`metrics_equity_delta_btc: ${formatValue(botMetrics.equityDeltaBtc)}`);
    console.log(`metrics_realized_pnl_btc: ${formatValue(botMetrics.estimatedRealizedPnlBtc)}`);
    console.log(`metrics_last_cycle_pnl_btc: ${formatValue(botMetrics.lastCyclePnlBtc)}`);
    console.log(`metrics_last_trade_seq: ${formatValue(botMetrics.lastReconciledTradeSeq)}`);
    console.log(`metrics_last_realized_pnl_btc: ${formatValue(botMetrics.lastRealizedPnlBtc)}`);
    console.log(`metrics_cumulative_realized_pnl_btc: ${formatValue(botMetrics.cumulativeRealizedPnlBtc)}`);
    console.log(`metrics_last_fees_btc: ${formatValue(botMetrics.lastFeesBtc)}`);
    console.log(`metrics_cumulative_fees_btc: ${formatValue(botMetrics.cumulativeFeesBtc)}`);
    console.log(`metrics_last_avg_fill_price: ${formatValue(botMetrics.lastAvgFillPrice)}`);
    console.log(`metrics_last_filled_amount: ${formatValue(botMetrics.lastFilledAmount)}`);
  }

  if (processLockStatus) {
    console.log(`process_lock_status: ${formatValue(processLockStatus.status)}`);
    console.log(`process_lock_recorded_at: ${formatValue(processLockStatus.recordedAt)}`);
    console.log(`process_lock_owner_pid: ${formatValue(processLockStatus.owner?.pid)}`);
    console.log(`process_lock_owner_host: ${formatValue(processLockStatus.owner?.hostname)}`);
    console.log(`process_lock_path: ${formatValue(processLockStatus.lockPath)}`);
  }

  if (reconcile) {
    console.log(`reconcile_at: ${formatValue(reconcile.reconciledAt)}`);
    console.log(`reconcile_divergence_detected: ${formatValue(reconcile.divergenceDetected)}`);
    console.log(`reconcile_divergence_type: ${formatValue(Array.isArray(reconcile.divergenceType) ? reconcile.divergenceType.join(',') : reconcile.divergenceType)}`);
    console.log(`reconcile_trade_count: ${formatValue(reconcile.tradeSummary?.recentTradeCount)}`);
    console.log(`reconcile_new_trade_count: ${formatValue(reconcile.tradeSummary?.newTradeCount)}`);
    console.log(`reconcile_realized_pnl_btc: ${formatValue(reconcile.tradeSummary?.realizedPnl)}`);
    console.log(`reconcile_fees_btc: ${formatValue(reconcile.tradeSummary?.fees)}`);
    console.log(`reconcile_avg_fill_price: ${formatValue(reconcile.tradeSummary?.avgFillPrice)}`);
    console.log(`reconcile_filled_amount: ${formatValue(reconcile.tradeSummary?.filledAmount)}`);
  }

  if (executionAudit) {
    console.log(`execution_status: ${formatValue(executionAudit.status)}`);
    console.log(`execution_label: ${formatValue(executionAudit.orderLabel)}`);
    console.log(`execution_order_id: ${formatValue(executionAudit.orderId)}`);
    console.log(`execution_lifecycle_hint: ${formatValue(executionAudit.lifecycleHint)}`);
    console.log(`execution_last_filled_amount: ${formatValue(executionAudit.lastExchangeTradeSummary?.filledAmount)}`);
    console.log(`execution_last_avg_fill_price: ${formatValue(executionAudit.lastExchangeTradeSummary?.avgFillPrice)}`);
  }
}

main();
