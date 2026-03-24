const SHAPE_PROFILES = {
  spot: {
    strategyShape: 'spot',
    feeCaptureBias: 1.0,
    activeLiquidityBias: 1.0,
    recenterCostBias: 1.0,
    slippageCostPct: 0.08,
    recenterUpsideBias: 1.0,
    watchDriftBias: 1.0,
  },
  curve: {
    strategyShape: 'curve',
    feeCaptureBias: 1.24,
    activeLiquidityBias: 1.08,
    recenterCostBias: 1.28,
    slippageCostPct: 0.11,
    recenterUpsideBias: 1.18,
    watchDriftBias: 1.1,
  },
  bid_ask: {
    strategyShape: 'bid_ask',
    feeCaptureBias: 1.16,
    activeLiquidityBias: 0.96,
    recenterCostBias: 1.52,
    slippageCostPct: 0.14,
    recenterUpsideBias: 0.92,
    watchDriftBias: 1.14,
  },
};

const DEFAULT_POLICY = {
  minPriceMovePct: 1.5,
  fallbackOutOfRangeMovePct: 4,
  lowActiveLiquidityRatio: 0.62,
  minNetBenefitUsd: 1.25,
  minNetBenefitMultiple: 1.15,
  maxDailyRebalances: 3,
  cooldownHours: 12,
};

const MAX_BINS_PER_SIDE = 50;
const MAX_TOTAL_BINS = MAX_BINS_PER_SIDE * 2;

function toFiniteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalizeMaxDeviation(value, fallback = 2) {
  const numeric = toFiniteNumber(value, fallback);
  return Math.max(0, Math.min(MAX_BINS_PER_SIDE, Math.round(numeric)));
}

function normalizeShape(value) {
  const normalized = String(value || 'spot').trim().toLowerCase();
  if (normalized === 'curve') return 'curve';
  if (normalized === 'bid_ask' || normalized === 'bid-ask' || normalized === 'bidask') return 'bid_ask';
  return 'spot';
}

function normalizePolicy(policy = {}) {
  return {
    ...DEFAULT_POLICY,
    ...policy,
    minPriceMovePct: toFiniteNumber(policy.minPriceMovePct, DEFAULT_POLICY.minPriceMovePct),
    fallbackOutOfRangeMovePct: toFiniteNumber(policy.fallbackOutOfRangeMovePct, DEFAULT_POLICY.fallbackOutOfRangeMovePct),
    lowActiveLiquidityRatio: toFiniteNumber(policy.lowActiveLiquidityRatio, DEFAULT_POLICY.lowActiveLiquidityRatio),
    minNetBenefitUsd: toFiniteNumber(policy.minNetBenefitUsd, DEFAULT_POLICY.minNetBenefitUsd),
    minNetBenefitMultiple: toFiniteNumber(policy.minNetBenefitMultiple, DEFAULT_POLICY.minNetBenefitMultiple),
    maxDailyRebalances: Math.max(1, Math.round(toFiniteNumber(policy.maxDailyRebalances, DEFAULT_POLICY.maxDailyRebalances))),
    cooldownHours: Math.max(1, toFiniteNumber(policy.cooldownHours, DEFAULT_POLICY.cooldownHours)),
  };
}

function inferMarketStateMultiplier(marketState) {
  const normalized = String(marketState || 'neutral').trim().toUpperCase();
  if (normalized === 'STABLE') return 0.92;
  if (normalized === 'VOLATILE') return 1.12;
  return 1;
}

function computeDeviationPct(currentPrice, referencePrice) {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(referencePrice) || referencePrice <= 0) {
    return null;
  }
  return Math.abs(((currentPrice - referencePrice) / referencePrice) * 100);
}

function inferInRangeRatio(snapshot, policy) {
  if (Number.isFinite(snapshot.binDistance) && Number.isFinite(snapshot.maxDeviation) && snapshot.maxDeviation >= 0) {
    return clamp(1 - snapshot.binDistance / (snapshot.maxDeviation + 1));
  }
  if (Number.isFinite(snapshot.deviationPct)) {
    return clamp(1 - snapshot.deviationPct / policy.fallbackOutOfRangeMovePct);
  }
  return 0.5;
}

function inferActiveLiquidityRatio(snapshot, profile, policy) {
  const deviationPct = Number.isFinite(snapshot.deviationPct) ? snapshot.deviationPct : policy.fallbackOutOfRangeMovePct / 2;
  const fade = clamp(1 - deviationPct / (policy.fallbackOutOfRangeMovePct * profile.watchDriftBias));
  const inventorySkewPenalty = Number.isFinite(snapshot.inventorySkewRatio)
    ? clamp(1 - Math.max(0, snapshot.inventorySkewRatio - 0.65) * 0.35)
    : 1;
  return clamp(fade * profile.activeLiquidityBias * inventorySkewPenalty);
}

