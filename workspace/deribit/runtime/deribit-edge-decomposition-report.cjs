#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadEvents, buildRounds, summarize } = require('./lib/deribit-calibration.cjs');
const { buildEconomicRounds, average, median } = require('./deribit-economic-viability-report.cjs');

const REPORT_PATH = path.join(__dirname, '..', 'state', 'deribit-edge-decomposition-report.json');

function buildHoldBucket(holdMs) {
  if (!Number.isFinite(holdMs)) {
    return 'unknown';
  }
  if (holdMs < 30000) {
    return 'lt_30s';
  }
  if (holdMs < 60000) {
    return '30s_to_60s';
  }
  if (holdMs < 120000) {
    return '60s_to_120s';
  }
  return 'gte_120s';
}

function buildEdgeBucket(edgeUsd) {
  if (!Number.isFinite(edgeUsd)) {
    return 'unknown';
  }
  if (edgeUsd <= -20) {
    return 'lte_-20';
  }
  if (edgeUsd <= -5) {
    return '-20_to_-5';
  }
  if (edgeUsd < 5) {
    return '-5_to_5';
  }
  if (edgeUsd < 20) {
    return '5_to_20';
  }
  return 'gte_20';
}

function summarizeSegment(rounds) {
  const paired = rounds.filter(round => round.paired);
  const knownCost = paired.filter(round => round.hasKnownCost);
  const profitable = knownCost.filter(round => Number.isFinite(round.edgeUsd - round.totalCostUsd) && round.edgeUsd - round.totalCostUsd > 0);
  const netValues = knownCost
    .map(round => (Number.isFinite(round.edgeUsd) && Number.isFinite(round.totalCostUsd) ? round.edgeUsd - round.totalCostUsd : null))
    .filter(value => Number.isFinite(value));

  return {
    rounds: rounds.length,
    paired_rounds: paired.length,
    win_rate: paired.length > 0 ? Number((paired.filter(round => Number.isFinite(round.edgeUsd) && round.edgeUsd > 0).length / paired.length).toFixed(4)) : null,
    avg_edge_usd: average(paired.map(round => round.edgeUsd)),
    median_edge_usd: median(paired.map(round => round.edgeUsd)),
    avg_hold_ms: average(paired.map(round => round.holdMs)),
    fee_coverage_rate: paired.length > 0 ? Number((knownCost.filter(round => Number.isFinite(round.entryFeeUsd) || Number.isFinite(round.exitFeeUsd)).length / paired.length).toFixed(4)) : null,
    cost_coverage_rate: paired.length > 0 ? Number((knownCost.length / paired.length).toFixed(4)) : null,
    avg_net_edge_usd: average(netValues),
    profitability_rate: knownCost.length > 0 ? Number((profitable.length / knownCost.length).toFixed(4)) : null,
  };
}

function summarizeGrouped(rounds, selector) {
  const buckets = new Map();
  for (const round of rounds) {
    const key = selector(round);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(round);
  }
  return Object.fromEntries(
    [...buckets.entries()].map(([key, bucketRounds]) => [key, summarizeSegment(bucketRounds)])
  );
}

function summarizeWindows(rounds) {
  const windows = {
    total: rounds,
    50: rounds.slice(-50),
    25: rounds.slice(-25),
    10: rounds.slice(-10),
  };

  return Object.fromEntries(
    Object.entries(windows).map(([key, windowRounds]) => [key, {
      summary: summarizeSegment(windowRounds),
      by_entry_direction: summarizeGrouped(windowRounds, round => round.direction || 'unknown'),
      by_exit_mode: summarizeGrouped(windowRounds, round => round.exitMode || 'unknown'),
      by_hold_bucket: summarizeGrouped(windowRounds, round => buildHoldBucket(round.holdMs)),
      by_edge_bucket: summarizeGrouped(windowRounds, round => buildEdgeBucket(round.edgeUsd)),
    }])
  );
}

function flattenSegments(windowed) {
  const flattened = [];
  for (const [windowName, groups] of Object.entries(windowed)) {
    for (const [groupName, segments] of Object.entries(groups)) {
      if (groupName === 'summary') {
        continue;
      }
      for (const [segmentKey, summary] of Object.entries(segments)) {
        flattened.push({
          window: windowName,
          group: groupName,
          segment: segmentKey,
          ...summary,
        });
      }
    }
  }
  return flattened;
}

function pickWorstSegments(flattened) {
  const usable = flattened.filter(segment => segment.paired_rounds > 0);
  const mostNegativeEdge = [...usable]
    .filter(segment => Number.isFinite(segment.avg_edge_usd))
    .sort((a, b) => a.avg_edge_usd - b.avg_edge_usd)
    .slice(0, 5);
  const worstWinRate = [...usable]
    .filter(segment => Number.isFinite(segment.win_rate))
    .sort((a, b) => a.win_rate - b.win_rate || a.avg_edge_usd - b.avg_edge_usd)
    .slice(0, 5);
  const longestHold = [...usable]
    .filter(segment => Number.isFinite(segment.avg_hold_ms))
    .sort((a, b) => b.avg_hold_ms - a.avg_hold_ms)
    .slice(0, 5);
  return { mostNegativeEdge, worstWinRate, longestHold };
}

