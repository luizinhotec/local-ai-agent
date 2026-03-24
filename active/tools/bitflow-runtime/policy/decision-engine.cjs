function toFiniteNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function evaluateDecision(input = {}) {
  const thresholds = {
    minExpectedNetUsd: toFiniteNumber(input.thresholds?.minExpectedNetUsd, 0.10),
    minWorstCaseNetUsd: toFiniteNumber(input.thresholds?.minWorstCaseNetUsd, 0),
    policyMinOutputRatio: toFiniteNumber(input.thresholds?.policyMinOutputRatio, 0),
    policyMaxFeePerByte: toFiniteNumber(input.thresholds?.policyMaxFeePerByte, 0),
    policyMaxRouteHops: toFiniteNumber(input.thresholds?.policyMaxRouteHops, 0),
  };

  const metrics = {
    profitComplete: input.profitComplete === true,
    validationPassed: input.validationPassed === true,
    netProfitUsd: toFiniteNumber(input.netProfitUsd),
    worstCaseNetProfitUsd: toFiniteNumber(input.worstCaseNetProfitUsd),
    outputRatio: toFiniteNumber(input.outputRatio),
    feePerByte: toFiniteNumber(input.feePerByte),
    routeHops: toFiniteNumber(input.routeHops),
  };

  if (metrics.profitComplete !== true) {
    return { decision: 'INCONCLUSIVE', reason: 'profit_incomplete', thresholds, metrics };
  }

  if (metrics.validationPassed !== true) {
    return { decision: 'INCONCLUSIVE', reason: 'validation_failed', thresholds, metrics };
  }

  if (!Number.isFinite(metrics.netProfitUsd)) {
    return { decision: 'INCONCLUSIVE', reason: 'net_profit_missing', thresholds, metrics };
  }

  if (!Number.isFinite(metrics.worstCaseNetProfitUsd)) {
    return { decision: 'INCONCLUSIVE', reason: 'worst_case_net_profit_missing', thresholds, metrics };
  }

  if (metrics.worstCaseNetProfitUsd < thresholds.minWorstCaseNetUsd) {
    return { decision: 'SKIP', reason: 'worst_case_profit_below_threshold', thresholds, metrics };
  }

  if (metrics.netProfitUsd < thresholds.minExpectedNetUsd) {
    return { decision: 'SKIP', reason: 'expected_profit_below_threshold', thresholds, metrics };
  }

  if (Number.isFinite(metrics.outputRatio) && metrics.outputRatio < thresholds.policyMinOutputRatio) {
    return { decision: 'SKIP', reason: 'output_ratio_below_threshold', thresholds, metrics };
  }

  if (
    thresholds.policyMaxFeePerByte > 0 &&
    Number.isFinite(metrics.feePerByte) &&
    metrics.feePerByte > thresholds.policyMaxFeePerByte
  ) {
    return { decision: 'SKIP', reason: 'fee_per_byte_above_threshold', thresholds, metrics };
  }

  if (
    thresholds.policyMaxRouteHops > 0 &&
    Number.isFinite(metrics.routeHops) &&
    metrics.routeHops > thresholds.policyMaxRouteHops
  ) {
    return { decision: 'SKIP', reason: 'route_hops_above_threshold', thresholds, metrics };
  }

  return { decision: 'EXECUTE', reason: 'thresholds_satisfied', thresholds, metrics };
}

module.exports = {
  evaluateDecision,
};