function buildBaseSnapshot(input = {}, positionState = {}) {
  const currentPrice =
    toFiniteNumber(input.currentPrice) ??
    toFiniteNumber(input.market?.btcUsdNow) ??
    toFiniteNumber(input.activePosition?.current_price);
  const referencePrice =
    toFiniteNumber(input.referencePrice) ??
    toFiniteNumber(input.market?.entrySbtcUsd) ??
    toFiniteNumber(input.activePosition?.entry_price) ??
    currentPrice;
  const deviationPct = computeDeviationPct(currentPrice, referencePrice);
  const exposureUsd =
    toFiniteNumber(input.exposureUsd) ??
    toFiniteNumber(input.activePosition?.exposure_usd) ??
    toFiniteNumber(input.currentInventory?.markedValueUsdNow) ??
    toFiniteNumber(input.deployedInventory?.valueUsdAtEntryMark) ??
    0;
  const xAmount = toFiniteNumber(input.position?.xAmount);
  const yAmount = toFiniteNumber(input.position?.yAmount);
  const xUsd = Number.isFinite(xAmount) && Number.isFinite(currentPrice) ? (xAmount / 100_000_000) * currentPrice : null;
  const yUsd = Number.isFinite(yAmount) ? yAmount / 1_000_000 : null;
  const inventorySkewRatio =
    Number.isFinite(xUsd) && Number.isFinite(yUsd) && xUsd + yUsd > 0
      ? Math.max(xUsd, yUsd) / (xUsd + yUsd)
      : null;
  const currentBinId =
    toFiniteNumber(input.poolSnapshot?.active_bin) ??
    toFiniteNumber(input.poolMetadata?.signedActiveBinId);
  const expectedBinId = toFiniteNumber(input.position?.expectedBinId);
  const maxDeviation = normalizeMaxDeviation(input.position?.maxDeviation, 2);
  const binDistance =
    Number.isFinite(currentBinId) && Number.isFinite(expectedBinId)
      ? Math.abs(currentBinId - expectedBinId)
      : null;
  const knownGasUsd =
    (toFiniteNumber(input.gas?.swap?.usdNow, 0) || 0) +
    (toFiniteNumber(input.gas?.lpAdd?.usdNow, 0) || 0) +
    (toFiniteNumber(input.gas?.close?.usdNow, 0) || toFiniteNumber(input.gas?.lpAdd?.usdNow, 0) || 0);
  const nowIso = input.nowIso || new Date().toISOString();
  const cooldownUntil = positionState.cooldownUntil || null;
  const dailyRebalanceCount = Number(positionState.dailyRebalanceCount || 0);

  return {
    nowIso,
    positionKey: input.positionKey || `${input.poolId || input.poolContract || 'unknown-pool'}:${input.walletAddress || input.wallet?.address || 'unknown-wallet'}`,
    poolId: input.poolId || input.poolContract || input.activePosition?.pool_id || null,
    poolSymbol: input.poolSymbol || input.activePosition?.pool_symbol || null,
    walletAddress: input.walletAddress || input.wallet?.address || null,
    currentShape: normalizeShape(input.strategyShape || positionState.currentShape || 'spot'),
    marketState: input.marketState || input.activePosition?.market_state || input.strategyState?.market_state || 'UNKNOWN',
    currentPrice,
    referencePrice,
    deviationPct,
    exposureUsd,
    inventorySkewRatio,
    currentBinId,
    expectedBinId,
    maxDeviation,
    rangeLowerBinId: Number.isFinite(expectedBinId) ? expectedBinId - maxDeviation : null,
    rangeUpperBinId: Number.isFinite(expectedBinId) ? expectedBinId + maxDeviation : null,
    maxBinsPerSide: MAX_BINS_PER_SIDE,
    maxTotalBins: MAX_TOTAL_BINS,
    binDistance,
    knownGasUsd,
    cooldownUntil,
    dailyRebalanceCount,
    rebalanceCount: Number(positionState.rebalanceCount || 0),
    lastRebalanceAt: positionState.lastRebalanceAt || null,
    dataQuality: {
      hasPoolState: Boolean(input.poolSnapshot),
      hasPriceState: Number.isFinite(currentPrice) && Number.isFinite(referencePrice),
      hasExposureState: Number.isFinite(exposureUsd) && exposureUsd > 0,
      hasRangeState: Number.isFinite(currentBinId) && Number.isFinite(expectedBinId),
    },
  };
}

