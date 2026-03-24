const DEFAULT_COMPETITIVE_POLICY = {
  decision: {
    minOutputRatio: 0.97,
    maxEstimatedFeeSats: 500,
    maxFeePerByte: 1000,
    maxRouteHops: 2,
    minExpectedNetUsd: 0.10,
    minWorstCaseNetUsd: 0,
  },
  watchGate: {
    maxEstimatedFeeSats: 200,
    maxPriceImpactBps: 40,
    maxAmountSats: 2000,
  },
  championshipGate: {
    maxEstimatedFeeSats: 300,
    maxPriceImpactBps: 50,
  },
};

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mergeSection(defaults = {}, override = {}) {
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(override || {})) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

function sanitizeSection(section = {}) {
  return {
    minOutputRatio: toFiniteNumber(section.minOutputRatio, undefined),
    maxEstimatedFeeSats: toFiniteNumber(section.maxEstimatedFeeSats, undefined),
    maxFeePerByte: toFiniteNumber(section.maxFeePerByte, undefined),
    maxRouteHops: toFiniteNumber(section.maxRouteHops, undefined),
    minExpectedNetUsd: toFiniteNumber(section.minExpectedNetUsd, undefined),
    minWorstCaseNetUsd: toFiniteNumber(section.minWorstCaseNetUsd, undefined),
    maxPriceImpactBps: toFiniteNumber(section.maxPriceImpactBps, undefined),
    maxAmountSats: toFiniteNumber(section.maxAmountSats, undefined),
  };
}

function resolveCompetitivePolicy(config = {}, pair = '') {
  const defaults = config.routeEvaluator?.policyDefaults || DEFAULT_COMPETITIVE_POLICY;
  const overrides = config.routeEvaluator?.policyOverrides || {};
  const routeOverride = pair ? overrides[pair] || null : null;

  const decision = mergeSection(
    sanitizeSection(DEFAULT_COMPETITIVE_POLICY.decision),
    mergeSection(
      sanitizeSection(defaults.decision),
      sanitizeSection(routeOverride?.decision)
    )
  );
  const championshipGate = mergeSection(
    sanitizeSection(DEFAULT_COMPETITIVE_POLICY.championshipGate),
    mergeSection(
      sanitizeSection(defaults.championshipGate),
      sanitizeSection(routeOverride?.championshipGate)
    )
  );

  const resolvedWatchGate = mergeSection(
    sanitizeSection(DEFAULT_COMPETITIVE_POLICY.watchGate),
    mergeSection(
      sanitizeSection(defaults.watchGate),
      sanitizeSection(routeOverride?.watchGate)
    )
  );

  return {
    pair: pair || null,
    source: routeOverride ? 'route_override' : 'default',
    routeOverrideActive: Boolean(routeOverride),
    routeOverrideKeys: routeOverride ? Object.keys(routeOverride) : [],
    decision,
    watchGate: resolvedWatchGate,
    championshipGate,
  };
}

module.exports = {
  DEFAULT_COMPETITIVE_POLICY,
  resolveCompetitivePolicy,
};
