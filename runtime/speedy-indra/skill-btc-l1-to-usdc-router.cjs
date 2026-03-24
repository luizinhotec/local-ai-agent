const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');
const { runBtcL1ToSbtcReadinessSkill } = require('./skill-btc-l1-to-sbtc-readiness.cjs');
const { runSbtcToUsdcx } = require('./skill-defi-simple.cjs');

const SUPPORTED_ROUTE = 'defi_native';

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
    if (['signature', 'walletPassword', 'mnemonic', 'wif', 'hex'].includes(key)) {
      sanitized[key] = item ? '[REDACTED]' : item;
      continue;
    }
    sanitized[key] = sanitizeValue(item);
  }
  return sanitized;
}

async function runBtcL1ToUsdcRouterSkill(options = {}) {
  const config = loadAgentConfig();
  const nowIso = new Date().toISOString();
  const statusOnly = parseBoolean(options.statusOnly, false);
  const dryRun = options.dryRun === undefined ? true : parseBoolean(options.dryRun, true);
  const route = String(options.route || SUPPORTED_ROUTE).trim().toLowerCase();
  const amountSats = Number(options['amount-sats'] || 10000);
  const featureEnabled = config.featureFlags.btcL1ToUsdcx;

  if (route !== SUPPORTED_ROUTE) {
    throw new Error(`unsupported route: ${route}`);
  }

  appendJsonLog('btc_l1_to_usdc_router_started', {
    statusOnly,
    dryRun,
    route,
    amountSats,
  });

  const btcStage = await runBtcL1ToSbtcReadinessSkill({
    statusOnly: true,
    dryRun: true,
    persist: false,
  });
  const usdcxStage = await runSbtcToUsdcx({
    pair: 'sbtc-usdcx',
    'amount-sats': amountSats,
    mode: 'plan',
    persist: false,
  });

  const blockers = [];
  if (!featureEnabled && !statusOnly) blockers.push('feature_disabled');
  if (route !== SUPPORTED_ROUTE) blockers.push('route_not_supported');
  blockers.push(...(btcStage.blockers || []));
  blockers.push(...(usdcxStage.blockers || []));

  const normalizedBlockers = [...new Set(blockers)];
  const status =
    btcStage.status === 'not_ready' || usdcxStage.status === 'not_ready'
      ? 'blocked'
      : normalizedBlockers.length > 0
      ? 'partial'
      : 'ready';

  const totalFeesEstimate = {
    bridgeBtcFeeSats: null,
    sbtcToUsdcxFeeSats: usdcxStage.quoteSummary?.estimatedFeeSats ?? null,
  };

  const result = {
    ok: true,
    skill: 'btc-l1-to-usdc-router',
    statusOnly,
    dryRun,
    route: 'btc_l1_to_sbtc_to_usdcx',
    requestedRoute: route,
    amountSats,
    btcStage: sanitizeValue(btcStage),
    sbtcStage: sanitizeValue({
      status: btcStage.status,
      bridgeMode: btcStage.sbtcBridge?.mode || 'manual_ui',
      recommendation: btcStage.recommendation,
      blockers: btcStage.blockers || [],
    }),
    usdcxStage: sanitizeValue(usdcxStage),
    estimatedOutput: usdcxStage.quoteSummary?.amountOut || null,
    totalFeesEstimate,
    executionMode: 'manual + automated',
    blockers: normalizedBlockers,
    status,
    pointOfManualAction: 'btc_l1_to_sbtc_bridge',
  };

  const finalState = updateAgentState(current => {
    current.lastBtcL1ToUsdcxCheckAt = nowIso;
    current.lastBtcL1ToUsdcxAttemptAt = nowIso;
    current.btcL1ToUsdcxRouteSuggested = route;
    current.btcL1ToUsdcxRouteUsed = route;
    current.btcL1ToUsdcxAttempts += statusOnly ? 0 : 1;
    current.btcL1ToUsdcxKnownBlockers = normalizedBlockers;
    current.btcL1ToUsdcxLastPlan = sanitizeValue(result);
    current.btcL1ToUsdcxStatus = {
      implemented: true,
      status,
      routeSuggested: route,
      routeUsed: route,
      approvalRequired: true,
      liveEligible: false,
    };
    current.skills.btcL1ToUsdcx = {
      ...current.skills.btcL1ToUsdcx,
      enabled: featureEnabled,
      lastRunAt: nowIso,
      lastFailureAt: normalizedBlockers.length > 0 ? nowIso : current.skills.btcL1ToUsdcx.lastFailureAt,
      lastSkipReason: dryRun ? 'dry_run_default' : 'manual_bridge_required',
      lastOutcome: 'planned',
      lastAttemptMode: dryRun ? 'dry_run' : 'live',
      lastStatusCode: 200,
      errorCount:
        normalizedBlockers.length > 0
          ? current.skills.btcL1ToUsdcx.errorCount + 1
          : current.skills.btcL1ToUsdcx.errorCount,
    };
    return current;
  });

  writeAgentStatus({
    checkedAt: nowIso,
    btcL1ToUsdcRouter: {
      status,
      route: result.route,
      blockers: normalizedBlockers,
    },
  });

  appendJsonLog('btc_l1_to_usdc_router_completed', sanitizeValue({
    status,
    blockers: normalizedBlockers,
    estimatedOutput: result.estimatedOutput,
  }));

  return {
    ...result,
    state: finalState,
  };
}

module.exports = {
  runBtcL1ToUsdcRouterSkill,
};