function evaluateShape(snapshot, requestedShape, policy, mode = 'status-only') {
  const shape = normalizeShape(requestedShape);
  const profile = SHAPE_PROFILES[shape];
  const inRangeRatio = inferInRangeRatio(snapshot, policy);
  const activeLiquidityRatio = inferActiveLiquidityRatio(snapshot, profile, policy);
  const isInRange = inRangeRatio >= 0.5;
  const deviationPct = Number.isFinite(snapshot.deviationPct) ? snapshot.deviationPct : policy.fallbackOutOfRangeMovePct / 2;
  const marketStateMultiplier = inferMarketStateMultiplier(snapshot.marketState);
  const baseFeeCaptureUsd =
    Number(snapshot.exposureUsd || 0) *
    (0.26 + 0.18 * marketStateMultiplier) *
    profile.feeCaptureBias *
    (0.35 + 0.65 * activeLiquidityRatio);
  const estimatedFeeCaptureUsd = round(baseFeeCaptureUsd, 6);
  const estimatedRecenterCostUsd = round(
    (Number(snapshot.knownGasUsd || 0) * profile.recenterCostBias) +
      Number(snapshot.exposureUsd || 0) * profile.slippageCostPct,
    6
  );
  const expectedRecenterEdgeUsd = round(
    estimatedFeeCaptureUsd *
      clamp(
        ((1 - inRangeRatio) * profile.recenterUpsideBias) +
          Math.max(0, deviationPct - policy.minPriceMovePct) / Math.max(policy.fallbackOutOfRangeMovePct, 1),
        0.08,
        1.4
      ),
    6
  );
  const estimatedNetReturnUsd = round(expectedRecenterEdgeUsd - estimatedRecenterCostUsd, 6);
  const cooldownActive =
    Boolean(snapshot.cooldownUntil) &&
    Number.isFinite(Date.parse(snapshot.cooldownUntil)) &&
    Date.parse(snapshot.cooldownUntil) > Date.parse(snapshot.nowIso);
  const passesDailyLimit = Number(snapshot.dailyRebalanceCount || 0) < policy.maxDailyRebalances;
  const dataConfidence =
    [
      snapshot.dataQuality.hasPoolState,
      snapshot.dataQuality.hasPriceState,
      snapshot.dataQuality.hasExposureState,
      snapshot.dataQuality.hasRangeState,
    ].filter(Boolean).length / 4;

  let recommendedAction = 'HOLD';
  let reasonCode = 'position_healthy';
  if (dataConfidence < 0.5) {
    recommendedAction = 'BLOCK';
    reasonCode = 'insufficient_pool_state';
  } else if (cooldownActive) {
    recommendedAction = 'BLOCK';
    reasonCode = 'cooldown_active';
  } else if (!passesDailyLimit) {
    recommendedAction = 'BLOCK';
    reasonCode = 'daily_limit_reached';
  } else if (deviationPct < policy.minPriceMovePct && isInRange) {
    recommendedAction = 'HOLD';
    reasonCode = 'price_move_below_threshold';
  } else if (
    (!isInRange || activeLiquidityRatio < policy.lowActiveLiquidityRatio) &&
    estimatedNetReturnUsd > policy.minNetBenefitUsd &&
    expectedRecenterEdgeUsd > estimatedRecenterCostUsd * policy.minNetBenefitMultiple
  ) {
    recommendedAction = mode === 'status-only' ? 'RECENTER' : 'RECENTER';
    reasonCode = !isInRange ? 'out_of_range_with_positive_edge' : 'active_liquidity_degraded';
  } else if (!isInRange || activeLiquidityRatio < policy.lowActiveLiquidityRatio || deviationPct >= policy.minPriceMovePct) {
    recommendedAction = 'WATCH';
    reasonCode = !isInRange ? 'out_of_range_but_edge_insufficient' : 'drift_detected_monitor';
  }

  return {
    strategy_shape: shape,
    is_in_range: isInRange,
    in_range_ratio: round(inRangeRatio, 6),
    active_liquidity_ratio: round(activeLiquidityRatio, 6),
    estimated_fee_capture_usd: estimatedFeeCaptureUsd,
    estimated_recenter_cost_usd: estimatedRecenterCostUsd,
    estimated_recenter_edge_usd: expectedRecenterEdgeUsd,
    estimated_net_return_usd: estimatedNetReturnUsd,
    recommended_action: recommendedAction,
    reason_code: reasonCode,
    passes_cooldown: !cooldownActive,
    passes_daily_limit: passesDailyLimit,
    should_execute:
      recommendedAction === 'RECENTER' &&
      estimatedNetReturnUsd > policy.minNetBenefitUsd &&
      expectedRecenterEdgeUsd > estimatedRecenterCostUsd * policy.minNetBenefitMultiple,
    deviation_pct: round(deviationPct, 6),
    current_price: round(snapshot.currentPrice, 6),
    reference_price: round(snapshot.referencePrice, 6),
    current_bin_id: Number.isFinite(snapshot.currentBinId) ? snapshot.currentBinId : null,
    expected_bin_id: Number.isFinite(snapshot.expectedBinId) ? snapshot.expectedBinId : null,
    bin_distance: Number.isFinite(snapshot.binDistance) ? snapshot.binDistance : null,
    range_lower_bin_id: Number.isFinite(snapshot.rangeLowerBinId) ? snapshot.rangeLowerBinId : null,
    range_upper_bin_id: Number.isFinite(snapshot.rangeUpperBinId) ? snapshot.rangeUpperBinId : null,
    max_bins_per_side: snapshot.maxBinsPerSide,
    max_total_bins: snapshot.maxTotalBins,
    exposure_usd: round(snapshot.exposureUsd, 6),
    data_confidence: round(dataConfidence, 6),
  };
}