function buildFinalDiagnosis(baseSummary, costCoverageRate, worstSegments) {
  const hypotheses = [];
  const worstExitModes = worstSegments.mostNegativeEdge.filter(segment => segment.group === 'by_exit_mode');
  const worstDirections = worstSegments.mostNegativeEdge.filter(segment => segment.group === 'by_entry_direction');
  const longHold = worstSegments.longestHold.some(segment => (segment.avg_hold_ms ?? 0) > 90000);

  if (worstDirections.length > 0) {
    hypotheses.push(`entry problem likely concentrated in ${worstDirections[0].segment}`);
  }
  if (worstExitModes.length > 0) {
    hypotheses.push(`exit problem likely concentrated in ${worstExitModes[0].segment}`);
  }
  if (longHold) {
    hypotheses.push('duration/hold appears to amplify losses in the slowest segments');
  }
  if ((costCoverageRate ?? 0) < 0.25) {
    hypotheses.push('cost coverage is still too low to fully trust net profitability');
  }
  if ((baseSummary.avgEdgeUsd ?? 0) < 0) {
    hypotheses.push('gross edge is already negative before full cost attribution');
  }

  return hypotheses;
}

function main() {
  const events = loadEvents();
  const baseRounds = buildRounds(events);
  const baseSummary = summarize(events, baseRounds);
  const economicRounds = buildEconomicRounds(events).filter(round => round.paired);
  const windows = summarizeWindows(economicRounds);
  const flattened = flattenSegments(windows);
  const worstSegments = pickWorstSegments(flattened);
  const knownCostRounds = economicRounds.filter(round => round.hasKnownCost);
  const roundsWithAnyFee = economicRounds.filter(
    round => Number.isFinite(round.entryFeeUsd) || Number.isFinite(round.exitFeeUsd)
  );
  const feeCoverageRate = economicRounds.length > 0 ? Number((roundsWithAnyFee.length / economicRounds.length).toFixed(4)) : null;
  const costCoverageRate = economicRounds.length > 0 ? Number((knownCostRounds.length / economicRounds.length).toFixed(4)) : null;
  const diagnosis = buildFinalDiagnosis(baseSummary, costCoverageRate, worstSegments);

  const report = {
    generatedAt: new Date().toISOString(),
    base_summary: {
      closed_rounds: baseSummary.closedRounds,
      paired_rounds: baseSummary.pairedRounds,
      ambiguous_rounds: baseSummary.ambiguousRounds,
      paired_rate: baseSummary.pairedRate,
      ambiguous_rate: baseSummary.ambiguousRate,
      avg_edge_usd: baseSummary.avgEdgeUsd,
      median_edge_usd: baseSummary.p50EdgeUsd,
      avg_hold_ms: baseSummary.avgHoldMs,
      win_rate: baseSummary.winRateByEdge,
    },
    coverage: {
      fee_coverage_rate: feeCoverageRate,
      cost_coverage_rate: costCoverageRate,
      rounds_with_fee_data: roundsWithAnyFee.length,
      rounds_with_total_cost_data: knownCostRounds.length,
      paired_rounds_total: economicRounds.length,
    },
    windows,
    worst_segments: worstSegments,
    diagnosis,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`closed_rounds: ${report.base_summary.closed_rounds}`);
  console.log(`paired_rounds: ${report.base_summary.paired_rounds}`);
  console.log(`ambiguous_rounds: ${report.base_summary.ambiguous_rounds}`);
  console.log(`paired_rate: ${report.base_summary.paired_rate ?? 'n/a'}`);
  console.log(`ambiguous_rate: ${report.base_summary.ambiguous_rate ?? 'n/a'}`);
  console.log(`win_rate: ${report.base_summary.win_rate ?? 'n/a'}`);
  console.log(`avg_edge_usd: ${report.base_summary.avg_edge_usd ?? 'n/a'}`);
  console.log(`median_edge_usd: ${report.base_summary.median_edge_usd ?? 'n/a'}`);
  console.log(`avg_hold_ms: ${report.base_summary.avg_hold_ms ?? 'n/a'}`);
  console.log(`fee_coverage_rate: ${report.coverage.fee_coverage_rate ?? 'n/a'}`);
  console.log(`cost_coverage_rate: ${report.coverage.cost_coverage_rate ?? 'n/a'}`);
  console.log(`diagnosis:`);
  for (const item of report.diagnosis) {
    console.log(`- ${item}`);
  }
  console.log(`report_path: ${REPORT_PATH}`);
}

main();
