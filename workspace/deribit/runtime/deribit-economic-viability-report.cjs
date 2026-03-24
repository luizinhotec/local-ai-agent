#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  loadEvents,
  buildRounds,
  summarize,
} = require('./lib/deribit-calibration.cjs');

const REPORT_PATH = path.join(__dirname, '..', 'state', 'deribit-economic-viability-report.json');

function average(values) {
  const valid = values.filter(value => Number.isFinite(value));
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function percentile(values, p) {
  const valid = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (valid.length === 0) {
    return null;
  }
  const idx = Math.min(valid.length - 1, Math.max(0, Math.floor((valid.length - 1) * p)));
  return valid[idx];
}

function median(values) {
  return percentile(values, 0.5);
}

function isEntryEvent(event) {
  return event.type === 'bot_execution_sent' && (event.action === 'buy' || event.action === 'sell');
}

function isExitEvent(event) {
  return event.type === 'bot_execution_sent' && event.action === 'reduce';
}

function getEventTime(event) {
  const timestamp = new Date(event?.recordedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getEventAmount(event) {
  const amount = Number(
    event?.orderIntent?.amount ??
      event?.result?.order?.amount ??
      event?.result?.order?.filled_amount
  );
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function getEventPrice(event) {
  const price = Number(
    event?.orderIntent?.price ??
      event?.result?.order?.price ??
      event?.result?.order?.average_price
  );
  return Number.isFinite(price) ? price : null;
}

function computeRoundEdgeUsd(entryPrice, exitPrice, direction) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice)) {
    return null;
  }
  if (direction === 'sell') {
    return Number((entryPrice - exitPrice).toFixed(4));
  }
  if (direction === 'buy') {
    return Number((exitPrice - entryPrice).toFixed(4));
  }
  return null;
}

function computeHoldMs(entryAt, exitAt) {
  const start = new Date(entryAt).getTime();
  const end = new Date(exitAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return Math.max(0, end - start);
}

function getTradesFromEvent(event) {
  return Array.isArray(event?.result?.trades) ? event.result.trades : [];
}

function convertTradeFeeToUsd(trade) {
  const fee = Number(trade?.fee);
  const price = Number(trade?.price ?? trade?.index_price ?? trade?.mark_price);
  if (!Number.isFinite(fee) || !Number.isFinite(price)) {
    return null;
  }
  const feeUsd = Math.abs(fee) * price;
  return Number(feeUsd.toFixed(8));
}

function summarizeTradeCost(event) {
  const trades = getTradesFromEvent(event);
  const feeUsdValues = trades
    .map(convertTradeFeeToUsd)
    .filter(value => Number.isFinite(value));
  const feeUsd = feeUsdValues.length > 0
    ? Number(feeUsdValues.reduce((sum, value) => sum + value, 0).toFixed(8))
    : null;
  return {
    tradeCount: trades.length,
    feeUsd,
    hasKnownCost: Number.isFinite(feeUsd),
  };
}

function createEconomicRoundFromEntry(event) {
  const amount = getEventAmount(event);
  const entryCost = summarizeTradeCost(event);
  return {
    entryAt: event.recordedAt,
    exitAt: null,
    direction: event.orderIntent?.direction || 'unknown',
    entryMode: event.orderIntent?.decision?.executionMode || 'unknown',
    exitMode: null,
    entryPrice: getEventPrice(event),
    exitPrice: null,
    holdMs: null,
    edgeUsd: null,
    intendedAmount: amount,
    remainingAmount: amount,
    exitAmount: 0,
    exitValue: 0,
    paired: false,
    ambiguous: false,
    reason: null,
    entryFeeUsd: entryCost.feeUsd,
    exitFeeUsd: null,
    totalCostUsd: entryCost.feeUsd,
    hasKnownCost: entryCost.hasKnownCost,
  };
}

function finalizeEconomicRound(round, overrides = {}) {
  return {
    ...round,
    ...overrides,
  };
}

function buildEconomicRounds(events) {
  const ordered = events
    .filter(event => isEntryEvent(event) || isExitEvent(event))
    .map((event, index) => ({ event, index, time: getEventTime(event) }))
    .sort((a, b) => {
      if (a.time === null && b.time === null) {
        return a.index - b.index;
      }
      if (a.time === null) {
        return 1;
      }
      if (b.time === null) {
        return -1;
      }
      if (a.time !== b.time) {
        return a.time - b.time;
      }
      return a.index - b.index;
    });

  const rounds = [];
  let activeRound = null;

  for (const { event } of ordered) {
    if (isEntryEvent(event)) {
      if (activeRound) {
        rounds.push(finalizeEconomicRound(activeRound, {
          ambiguous: true,
          reason: 'overlapping_entry',
        }));
      }
      activeRound = createEconomicRoundFromEntry(event);
      continue;
    }

    if (!activeRound) {
      rounds.push({
        entryAt: null,
        exitAt: event.recordedAt,
        direction: 'unknown',
        entryMode: 'unknown',
        exitMode: event.orderIntent?.decision?.executionMode || 'unknown',
        entryPrice: null,
        exitPrice: getEventPrice(event),
        holdMs: null,
        edgeUsd: null,
        intendedAmount: null,
        remainingAmount: null,
        exitAmount: getEventAmount(event),
        exitValue: null,
        paired: false,
        ambiguous: true,
        reason: 'exit_without_entry',
        entryFeeUsd: null,
        exitFeeUsd: summarizeTradeCost(event).feeUsd,
        totalCostUsd: null,
        hasKnownCost: false,
      });
      continue;
    }

    const amount = getEventAmount(event);
    const price = getEventPrice(event);
    const exitCost = summarizeTradeCost(event);
    if (Number.isFinite(amount) && amount > 0) {
      activeRound.exitAmount += amount;
      if (Number.isFinite(price)) {
        activeRound.exitValue += amount * price;
      }
      if (Number.isFinite(activeRound.remainingAmount)) {
        activeRound.remainingAmount = Math.max(0, Number((activeRound.remainingAmount - amount).toFixed(8)));
      }
    } else {
      activeRound.remainingAmount = null;
    }

    activeRound.exitAt = event.recordedAt;
    activeRound.exitMode = event.orderIntent?.decision?.executionMode || 'unknown';
    activeRound.exitFeeUsd = Number.isFinite(exitCost.feeUsd) ? exitCost.feeUsd : activeRound.exitFeeUsd;

    if (Number.isFinite(activeRound.remainingAmount) && activeRound.remainingAmount > 0) {
      continue;
    }

    const exitPrice =
      Number.isFinite(activeRound.exitAmount) && activeRound.exitAmount > 0 && Number.isFinite(activeRound.exitValue)
        ? Number((activeRound.exitValue / activeRound.exitAmount).toFixed(4))
        : null;
    const totalCostUsd =
      Number.isFinite(activeRound.entryFeeUsd) && Number.isFinite(activeRound.exitFeeUsd)
        ? Number((activeRound.entryFeeUsd + activeRound.exitFeeUsd).toFixed(8))
        : null;

    rounds.push(finalizeEconomicRound(activeRound, {
      exitPrice,
      edgeUsd: computeRoundEdgeUsd(activeRound.entryPrice, exitPrice, activeRound.direction),
      holdMs: computeHoldMs(activeRound.entryAt, activeRound.exitAt),
      paired: true,
      ambiguous: false,
      totalCostUsd,
      hasKnownCost: Number.isFinite(totalCostUsd),
    }));
    activeRound = null;
  }

  if (activeRound) {
    rounds.push(finalizeEconomicRound(activeRound, {
      ambiguous: true,
      reason: 'unclosed_round',
    }));
  }

  return rounds;
}

function buildDatasetQuality(baseSummary, economicRounds) {
  const pairedRounds = economicRounds.filter(round => round.paired);
  const knownCostRounds = pairedRounds.filter(round => round.hasKnownCost);
  const costCoverageRate =
    pairedRounds.length > 0 ? Number((knownCostRounds.length / pairedRounds.length).toFixed(4)) : null;

  let quality = 'weak';
  if ((baseSummary.pairedRate ?? 0) >= 0.8 && (baseSummary.ambiguousRate ?? 1) <= 0.2 && (costCoverageRate ?? 0) >= 0.5) {
    quality = 'strong';
  } else if ((baseSummary.pairedRate ?? 0) >= 0.65 && (baseSummary.ambiguousRate ?? 1) <= 0.35 && (costCoverageRate ?? 0) >= 0.2) {
    quality = 'moderate';
  }

  return {
    quality,
    costCoverageRate,
    knownCostRounds: knownCostRounds.length,
  };
}

function buildFrequencySummary(pairedRounds) {
  if (pairedRounds.length < 2) {
    return {
      roundsPerDay: null,
      assessedAs: 'insufficient_data',
    };
  }

  const start = new Date(pairedRounds[0].entryAt).getTime();
  const end = new Date(pairedRounds[pairedRounds.length - 1].exitAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return {
      roundsPerDay: null,
      assessedAs: 'insufficient_data',
    };
  }

  const elapsedDays = (end - start) / 86400000;
  const roundsPerDay = elapsedDays > 0 ? Number((pairedRounds.length / elapsedDays).toFixed(4)) : null;
  let assessedAs = 'low';
  if ((roundsPerDay ?? 0) >= 10) {
    assessedAs = 'high';
  } else if ((roundsPerDay ?? 0) >= 3) {
    assessedAs = 'moderate';
  }

  return { roundsPerDay, assessedAs };
}

function diagnoseEconomicViability(stats, datasetQuality, frequency) {
  const profitabilityRate = stats.profitabilityRate ?? 0;
  const avgNet = stats.avgNetEdgeUsd;
  const medianNet = stats.medianNetEdgeUsd;
  const quality = datasetQuality.quality;
  const costCoverageRate = datasetQuality.costCoverageRate ?? 0;

  if (
    Number.isFinite(avgNet) &&
    Number.isFinite(medianNet) &&
    avgNet > 0 &&
    medianNet > 0 &&
    profitabilityRate >= 0.55 &&
    quality !== 'weak' &&
    costCoverageRate >= 0.3
  ) {
    return 'economically_viable';
  }

  if (
    ((Number.isFinite(avgNet) && avgNet > 0) || (Number.isFinite(medianNet) && medianNet > 0)) &&
    profitabilityRate >= 0.45 &&
    quality !== 'weak'
  ) {
    return 'economically_borderline';
  }

  return 'economically_unviable';
}

function main() {
  const events = loadEvents();
  const baseRounds = buildRounds(events);
  const baseSummary = summarize(events, baseRounds);
  const economicRounds = buildEconomicRounds(events);
  const pairedEconomicRounds = economicRounds.filter(round => round.paired);
  const knownCostRounds = pairedEconomicRounds.filter(round => round.hasKnownCost);
  const unknownCostRounds = pairedEconomicRounds.filter(round => !round.hasKnownCost);

  const avgFeeUsd = average(
    knownCostRounds.flatMap(round => [round.entryFeeUsd, round.exitFeeUsd]).filter(value => Number.isFinite(value))
  );
  const avgTotalCostUsd = average(knownCostRounds.map(round => round.totalCostUsd));
  const breakEvenEdgeUsd = avgTotalCostUsd;
  const netEdgeValues = knownCostRounds
    .map(round => (Number.isFinite(round.edgeUsd) && Number.isFinite(round.totalCostUsd) ? round.edgeUsd - round.totalCostUsd : null))
    .filter(value => Number.isFinite(value));
  const avgNetEdgeUsd = average(netEdgeValues);
  const medianNetEdgeUsd = median(netEdgeValues);
  const profitableAfterCost = netEdgeValues.filter(value => value > 0).length;
  const unprofitableAfterCost = netEdgeValues.filter(value => value <= 0).length;
  const unknownCostData = unknownCostRounds.length;
  const profitabilityRate =
    knownCostRounds.length > 0 ? Number((profitableAfterCost / knownCostRounds.length).toFixed(4)) : null;
  const datasetQuality = buildDatasetQuality(baseSummary, economicRounds);
  const frequency = buildFrequencySummary(pairedEconomicRounds);
  const diagnosis = diagnoseEconomicViability(
    {
      avgNetEdgeUsd,
      medianNetEdgeUsd,
      profitabilityRate,
    },
    datasetQuality,
    frequency
  );

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      closed_rounds: baseSummary.closedRounds,
      paired_rounds: baseSummary.pairedRounds,
      ambiguous_rounds: baseSummary.ambiguousRounds,
      paired_rate: baseSummary.pairedRate,
      ambiguous_rate: baseSummary.ambiguousRate,
      win_rate: baseSummary.winRateByEdge,
      avg_edge_usd: baseSummary.avgEdgeUsd,
      median_edge_usd: baseSummary.p50EdgeUsd,
      p25_edge_usd: baseSummary.p25EdgeUsd,
      p50_edge_usd: baseSummary.p50EdgeUsd,
      p75_edge_usd: baseSummary.p75EdgeUsd,
      avg_hold_ms: baseSummary.avgHoldMs,
    },
    cost_analysis: {
      avg_fee_usd: avgFeeUsd,
      avg_total_cost_usd: avgTotalCostUsd,
      break_even_edge_usd: breakEvenEdgeUsd,
      avg_net_edge_usd: avgNetEdgeUsd,
      median_net_edge_usd: medianNetEdgeUsd,
      profitable_after_cost: profitableAfterCost,
      unprofitable_after_cost: unprofitableAfterCost,
      unknown_cost_data: unknownCostData,
      profitability_rate: profitabilityRate,
    },
    opportunity_frequency: frequency,
    dataset_quality: datasetQuality,
    diagnosis,
    proven: [
      'paired and ambiguous round quality comes from the shared calibration pipeline',
      'edge distribution is computed from paired rounds only',
      'fee cost is measured only when execution events include trade fee data',
    ],
    dependencies_and_gaps: [
      'avg_total_cost_usd currently reflects explicit trade fees found in event.result.trades',
      'rounds without trade fee data are classified as unknown_cost_data and excluded from net-edge profitability',
      'slippage beyond realized entry/exit price is already embedded in edgeUsd, but non-fee infrastructure costs are not separately measured',
    ],
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`closed_rounds: ${report.summary.closed_rounds}`);
  console.log(`paired_rounds: ${report.summary.paired_rounds}`);
  console.log(`ambiguous_rounds: ${report.summary.ambiguous_rounds}`);
  console.log(`paired_rate: ${report.summary.paired_rate ?? 'n/a'}`);
  console.log(`ambiguous_rate: ${report.summary.ambiguous_rate ?? 'n/a'}`);
  console.log(`win_rate: ${report.summary.win_rate ?? 'n/a'}`);
  console.log(`avg_edge_usd: ${report.summary.avg_edge_usd ?? 'n/a'}`);
  console.log(`median_edge_usd: ${report.summary.median_edge_usd ?? 'n/a'}`);
  console.log(`p25_edge_usd: ${report.summary.p25_edge_usd ?? 'n/a'}`);
  console.log(`p50_edge_usd: ${report.summary.p50_edge_usd ?? 'n/a'}`);
  console.log(`p75_edge_usd: ${report.summary.p75_edge_usd ?? 'n/a'}`);
  console.log(`avg_hold_ms: ${report.summary.avg_hold_ms ?? 'n/a'}`);
  console.log(`avg_fee_usd: ${report.cost_analysis.avg_fee_usd ?? 'n/a'}`);
  console.log(`avg_total_cost_usd: ${report.cost_analysis.avg_total_cost_usd ?? 'n/a'}`);
  console.log(`break_even_edge_usd: ${report.cost_analysis.break_even_edge_usd ?? 'n/a'}`);
  console.log(`avg_net_edge_usd: ${report.cost_analysis.avg_net_edge_usd ?? 'n/a'}`);
  console.log(`median_net_edge_usd: ${report.cost_analysis.median_net_edge_usd ?? 'n/a'}`);
  console.log(`profitable_after_cost: ${report.cost_analysis.profitable_after_cost}`);
  console.log(`unprofitable_after_cost: ${report.cost_analysis.unprofitable_after_cost}`);
  console.log(`unknown_cost_data: ${report.cost_analysis.unknown_cost_data}`);
  console.log(`profitability_rate: ${report.cost_analysis.profitability_rate ?? 'n/a'}`);
  console.log(`rounds_per_day: ${report.opportunity_frequency.roundsPerDay ?? 'n/a'}`);
  console.log(`dataset_quality: ${report.dataset_quality.quality}`);
  console.log(`economic_diagnosis: ${report.diagnosis}`);
  console.log(`report_path: ${REPORT_PATH}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildEconomicRounds,
  average,
  percentile,
  median,
};