function buildTelemetryEntry(snapshot, evaluation) {
  return {
    at: snapshot.nowIso,
    strategy_shape: evaluation.strategy_shape,
    in_range_ratio: evaluation.in_range_ratio,
    active_liquidity_ratio: evaluation.active_liquidity_ratio,
    estimated_fee_capture_usd: evaluation.estimated_fee_capture_usd,
    estimated_recenter_cost_usd: evaluation.estimated_recenter_cost_usd,
    estimated_net_return_usd: evaluation.estimated_net_return_usd,
    recommended_action: evaluation.recommended_action,
    reason_code: evaluation.reason_code,
    deviation_pct: evaluation.deviation_pct,
  };
}

function evaluateBlsmScenario(input = {}, options = {}) {
  const policy = normalizePolicy(options.policy);
  const snapshot = buildBaseSnapshot(input, options.positionState || {});
  const mode = String(options.mode || 'status-only').trim().toLowerCase();
  const currentEvaluation = evaluateShape(snapshot, snapshot.currentShape, policy, mode);

  if (mode === 'compare-shapes') {
    const shapes = ['spot', 'curve', 'bid_ask'];
    const results = shapes.map(shape => evaluateShape(snapshot, shape, policy, mode));
    const best = [...results].sort((left, right) => {
      if (right.estimated_net_return_usd !== left.estimated_net_return_usd) {
        return right.estimated_net_return_usd - left.estimated_net_return_usd;
      }
      return right.estimated_fee_capture_usd - left.estimated_fee_capture_usd;
    })[0];
    return {
      snapshot,
      mode,
      currentEvaluation,
      comparison: {
        command: 'compare-shapes',
        pool_id: snapshot.poolId,
        position_id: snapshot.positionKey,
        results: results.map(result => ({
          strategy_shape: result.strategy_shape,
          estimated_fee_capture_usd: result.estimated_fee_capture_usd,
          estimated_recenter_cost_usd: result.estimated_recenter_cost_usd,
          estimated_net_return_usd: result.estimated_net_return_usd,
          recommended_action: result.recommended_action,
        })),
        best_shape_by_net_return: best.strategy_shape,
      },
    };
  }

  if (mode === 'dry-run') {
    const simulatedShape = normalizeShape(options.strategyShape || snapshot.currentShape);
    const simulated = evaluateShape(snapshot, simulatedShape, policy, mode);
    return {
      snapshot,
      mode,
      currentEvaluation,
      dryRun: {
        current_shape: snapshot.currentShape,
        simulated_shape: simulated.strategy_shape,
        action: simulated.recommended_action,
        estimated_fee_capture_usd: simulated.estimated_fee_capture_usd,
        estimated_recenter_cost_usd: simulated.estimated_recenter_cost_usd,
        estimated_net_return_usd: simulated.estimated_net_return_usd,
        passes_cooldown: simulated.passes_cooldown,
        passes_daily_limit: simulated.passes_daily_limit,
        should_execute: simulated.should_execute,
      },
    };
  }

  return {
    snapshot,
    mode: 'status-only',
    currentEvaluation,
    status: {
      pool_id: snapshot.poolId,
      position_id: snapshot.positionKey,
      strategy_shape: currentEvaluation.strategy_shape,
      is_in_range: currentEvaluation.is_in_range,
      in_range_ratio: currentEvaluation.in_range_ratio,
      active_liquidity_ratio: currentEvaluation.active_liquidity_ratio,
      estimated_fee_capture_usd: currentEvaluation.estimated_fee_capture_usd,
      estimated_recenter_cost_usd: currentEvaluation.estimated_recenter_cost_usd,
      estimated_net_return_usd: currentEvaluation.estimated_net_return_usd,
      recommended_action: currentEvaluation.recommended_action,
    },
  };
}

module.exports = {
  SHAPE_PROFILES,
  DEFAULT_POLICY,
  MAX_BINS_PER_SIDE,
  MAX_TOTAL_BINS,
  normalizeShape,
  normalizePolicy,
  buildBaseSnapshot,
  evaluateShape,
  evaluateBlsmScenario,
  buildTelemetryEntry,
};
