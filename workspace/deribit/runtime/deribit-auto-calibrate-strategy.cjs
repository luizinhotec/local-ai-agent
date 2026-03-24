#!/usr/bin/env node

const {
  loadEvents,
  loadStrategy,
  writeStrategy,
  loadCalibrationState,
  writeCalibrationState,
  buildRounds,
  summarize,
  summarizeRoundWindow,
  recommend,
  buildRecommendedPatch,
  shouldApplyRecommendation,
} = require('./lib/deribit-calibration.cjs');
const { appendEvent } = require('./lib/deribit-state-store.cjs');

function main() {
  const events = loadEvents();
  const strategy = loadStrategy();
  const calibrationState = loadCalibrationState();
  const rounds = buildRounds(events);
  const summary = summarize(events, rounds);
  const recentWindow = summarizeRoundWindow(rounds, 25);
  const longWindow = summarizeRoundWindow(rounds, 50);
  const { recommendation, notes } = recommend(strategy, summary);
  const patch = buildRecommendedPatch(strategy, recommendation);
  const gate = shouldApplyRecommendation(summary, calibrationState, {
    minClosedRounds: 30,
    minNewClosedRounds: 10,
    maxAmbiguousRate: 0.25,
    recentWindow,
    longWindow,
  });

  console.log(`closed_rounds: ${summary.closedRounds}`);
  console.log(`paired_rate: ${summary.pairedRate}`);
  console.log(`ambiguous_rate: ${summary.ambiguousRate}`);
  console.log(`ambiguous_breakdown: ${JSON.stringify(summary.ambiguousBreakdown)}`);
  console.log(`ambiguous_subtype_breakdown: ${JSON.stringify(summary.ambiguousSubtypeBreakdown)}`);
  console.log(`recent_window_ambiguous_breakdown: ${JSON.stringify(recentWindow.ambiguousBreakdown)}`);
  console.log(`recent_window_ambiguous_subtype_breakdown: ${JSON.stringify(recentWindow.ambiguousSubtypeBreakdown)}`);
  console.log(`gate: ${gate.reason}`);

  if (!gate.ok) {
    return;
  }

  if (Object.keys(patch).length === 0) {
    console.log('no strategy changes to apply');
    return;
  }

  writeStrategy(recommendation);
  const state = {
    lastAppliedAt: new Date().toISOString(),
    lastAppliedClosedRounds: summary.closedRounds,
    appliedPatch: patch,
    notes,
  };
  writeCalibrationState(state);
  appendEvent({
    recordedAt: state.lastAppliedAt,
    type: 'strategy_calibration_applied',
    closedRounds: summary.closedRounds,
    patch,
    notes,
  });

  console.log('applied_patch:');
  console.log(JSON.stringify(patch, null, 2));
}

main();
