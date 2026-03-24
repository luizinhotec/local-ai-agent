#!/usr/bin/env node

const {
  loadEvents,
  loadStrategy,
  buildRounds,
  summarize,
  recommend,
  buildRecommendedPatch,
} = require('./lib/deribit-calibration.cjs');

function printSummary(summary, recommendation, notes, patch) {
  console.log(`entries: ${summary.entryCount}`);
  console.log(`exits: ${summary.exitCount}`);
  console.log(`closed_rounds: ${summary.closedRounds}`);
  console.log(`paired_rounds: ${summary.pairedRounds}`);
  console.log(`paired_rate: ${summary.pairedRate ?? 'n/a'}`);
  console.log(`ambiguous_rounds: ${summary.ambiguousRounds}`);
  console.log(`ambiguous_rate: ${summary.ambiguousRate ?? 'n/a'}`);
  console.log(`ambiguous_breakdown: ${JSON.stringify(summary.ambiguousBreakdown)}`);
  console.log(`ambiguous_subtype_breakdown: ${JSON.stringify(summary.ambiguousSubtypeBreakdown)}`);
  console.log(`excluded_from_hold_metrics: ${summary.excludedFromHoldMetrics}`);
  console.log(`cancels: ${summary.cancelCount}`);
  console.log(`blocked_cycles: ${summary.blockedCycles}`);
  console.log(`win_rate_by_edge: ${summary.winRateByEdge ?? 'n/a'}`);
  console.log(`avg_edge_usd: ${summary.avgEdgeUsd ?? 'n/a'}`);
  console.log(`p25_edge_usd: ${summary.p25EdgeUsd ?? 'n/a'}`);
  console.log(`p50_edge_usd: ${summary.p50EdgeUsd ?? 'n/a'}`);
  console.log(`p75_edge_usd: ${summary.p75EdgeUsd ?? 'n/a'}`);
  console.log(`avg_hold_ms: ${summary.avgHoldMs ?? 'n/a'}`);
  console.log(`avg_entry_directional_edge_usd: ${summary.avgEntryDirectionalEdgeUsd ?? 'n/a'}`);
  console.log(`exit_modes: ${JSON.stringify(summary.exitModes)}`);
  console.log('recommended_strategy_patch:');
  console.log(JSON.stringify(patch, null, 2));
  console.log('recommended_full_strategy:');
  console.log(JSON.stringify({
    shortEntryPremiumUsd: recommendation.shortEntryPremiumUsd,
    longEntryDiscountUsd: recommendation.longEntryDiscountUsd,
    minDirectionalEdgeUsd: recommendation.minDirectionalEdgeUsd,
    entryConfidenceThreshold: recommendation.entryConfidenceThreshold,
  }, null, 2));
  console.log('notes:');
  for (const note of notes) {
    console.log(`- ${note}`);
  }
}

function main() {
  const events = loadEvents();
  const strategy = loadStrategy();
  const rounds = buildRounds(events);
  const summary = summarize(events, rounds);
  const { recommendation, notes } = recommend(strategy, summary);
  const patch = buildRecommendedPatch(strategy, recommendation);
  printSummary(summary, recommendation, notes, patch);
}

main();
