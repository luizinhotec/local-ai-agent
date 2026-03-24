const fs = require('fs');
const path = require('path');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { readAgentState, updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');
const { ROOT_DIR } = require('./lib/agent-paths.cjs');
const {
  normalizeShape,
  evaluateBlsmScenario,
  buildTelemetryEntry,
} = require('./lib/blsm-engine.cjs');

const DOG_MM_STATE_DIR = path.join(ROOT_DIR, 'active', 'state', 'dog-mm');
const LP_PLAN_PATH = path.join(DOG_MM_STATE_DIR, 'bitflow-last-lp-add-plan.json');
const LP_STATE_PATH = path.join(DOG_MM_STATE_DIR, 'dog-mm-lp-strategy-state.json');
const PNL_SUMMARY_PATH = path.join(DOG_MM_STATE_DIR, 'dog-mm-pnl-summary.json');
const BLSM_REPORT_PATH = path.join(ROOT_DIR, 'state', 'speedy-indra', 'blsm-last-report.json');
const BFF_POOLS_URL = 'https://bff.bitflowapis.finance/api/quotes/v1/pools';
const HISTORY_LIMIT = 20;

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (['signature', 'walletPassword', 'mnemonic', 'wif', 'hex', 'stderr', 'stdout'].includes(key)) {
      sanitized[key] = item ? '[REDACTED]' : item;
      continue;
    }
    sanitized[key] = sanitizeValue(item);
  }
  return sanitized;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

async function fetchPoolSnapshot(poolContract) {
  if (!poolContract) return null;
  try {
    const response = await fetch(BFF_POOLS_URL);
    if (!response.ok) return null;
    const json = await response.json();
    const pools = Array.isArray(json?.pools) ? json.pools : [];
    return pools.find(pool => pool.pool_token === poolContract) || null;
  } catch {
    return null;
  }
}

function buildInputContext(lpPlan, pnlSummary, strategyState, poolSnapshot) {
  const activePosition = Array.isArray(strategyState?.active_positions) ? strategyState.active_positions[0] || null : null;
  return {
    nowIso: new Date().toISOString(),
    poolId: lpPlan?.poolContract || activePosition?.pool_id || null,
    poolSymbol: activePosition?.pool_symbol || null,
    walletAddress: lpPlan?.wallet?.address || pnlSummary?.wallet?.address || null,
    wallet: lpPlan?.wallet || pnlSummary?.wallet || null,
    strategyShape: lpPlan?.strategy_shape || lpPlan?.position?.strategy_shape || 'spot',
    positionKey: `${lpPlan?.poolContract || activePosition?.pool_id || 'unknown-pool'}:${lpPlan?.wallet?.address || pnlSummary?.wallet?.address || 'unknown-wallet'}`,
    marketState: activePosition?.market_state || strategyState?.market_state || 'UNKNOWN',
    activePosition,
    strategyState,
    market: pnlSummary?.market || null,
    gas: pnlSummary?.gas || null,
    currentInventory: pnlSummary?.currentInventory || null,
    deployedInventory: pnlSummary?.deployedInventory || null,
    currentPrice: pnlSummary?.market?.btcUsdNow || activePosition?.current_price || null,
    referencePrice: pnlSummary?.market?.entrySbtcUsd || activePosition?.entry_price || null,
    exposureUsd:
      activePosition?.exposure_usd ||
      pnlSummary?.currentInventory?.markedValueUsdNow ||
      pnlSummary?.deployedInventory?.valueUsdAtEntryMark ||
      null,
    position: lpPlan?.position || null,
    poolMetadata: lpPlan?.poolMetadata || null,
    poolSnapshot,
  };
}

function ensureBlsmState(state) {
  const defaults = {
    implemented: false,
    lastRunAt: null,
    lastMode: null,
    lastPositionKey: null,
    lastRecommendedAction: null,
    lastReasonCode: null,
    lastReport: null,
    positions: {},
  };
  return {
    ...defaults,
    ...(state || {}),
    positions: {
      ...defaults.positions,
      ...((state || {}).positions || {}),
    },
  };
}

function trimHistory(items) {
  return (items || []).slice(-HISTORY_LIMIT);
}

