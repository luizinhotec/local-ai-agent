const fs = require('fs');
const path = require('path');

const EVENTS_PATH = path.join(__dirname, '..', '..', 'state', 'deribit-events.jsonl');
const STRATEGY_PATH = path.join(__dirname, '..', '..', 'config', 'deribit.strategy.json');
const CALIBRATION_STATE_PATH = path.join(__dirname, '..', '..', 'state', 'deribit-calibration-state.json');

function loadEvents() {
  if (!fs.existsSync(EVENTS_PATH)) {
    throw new Error('missing deribit-events.jsonl');
  }
  return fs
    .readFileSync(EVENTS_PATH, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function loadStrategy() {
  if (!fs.existsSync(STRATEGY_PATH)) {
    throw new Error('missing deribit.strategy.json');
  }
  return JSON.parse(fs.readFileSync(STRATEGY_PATH, 'utf8'));
}

function writeStrategy(strategy) {
  fs.writeFileSync(STRATEGY_PATH, JSON.stringify(strategy, null, 2));
}

function loadCalibrationState() {
  if (!fs.existsSync(CALIBRATION_STATE_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(CALIBRATION_STATE_PATH, 'utf8'));
}

function writeCalibrationState(state) {
  fs.writeFileSync(CALIBRATION_STATE_PATH, JSON.stringify(state, null, 2));
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
      event?.order?.amount ??
      event?.exchangeOrder?.amount ??
      event?.exchangeOrder?.filled_amount
  );
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function getEventPrice(event) {
  const price = Number(
    event?.orderIntent?.price ??
      event?.order?.price ??
      event?.exchangeOrder?.price ??
      event?.exchangeOrder?.average_price
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

function createRoundFromEntry(event) {
  const amount = getEventAmount(event);
  return {
    entryEventRecordedAt: event.recordedAt,
    entryAt: event.recordedAt,
    exitAt: null,
    direction: event.orderIntent?.direction || 'unknown',
    entryMode: event.orderIntent?.decision?.executionMode || 'unknown',
    entryPrice: getEventPrice(event),
    exitPrice: null,
    entryDirectionalEdgeUsd: event.snapshotContext?.directionalEdgeUsd ?? null,
    edgeUsd: null,
    holdMs: null,
    intendedAmount: amount,
    remainingAmount: amount,
    exitAmount: 0,
    exitValue: 0,
    exitModes: [],
    exitMode: null,
    paired: false,
    ambiguous: false,
    ambiguousReason: null,
    reason: null,
    ambiguousSubtype: null,
    overlapEvidence: null,
    excludedFromHoldMetrics: false,
    lastRelevantEvent: {
      type: event.type,
      action: event.action ?? null,
      recordedAt: event.recordedAt,
      direction: event.orderIntent?.direction ?? null,
      amount: amount,
      mode: event.orderIntent?.decision?.executionMode ?? null,
    },
  };
}

function cloneRound(round) {
  return {
    ...round,
    exitModes: Array.isArray(round.exitModes) ? [...round.exitModes] : [],
  };
}

function finalizeRound(round, overrides = {}) {
  const finalized = {
    ...cloneRound(round),
    ...overrides,
  };
  finalized.exitMode =
    overrides.exitMode ||
    finalized.exitMode ||
    (finalized.exitModes.length > 0 ? finalized.exitModes[finalized.exitModes.length - 1] : 'unknown');
  finalized.ambiguous = Boolean(finalized.ambiguous);
  finalized.paired = Boolean(finalized.paired) && !finalized.ambiguous;
  finalized.excludedFromHoldMetrics = Boolean(
    finalized.excludedFromHoldMetrics || !finalized.paired || !Number.isFinite(finalized.holdMs)
  );
  return finalized;
}

function finalizeCompletedRound(round) {
  const exitPrice =
    Number.isFinite(round.exitAmount) && round.exitAmount > 0 && Number.isFinite(round.exitValue)
      ? Number((round.exitValue / round.exitAmount).toFixed(4))
      : null;
  return finalizeRound(round, {
    exitPrice,
    edgeUsd: computeRoundEdgeUsd(round.entryPrice, exitPrice, round.direction),
    holdMs: computeHoldMs(round.entryAt, round.exitAt),
    paired: true,
    ambiguous: false,
    ambiguousReason: null,
    reason: null,
  });
}

function finalizeAmbiguousRound(round, reason) {
  const exitPrice =
    Number.isFinite(round.exitAmount) && round.exitAmount > 0 && Number.isFinite(round.exitValue)
      ? Number((round.exitValue / round.exitAmount).toFixed(4))
      : null;
  return finalizeRound(round, {
    exitPrice,
    edgeUsd: computeRoundEdgeUsd(round.entryPrice, exitPrice, round.direction),
    holdMs: round.exitAt ? computeHoldMs(round.entryAt, round.exitAt) : null,
    paired: false,
    ambiguous: true,
    ambiguousReason: reason,
    reason,
    excludedFromHoldMetrics: true,
  });
}

function snapshotRelevantEvent(event) {
  if (!event) {
    return null;
  }
  return {
    type: event.type,
    action: event.action ?? null,
    recordedAt: event.recordedAt ?? null,
    direction: event.orderIntent?.direction ?? null,
    amount: getEventAmount(event),
    mode: event.orderIntent?.decision?.executionMode ?? null,
  };
}

function classifyOverlapSubtype(activeRound, newEntryEvent) {
  const activeDirection = activeRound.direction || 'unknown';
  const newDirection = newEntryEvent?.orderIntent?.direction || 'unknown';
  const activeAmountBeforeOverlap = activeRound.remainingAmount ?? activeRound.intendedAmount ?? null;
  const lastRelevantAction = activeRound.lastRelevantEvent?.action || null;
  const activeEntryTime = getEventTime({ recordedAt: activeRound.entryAt });
  const newEntryTime = getEventTime(newEntryEvent);
  const overlapGapMs =
    Number.isFinite(activeEntryTime) && Number.isFinite(newEntryTime) ? Math.max(0, newEntryTime - activeEntryTime) : null;

  let subtype = 'unexpected_sequence';
  if (activeDirection !== 'unknown' && newDirection !== 'unknown' && activeDirection !== newDirection) {
    subtype = 'opposite_direction_overlap';
  } else if (lastRelevantAction === 'reduce' && Number.isFinite(activeAmountBeforeOverlap) && activeAmountBeforeOverlap > 0) {
    subtype = 'overlap_after_partial_reduce';
  } else if ((overlapGapMs ?? Infinity) <= 5000) {
    subtype = 'duplicate_entry_signal';
  } else if (lastRelevantAction === 'reduce') {
    subtype = 'entry_before_flat_confirmation';
  } else {
    subtype = 'same_direction_overlap';
  }

  return {
    subtype,
    evidence: {
      active_round_direction: activeDirection,
      new_entry_direction: newDirection,
      active_round_amount_before_overlap: activeAmountBeforeOverlap,
      active_round_timestamp: activeRound.entryAt,
      new_entry_timestamp: newEntryEvent?.recordedAt ?? null,
      last_relevant_event: activeRound.lastRelevantEvent || null,
    },
  };
}

function registerExitOnRound(round, event) {
  const amount = getEventAmount(event);
  const price = getEventPrice(event);
  const mode = event.orderIntent?.decision?.executionMode || 'unknown';
  if (Number.isFinite(amount) && amount > 0) {
    round.exitAmount += amount;
    if (Number.isFinite(price)) {
      round.exitValue += amount * price;
    }
    if (Number.isFinite(round.remainingAmount)) {
      round.remainingAmount = Math.max(0, Number((round.remainingAmount - amount).toFixed(8)));
    }
  } else {
    round.remainingAmount = null;
  }
  round.exitAt = event.recordedAt;
  round.exitModes.push(mode);
  round.exitMode = mode;
  round.lastRelevantEvent = snapshotRelevantEvent(event);
}

function buildRounds(events) {
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
        const sameDirection =
          activeRound.direction &&
          event.orderIntent?.direction &&
          activeRound.direction === event.orderIntent.direction;
        const reason = sameDirection ? 'overlapping_entry' : 'flip_without_flat';
        const overlap = classifyOverlapSubtype(activeRound, event);
        rounds.push(finalizeAmbiguousRound(activeRound, reason));
        rounds[rounds.length - 1].ambiguousSubtype = overlap.subtype;
        rounds[rounds.length - 1].overlapEvidence = overlap.evidence;
      }
      activeRound = createRoundFromEntry(event);
      continue;
    }

    if (!activeRound) {
      const orphanExit = createRoundFromEntry({
        recordedAt: event.recordedAt,
        orderIntent: {
          direction: 'unknown',
          decision: {
            executionMode: 'unknown',
          },
        },
        snapshotContext: {},
      });
      orphanExit.entryAt = null;
      orphanExit.entryPrice = null;
      orphanExit.entryDirectionalEdgeUsd = null;
      registerExitOnRound(orphanExit, event);
      rounds.push(finalizeAmbiguousRound(orphanExit, 'exit_without_entry'));
      continue;
    }

    registerExitOnRound(activeRound, event);
    if (Number.isFinite(activeRound.remainingAmount) && activeRound.remainingAmount > 0) {
      continue;
    }

    if (activeRound.remainingAmount === null && activeRound.exitAmount <= 0) {
      rounds.push(finalizeAmbiguousRound(activeRound, 'unexpected_sequence'));
      activeRound = null;
      continue;
    }

    rounds.push(finalizeCompletedRound(activeRound));
    activeRound = null;
  }

  if (activeRound) {
    rounds.push(finalizeAmbiguousRound(activeRound, 'unclosed_round'));
  }

  return rounds;
}

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

function summarizeRounds(rounds) {
  const pairedRounds = rounds.filter(round => round.paired);
  const ambiguousRounds = rounds.filter(round => round.ambiguous);
  const includedHoldRounds = pairedRounds.filter(round => !round.excludedFromHoldMetrics);
  const edgeValues = pairedRounds.map(round => round.edgeUsd);
  const positiveRounds = pairedRounds.filter(round => Number.isFinite(round.edgeUsd) && round.edgeUsd > 0).length;
  const negativeRounds = pairedRounds.filter(round => Number.isFinite(round.edgeUsd) && round.edgeUsd < 0).length;
  const neutralRounds = pairedRounds.filter(round => Number.isFinite(round.edgeUsd) && round.edgeUsd === 0).length;
  const ambiguousBreakdown = ambiguousRounds.reduce((acc, round) => {
    const reason = round.reason || round.ambiguousReason || 'unexpected_sequence';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const ambiguousSubtypeBreakdown = ambiguousRounds.reduce((acc, round) => {
    const subtype = round.ambiguousSubtype || reasonToSubtype(round.reason || round.ambiguousReason);
    acc[subtype] = (acc[subtype] || 0) + 1;
    return acc;
  }, {});
  const totalRounds = rounds.length;

  return {
    totalRounds,
    closedRounds: pairedRounds.length,
    pairedRounds: pairedRounds.length,
    ambiguousRounds: ambiguousRounds.length,
    pairedRate: totalRounds > 0 ? Number((pairedRounds.length / totalRounds).toFixed(4)) : null,
    ambiguousRate: totalRounds > 0 ? Number((ambiguousRounds.length / totalRounds).toFixed(4)) : null,
    ambiguousBreakdown,
    ambiguousSubtypeBreakdown,
    excludedFromHoldMetrics: rounds.filter(round => round.excludedFromHoldMetrics).length,
    positiveRounds,
    negativeRounds,
    neutralRounds,
    winRateByEdge: pairedRounds.length > 0 ? Number((positiveRounds / pairedRounds.length).toFixed(4)) : null,
    avgEdgeUsd: average(edgeValues),
    p25EdgeUsd: percentile(edgeValues, 0.25),
    p50EdgeUsd: percentile(edgeValues, 0.5),
    p75EdgeUsd: percentile(edgeValues, 0.75),
    avgHoldMs: average(includedHoldRounds.map(round => round.holdMs)),
    avgEntryDirectionalEdgeUsd: average(pairedRounds.map(round => round.entryDirectionalEdgeUsd)),
    exitModes: pairedRounds.reduce((acc, round) => {
      acc[round.exitMode] = (acc[round.exitMode] || 0) + 1;
      return acc;
    }, {}),
  };
}

function reasonToSubtype(reason) {
  if (reason === 'flip_without_flat') {
    return 'opposite_direction_overlap';
  }
  if (reason === 'overlapping_entry') {
    return 'same_direction_overlap';
  }
  return reason || 'unexpected_sequence';
}

function summarize(events, rounds) {
  const entryCount = events.filter(isEntryEvent).length;
  const exitCount = events.filter(isExitEvent).length;
  const cancelCount = events.filter(event => event.type === 'bot_cancel_stale_order').length;
  const blockedCycles = events.filter(
    event => event.type === 'bot_cycle' && event.summary && Array.isArray(event.summary.blockers) && event.summary.blockers.length > 0
  ).length;

  return {
    entryCount,
    exitCount,
    cancelCount,
    blockedCycles,
    ...summarizeRounds(rounds),
  };
}

function summarizeRoundWindow(rounds, lastN) {
  const sliced = rounds.slice(-lastN);
  return {
    window: lastN,
    rounds: sliced.length,
    ...summarizeRounds(sliced),
  };
}

function compareWindowQuality(recentSummary, longSummary, options = {}) {
  const pairedRateTolerance = Number(options.pairedRateTolerance ?? 0.05);
  const ambiguousRateTolerance = Number(options.ambiguousRateTolerance ?? 0.05);
  if (!recentSummary || !longSummary) {
    return { ok: true, reason: 'quality windows unavailable' };
  }

  const recentPairedRate = recentSummary.pairedRate ?? 0;
  const longPairedRate = longSummary.pairedRate ?? 0;
  const recentAmbiguousRate = recentSummary.ambiguousRate ?? 0;
  const longAmbiguousRate = longSummary.ambiguousRate ?? 0;

  const pairedDegraded = recentPairedRate + pairedRateTolerance < longPairedRate;
  const ambiguousDegraded = recentAmbiguousRate > longAmbiguousRate + ambiguousRateTolerance;
  if (pairedDegraded || ambiguousDegraded) {
    return {
      ok: false,
      reason:
        `recent window quality worse than long window ` +
        `(paired_rate ${recentPairedRate} vs ${longPairedRate}, ambiguous_rate ${recentAmbiguousRate} vs ${longAmbiguousRate})`,
    };
  }

  return { ok: true, reason: 'recent window quality is acceptable' };
}

function recommend(strategy, summary) {
  const recommendation = { ...strategy };
  const notes = [];

  if (summary.closedRounds < 5) {
    notes.push('sample is still small; keep thresholds conservative');
    recommendation.shortEntryPremiumUsd = Math.max(strategy.shortEntryPremiumUsd || 12, 14);
    recommendation.longEntryDiscountUsd = Math.max(strategy.longEntryDiscountUsd || 12, 14);
    recommendation.minDirectionalEdgeUsd = Math.max(strategy.minDirectionalEdgeUsd || 8, 10);
    recommendation.entryConfidenceThreshold = Math.max(strategy.entryConfidenceThreshold || 0.6, 0.62);
    return { recommendation, notes };
  }

  if ((summary.avgEdgeUsd ?? 0) <= 0 || (summary.winRateByEdge ?? 0) < 0.55) {
    notes.push('closed rounds show weak or negative estimated edge; tighten entries');
    recommendation.shortEntryPremiumUsd = Math.min(25, Math.max((strategy.shortEntryPremiumUsd || 12) + 2, 14));
    recommendation.longEntryDiscountUsd = Math.min(25, Math.max((strategy.longEntryDiscountUsd || 12) + 2, 14));
    recommendation.minDirectionalEdgeUsd = Math.min(20, Math.max((strategy.minDirectionalEdgeUsd || 8) + 2, 10));
    recommendation.entryConfidenceThreshold = Math.min(0.75, Math.max((strategy.entryConfidenceThreshold || 0.6) + 0.03, 0.63));
  } else {
    notes.push('estimated edge is positive; keep thresholds near current values');
  }

  if ((summary.cancelCount / Math.max(1, summary.entryCount)) > 0.2) {
    notes.push('cancel churn is elevated; prefer fewer entries and stronger directional filters');
    recommendation.minDirectionalEdgeUsd = Math.max(recommendation.minDirectionalEdgeUsd || 8, 12);
  }

  if ((summary.avgHoldMs ?? 0) > 120000) {
    notes.push('average hold time is long; keep exit timers aggressive');
  }

  if ((summary.ambiguousRounds ?? 0) > 0) {
    notes.push('some rounds are ambiguous and excluded from hold metrics');
  }

  return { recommendation, notes };
}

function buildRecommendedPatch(strategy, recommendation) {
  const keys = [
    'shortEntryPremiumUsd',
    'longEntryDiscountUsd',
    'minDirectionalEdgeUsd',
    'entryConfidenceThreshold',
  ];
  const patch = {};
  for (const key of keys) {
    if (recommendation[key] !== strategy[key]) {
      patch[key] = recommendation[key];
    }
  }
  return patch;
}

function shouldApplyRecommendation(summary, calibrationState, options = {}) {
  const minClosedRounds = Number(options.minClosedRounds || 30);
  const minNewClosedRounds = Number(options.minNewClosedRounds || 10);
  const maxAmbiguousRate = Number(options.maxAmbiguousRate ?? 0.25);
  if (summary.closedRounds < minClosedRounds) {
    return {
      ok: false,
      reason: `closed rounds below minimum threshold (${summary.closedRounds} < ${minClosedRounds})`,
    };
  }

  if ((summary.ambiguousRate ?? 0) > maxAmbiguousRate) {
    return {
      ok: false,
      reason: `ambiguous rate above quality threshold (${summary.ambiguousRate} > ${maxAmbiguousRate})`,
    };
  }

  const lastAppliedClosedRounds = Number(calibrationState?.lastAppliedClosedRounds || 0);
  if (summary.closedRounds - lastAppliedClosedRounds < minNewClosedRounds) {
    return {
      ok: false,
      reason: `not enough new closed rounds since last calibration (${summary.closedRounds - lastAppliedClosedRounds} < ${minNewClosedRounds})`,
    };
  }

  const qualityGate = compareWindowQuality(options.recentWindow, options.longWindow, options);
  if (!qualityGate.ok) {
    return qualityGate;
  }

  return { ok: true, reason: 'sample threshold satisfied' };
}

module.exports = {
  EVENTS_PATH,
  STRATEGY_PATH,
  CALIBRATION_STATE_PATH,
  loadEvents,
  loadStrategy,
  writeStrategy,
  loadCalibrationState,
  writeCalibrationState,
  buildRounds,
  summarize,
  summarizeRoundWindow,
  compareWindowQuality,
  recommend,
  buildRecommendedPatch,
  shouldApplyRecommendation,
};
