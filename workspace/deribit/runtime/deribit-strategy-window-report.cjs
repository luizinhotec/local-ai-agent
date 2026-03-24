#!/usr/bin/env node

const {
  loadEvents,
  buildRounds,
  summarizeRoundWindow,
} = require('./lib/deribit-calibration.cjs');

function format(value) {
  return value === null || typeof value === 'undefined' ? 'n/a' : String(value);
}

function buildAmbiguousBreakdown(rounds) {
  return rounds
    .filter(round => round.ambiguous)
    .reduce((acc, round) => {
      const reason = round.reason || round.ambiguousReason || 'unexpected_sequence';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
}

function buildAmbiguousSubtypeBreakdown(rounds) {
  return rounds
    .filter(round => round.ambiguous)
    .reduce((acc, round) => {
      const subtype = round.ambiguousSubtype || round.reason || round.ambiguousReason || 'unexpected_sequence';
      acc[subtype] = (acc[subtype] || 0) + 1;
      return acc;
    }, {});
}

function printWindow(summary) {
  console.log(`window_last_rounds: ${summary.window}`);
  console.log(`rounds: ${summary.rounds}`);
  console.log(`paired_rounds: ${summary.pairedRounds}`);
  console.log(`paired_rate: ${format(summary.pairedRate)}`);
  console.log(`ambiguous_rounds: ${summary.ambiguousRounds}`);
  console.log(`ambiguous_rate: ${format(summary.ambiguousRate)}`);
  console.log(`excluded_from_hold_metrics: ${summary.excludedFromHoldMetrics}`);
  console.log(`ambiguous_breakdown_by_window: ${JSON.stringify(summary.ambiguousBreakdown)}`);
  console.log(`ambiguous_subtype_breakdown_by_window: ${JSON.stringify(summary.ambiguousSubtypeBreakdown)}`);
  console.log(`win_rate_by_edge: ${format(summary.winRateByEdge)}`);
  console.log(`avg_edge_usd: ${format(summary.avgEdgeUsd)}`);
  console.log(`p25_edge_usd: ${format(summary.p25EdgeUsd)}`);
  console.log(`p50_edge_usd: ${format(summary.p50EdgeUsd)}`);
  console.log(`p75_edge_usd: ${format(summary.p75EdgeUsd)}`);
  console.log(`avg_hold_ms: ${format(summary.avgHoldMs)}`);
  console.log(`avg_entry_directional_edge_usd: ${format(summary.avgEntryDirectionalEdgeUsd)}`);
  console.log(`exit_modes: ${JSON.stringify(summary.exitModes)}`);
}

function compareTrend(windows) {
  const completed = windows.filter(window => window.rounds > 0);
  if (completed.length < 2) {
    return 'insufficient data for trend';
  }
  const smallest = completed[0];
  const largest = completed[completed.length - 1];
  const winRateDelta =
    typeof smallest.winRateByEdge === 'number' && typeof largest.winRateByEdge === 'number'
      ? Number((smallest.winRateByEdge - largest.winRateByEdge).toFixed(4))
      : null;
  const edgeDelta =
    typeof smallest.avgEdgeUsd === 'number' && typeof largest.avgEdgeUsd === 'number'
      ? Number((smallest.avgEdgeUsd - largest.avgEdgeUsd).toFixed(4))
      : null;

  if ((winRateDelta ?? 0) > 0.05 && (edgeDelta ?? 0) > 0) {
    return 'recent rounds are improving versus the longer sample';
  }
  if ((winRateDelta ?? 0) < -0.05 && (edgeDelta ?? 0) < 0) {
    return 'recent rounds are deteriorating versus the longer sample';
  }
  return 'recent rounds look mostly flat versus the longer sample';
}

function main() {
  const events = loadEvents();
  const rounds = buildRounds(events);
  const windows = [10, 25, 50].map(size => summarizeRoundWindow(rounds, size));

  console.log(`closed_rounds_total: ${rounds.length}`);
  console.log(`paired_rounds_total: ${rounds.filter(round => round.paired).length}`);
  console.log(`ambiguous_rounds_total: ${rounds.filter(round => round.ambiguous).length}`);
  console.log(`excluded_from_hold_metrics_total: ${rounds.filter(round => round.excludedFromHoldMetrics).length}`);
  console.log(`paired_rate_total: ${format(rounds.length > 0 ? Number((rounds.filter(round => round.paired).length / rounds.length).toFixed(4)) : null)}`);
  console.log(`ambiguous_rate_total: ${format(rounds.length > 0 ? Number((rounds.filter(round => round.ambiguous).length / rounds.length).toFixed(4)) : null)}`);
  console.log(`ambiguous_breakdown: ${JSON.stringify(buildAmbiguousBreakdown(rounds))}`);
  console.log(`ambiguous_subtype_breakdown: ${JSON.stringify(buildAmbiguousSubtypeBreakdown(rounds))}`);
  console.log(`trend_assessment: ${compareTrend(windows)}`);
  console.log('');
  for (const window of windows) {
    printWindow(window);
    console.log('');
  }
}

main();