async function runBlsmSkill(options = {}) {
  const nowIso = new Date().toISOString();
  const mode = String(
    options.mode ||
      options.command ||
      (parseBoolean(options.statusOnly, false) ? 'status-only' : parseBoolean(options.dryRun, false) ? 'dry-run' : 'status-only')
  )
    .trim()
    .toLowerCase();
  const strategyShape = normalizeShape(options.strategyShape || options['strategy-shape'] || 'spot');
  const lpPlan = readJson(LP_PLAN_PATH);
  const pnlSummary = readJson(PNL_SUMMARY_PATH);
  const strategyState = readJson(LP_STATE_PATH);
  const agentState = readAgentState();
  const blsmState = ensureBlsmState(agentState.blsm);

  if (!lpPlan && !pnlSummary && !strategyState) {
    return {
      ok: false,
      skill: 'blsm',
      status: 'not_ready',
      reason: 'missing_lp_state_artifacts',
      blockers: ['bitflow_last_lp_add_plan_missing', 'dog_mm_lp_strategy_state_missing', 'dog_mm_pnl_summary_missing'],
    };
  }

  const positionKey = `${lpPlan?.poolContract || strategyState?.active_positions?.[0]?.pool_id || 'unknown-pool'}:${lpPlan?.wallet?.address || pnlSummary?.wallet?.address || 'unknown-wallet'}`;
  const positionState = {
    currentShape: blsmState.positions[positionKey]?.currentShape || lpPlan?.strategy_shape || 'spot',
    rebalanceCount: blsmState.positions[positionKey]?.rebalanceCount || 0,
    dailyRebalanceCount: blsmState.positions[positionKey]?.dailyRebalanceCount || 0,
    lastRebalanceAt: blsmState.positions[positionKey]?.lastRebalanceAt || null,
    cooldownUntil: blsmState.positions[positionKey]?.cooldownUntil || null,
  };
  const poolSnapshot = await fetchPoolSnapshot(lpPlan?.poolContract || strategyState?.active_positions?.[0]?.pool_id || null);
  const input = buildInputContext(lpPlan, pnlSummary, strategyState, poolSnapshot);
  const result = evaluateBlsmScenario(input, {
    mode,
    strategyShape,
    positionState,
  });
  const currentTelemetry = buildTelemetryEntry(result.snapshot, result.currentEvaluation);

  const persistedState = updateAgentState(current => {
    current.blsmStatus = {
      implemented: true,
      status: 'evaluated',
      lastMode: result.mode,
      lastRecommendedAction: result.currentEvaluation.recommended_action,
      strategyShape: result.currentEvaluation.strategy_shape,
      poolId: result.snapshot.poolId,
      positionKey: result.snapshot.positionKey,
    };
    current.lastBlsmCheckAt = nowIso;
    current.blsm = ensureBlsmState(current.blsm);
    current.blsm.implemented = true;
    current.blsm.lastRunAt = nowIso;
    current.blsm.lastMode = result.mode;
    current.blsm.lastPositionKey = result.snapshot.positionKey;
    current.blsm.lastRecommendedAction = result.currentEvaluation.recommended_action;
    current.blsm.lastReasonCode = result.currentEvaluation.reason_code;
    current.blsm.lastReport = sanitizeValue(result);
    current.blsm.positions[result.snapshot.positionKey] = {
      currentShape: result.currentEvaluation.strategy_shape,
      rebalanceCount: positionState.rebalanceCount,
      dailyRebalanceCount: positionState.dailyRebalanceCount,
      lastRebalanceAt: positionState.lastRebalanceAt,
      cooldownUntil: positionState.cooldownUntil,
      telemetryByShape: {
        ...((current.blsm.positions[result.snapshot.positionKey] || {}).telemetryByShape || {}),
        [result.currentEvaluation.strategy_shape]: trimHistory([
          ...((((current.blsm.positions[result.snapshot.positionKey] || {}).telemetryByShape || {})[result.currentEvaluation.strategy_shape]) || []),
          currentTelemetry,
        ]),
      },
      actionHistory: trimHistory([
        ...(((current.blsm.positions[result.snapshot.positionKey] || {}).actionHistory) || []),
        {
          at: nowIso,
          mode: result.mode,
          strategyShape: result.currentEvaluation.strategy_shape,
          recommendedAction: result.currentEvaluation.recommended_action,
          reasonCode: result.currentEvaluation.reason_code,
        },
      ]),
      comparisonHistory: trimHistory([
        ...(((current.blsm.positions[result.snapshot.positionKey] || {}).comparisonHistory) || []),
        result.comparison
          ? { at: nowIso, mode: result.mode, comparison: result.comparison }
          : result.dryRun
          ? { at: nowIso, mode: result.mode, dryRun: result.dryRun }
          : { at: nowIso, mode: result.mode, status: result.status },
      ]),
    };
    current.skills.blsm = {
      ...(current.skills.blsm || {
        enabled: true,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastSkipReason: null,
        lastOutcome: 'never',
        lastAttemptMode: null,
        lastStatusCode: null,
        errorCount: 0,
      }),
      enabled: true,
      lastRunAt: nowIso,
      lastSuccessAt: nowIso,
      lastFailureAt: current.skills?.blsm?.lastFailureAt || null,
      lastSkipReason: null,
      lastOutcome: 'completed',
      lastAttemptMode: result.mode,
      lastStatusCode: 200,
      errorCount: current.skills?.blsm?.errorCount || 0,
    };
    return current;
  });

  writeAgentStatus({
    checkedAt: nowIso,
    blsm: {
      status: 'evaluated',
      mode: result.mode,
      poolId: result.snapshot.poolId,
      positionKey: result.snapshot.positionKey,
      strategyShape: result.currentEvaluation.strategy_shape,
      recommendedAction: result.currentEvaluation.recommended_action,
      reasonCode: result.currentEvaluation.reason_code,
      estimatedNetReturnUsd: result.currentEvaluation.estimated_net_return_usd,
    },
  });

  writeJson(BLSM_REPORT_PATH, {
    generatedAt: nowIso,
    mode: result.mode,
    report: sanitizeValue(result),
  });

  appendJsonLog('blsm_skill_completed', sanitizeValue({
    mode: result.mode,
    poolId: result.snapshot.poolId,
    positionKey: result.snapshot.positionKey,
    strategyShape: result.currentEvaluation.strategy_shape,
    recommendedAction: result.currentEvaluation.recommended_action,
    reasonCode: result.currentEvaluation.reason_code,
    estimatedNetReturnUsd: result.currentEvaluation.estimated_net_return_usd,
  }));

  return {
    ok: true,
    skill: 'blsm',
    mode: result.mode,
    poolId: result.snapshot.poolId,
    positionId: result.snapshot.positionKey,
    strategyShape: result.currentEvaluation.strategy_shape,
    recommendedAction: result.currentEvaluation.recommended_action,
    reasonCode: result.currentEvaluation.reason_code,
    currentEvaluation: sanitizeValue(result.currentEvaluation),
    status: sanitizeValue(result.status || null),
    dryRun: sanitizeValue(result.dryRun || null),
    comparison: sanitizeValue(result.comparison || null),
    snapshot: sanitizeValue({
      poolSymbol: result.snapshot.poolSymbol,
      marketState: result.snapshot.marketState,
      currentPrice: result.snapshot.currentPrice,
      referencePrice: result.snapshot.referencePrice,
      deviationPct: result.snapshot.deviationPct,
      exposureUsd: result.snapshot.exposureUsd,
      currentBinId: result.snapshot.currentBinId,
      expectedBinId: result.snapshot.expectedBinId,
      rangeLowerBinId: result.snapshot.rangeLowerBinId,
      rangeUpperBinId: result.snapshot.rangeUpperBinId,
      maxBinsPerSide: result.snapshot.maxBinsPerSide,
      maxTotalBins: result.snapshot.maxTotalBins,
      maxDeviation: result.snapshot.maxDeviation,
      binDistance: result.snapshot.binDistance,
    }),
    reportPath: BLSM_REPORT_PATH,
    state: sanitizeValue({
      blsmStatus: persistedState.blsmStatus,
      lastBlsmCheckAt: persistedState.lastBlsmCheckAt,
      blsm: persistedState.blsm,
      skill: persistedState.skills?.blsm || null,
    }),
  };
}

module.exports = {
  runBlsmSkill,
};
