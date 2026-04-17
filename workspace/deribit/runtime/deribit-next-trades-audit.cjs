#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  loadEvents,
  buildRounds,
} = require('./lib/deribit-calibration.cjs');
const {
  readBotMetrics,
  readBotState,
  readLatestSnapshot,
  readLatestReconcile,
} = require('./lib/deribit-state-store.cjs');

const BASELINE_PATH = path.join(__dirname, '..', 'state', 'deribit-next-trades-baseline.json');

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline(payload) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2));
}

function format(value) {
  return value === null || typeof value === 'undefined' ? 'n/a' : String(value);
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function parseArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function buildExitModeBreakdown(rounds) {
  return rounds.reduce((acc, round) => {
    const key = round.exitMode || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function summarizeRounds(rounds) {
  const paired = rounds.filter(round => round.paired);
  const ambiguous = rounds.filter(round => round.ambiguous);
  const winners = paired.filter(round => Number.isFinite(round.edgeUsd) && round.edgeUsd > 0);
  const losers = paired.filter(round => Number.isFinite(round.edgeUsd) && round.edgeUsd < 0);
  const avgEdgeUsd =
    paired.length > 0
      ? round(paired.reduce((sum, roundItem) => sum + (Number(roundItem.edgeUsd) || 0), 0) / paired.length, 4)
      : null;
  const avgHoldMs =
    paired.filter(round => Number.isFinite(round.holdMs)).length > 0
      ? round(
          paired
            .filter(round => Number.isFinite(round.holdMs))
            .reduce((sum, roundItem) => sum + roundItem.holdMs, 0) /
            paired.filter(round => Number.isFinite(round.holdMs)).length,
          2
        )
      : null;

  return {
    closedRounds: rounds.length,
    pairedRounds: paired.length,
    ambiguousRounds: ambiguous.length,
    winRate: paired.length > 0 ? round(winners.length / paired.length, 4) : null,
    avgEdgeUsd,
    avgHoldMs,
    winners: winners.length,
    losers: losers.length,
    exitModes: buildExitModeBreakdown(paired),
  };
}

function buildBaseline() {
  const metrics = readBotMetrics();
  const botState = readBotState();
  const reconcile = readLatestReconcile();
  const snapshot = readLatestSnapshot();
  const payload = {
    createdAt: new Date().toISOString(),
    lastTradeSeq: Number(metrics?.lastReconciledTradeSeq || botState?.lastReconciledTradeSeq || reconcile?.tradeSummary?.lastTradeSeq || 0),
    cycleCount: Number(metrics?.cycleCount || botState?.cycleCount || 0),
    entryExecutions: Number(metrics?.entryExecutions || 0),
    exitExecutions: Number(metrics?.exitExecutions || 0),
    cancelExecutions: Number(metrics?.cancelExecutions || 0),
    cumulativeRealizedPnlBtc: Number(metrics?.cumulativeRealizedPnlBtc || 0),
    cumulativeFeesBtc: Number(metrics?.cumulativeFeesBtc || 0),
    positionDirection: snapshot?.positionDirection || 'unknown',
    positionSizeUsd: Number(snapshot?.positionSizeUsd || 0),
  };
  writeBaseline(payload);
  return payload;
}

function main() {
  if (hasFlag('--baseline-now')) {
    const payload = buildBaseline();
    console.log(`baseline_path: ${BASELINE_PATH}`);
    console.log(`baseline_created_at: ${payload.createdAt}`);
    console.log(`baseline_last_trade_seq: ${payload.lastTradeSeq}`);
    console.log(`baseline_cycle_count: ${payload.cycleCount}`);
    console.log(`baseline_entry_executions: ${payload.entryExecutions}`);
    console.log(`baseline_exit_executions: ${payload.exitExecutions}`);
    return;
  }

  const baseline = readBaseline();
  if (!baseline) {
    console.error('missing deribit-next-trades-baseline.json; run with --baseline-now first');
    process.exit(1);
  }

  const events = loadEvents();
  const rounds = buildRounds(events);
  const baselineTimeMs = new Date(baseline.createdAt).getTime();
  const roundsSinceBaseline = rounds.filter(round => {
    const exitAtMs = round.exitAt ? new Date(round.exitAt).getTime() : NaN;
    const entryAtMs = round.entryAt ? new Date(round.entryAt).getTime() : NaN;
    return (
      (Number.isFinite(exitAtMs) && exitAtMs >= baselineTimeMs) ||
      (Number.isFinite(entryAtMs) && entryAtMs >= baselineTimeMs)
    );
  });

  const summary = summarizeRounds(roundsSinceBaseline);
  const metrics = readBotMetrics();
  const botState = readBotState();
  const snapshot = readLatestSnapshot();
  const realizedDeltaBtc =
    metrics ? round(Number(metrics.cumulativeRealizedPnlBtc || 0) - Number(baseline.cumulativeRealizedPnlBtc || 0)) : null;
  const feesDeltaBtc =
    metrics ? round(Number(metrics.cumulativeFeesBtc || 0) - Number(baseline.cumulativeFeesBtc || 0)) : null;

  console.log(`baseline_created_at: ${baseline.createdAt}`);
  console.log(`baseline_last_trade_seq: ${baseline.lastTradeSeq}`);
  console.log(`baseline_cycle_count: ${baseline.cycleCount}`);
  console.log(`current_last_trade_seq: ${format(metrics?.lastReconciledTradeSeq ?? botState?.lastReconciledTradeSeq)}`);
  console.log(`current_cycle_count: ${format(metrics?.cycleCount ?? botState?.cycleCount)}`);
  console.log(`new_closed_rounds: ${summary.closedRounds}`);
  console.log(`new_paired_rounds: ${summary.pairedRounds}`);
  console.log(`new_ambiguous_rounds: ${summary.ambiguousRounds}`);
  console.log(`new_win_rate: ${format(summary.winRate)}`);
  console.log(`new_avg_edge_usd: ${format(summary.avgEdgeUsd)}`);
  console.log(`new_avg_hold_ms: ${format(summary.avgHoldMs)}`);
  console.log(`new_winners: ${summary.winners}`);
  console.log(`new_losers: ${summary.losers}`);
  console.log(`new_exit_modes: ${JSON.stringify(summary.exitModes)}`);
  console.log(`realized_pnl_delta_btc: ${format(realizedDeltaBtc)}`);
  console.log(`fees_delta_btc: ${format(feesDeltaBtc)}`);
  console.log(`current_position: ${format(snapshot?.positionDirection)} ${format(snapshot?.positionSizeUsd)} USD`);
  console.log(`current_open_orders: ${format(snapshot?.openOrderCount)}`);
  console.log(`last_execution_mode: ${format(botState?.lastExecutionMode)}`);
  console.log(`last_reduce_reason: ${format(botState?.lastReduceReason)}`);

  if (summary.closedRounds === 0) {
    console.log('assessment: no new closed rounds since baseline yet');
    return;
  }

  if ((summary.winRate ?? 0) >= 0.6 && (summary.avgEdgeUsd ?? 0) > 0) {
    console.log('assessment: recent sample is promising');
    return;
  }

  if ((summary.avgEdgeUsd ?? 0) <= 0) {
    console.log('assessment: recent sample still has negative edge');
    return;
  }

  console.log('assessment: recent sample is mixed and still needs more trades');
}

main();
