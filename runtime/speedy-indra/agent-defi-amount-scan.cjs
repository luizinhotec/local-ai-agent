#!/usr/bin/env node

const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');
const { runRouteEvaluatorSkill } = require('./skill-route-evaluator.cjs');

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      flags[key] = rest.length > 0 ? rest.join('=') : true;
    }
  }
  return flags;
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

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAmountCandidates(flags, config) {
  const explicit = String(flags.amounts || '')
    .split(',')
    .map(item => Number(item.trim()))
    .filter(item => Number.isFinite(item) && item > 0);
  const configured = Array.isArray(config.routeEvaluator?.amountCandidates)
    ? config.routeEvaluator.amountCandidates
    : [];
  const fallback = Number(config.routeEvaluator?.defaultAmountSats || 3000);
  const amounts = explicit.length > 0 ? explicit : configured.length > 0 ? configured : [fallback];
  return [...new Set(amounts)].sort((left, right) => left - right);
}

function evaluateAmountResult(result) {
  const defi = result?.decisionContext?.defi || {};
  const effectiveDecisionPolicy = defi?.policyDiagnostics?.decision || {};
  const feePerByte = toFiniteNumber(defi?.quoteSummary?.rawFeeInputs?.feePerByte);
  const maxFeePerByte = toFiniteNumber(effectiveDecisionPolicy?.maxFeePerByte);
  const estimatedFeeSats = toFiniteNumber(defi?.estimatedFeeSats);
  const maxEstimatedFeeSats = toFiniteNumber(effectiveDecisionPolicy?.maxEstimatedFeeSats);
  const routeHops = toFiniteNumber(defi?.quoteSummary?.totalHops);
  const maxRouteHops = toFiniteNumber(effectiveDecisionPolicy?.maxRouteHops);
  const minOutputRatio = toFiniteNumber(effectiveDecisionPolicy?.minOutputRatio);
  const amountSats = Number(result?.amountSats || 0);
  const minAmountOut = toFiniteNumber(defi?.quoteSummary?.minAmountOut);
  const btcUsd = toFiniteNumber(defi?.quoteSummary?.rawFeeInputs?.btcUsd);
  const inputUsd =
    Number.isFinite(amountSats) && amountSats > 0 && btcUsd !== null
      ? (amountSats / 100000000) * btcUsd
      : null;
  const outputRatio =
    inputUsd !== null && inputUsd > 0 && minAmountOut !== null
      ? (minAmountOut / 1000000) / inputUsd
      : null;
  const feePerByteOverLimit =
    feePerByte !== null && maxFeePerByte !== null && feePerByte > maxFeePerByte;
  const feeOverLimit =
    estimatedFeeSats !== null &&
    maxEstimatedFeeSats !== null &&
    estimatedFeeSats > maxEstimatedFeeSats;
  const routeHopsOverLimit =
    routeHops !== null && maxRouteHops !== null && routeHops > maxRouteHops;
  const outputRatioBelowMin =
    outputRatio !== null && minOutputRatio !== null && outputRatio < minOutputRatio;
  const passNow = Boolean(result?.championshipGateEligible && defi?.decision === 'PASS');
  const validationPenalty =
    (feePerByteOverLimit ? Math.max(0, (feePerByte - maxFeePerByte) / Math.max(maxFeePerByte || 1, 1)) : 0) +
    (feeOverLimit ? Math.max(0, (estimatedFeeSats - maxEstimatedFeeSats) / Math.max(maxEstimatedFeeSats || 1, 1)) : 0) +
    (routeHopsOverLimit ? Math.max(0, routeHops - maxRouteHops) : 0) +
    (outputRatioBelowMin ? Math.max(0, (minOutputRatio - outputRatio) / Math.max(minOutputRatio || 1, 1)) : 0);

  return {
    amountSats,
    recommendedAction: result?.recommendedAction || 'wait',
    reason: result?.reason || null,
    championshipGateEligible: Boolean(result?.championshipGateEligible),
    decision: defi?.decision || null,
    decisionReason: defi?.decisionReason || null,
    passNow,
    estimatedFeeSats,
    maxEstimatedFeeSats,
    feeOverLimit,
    feePerByte,
    maxFeePerByte,
    feePerByteOverLimit,
    routeHops,
    maxRouteHops,
    routeHopsOverLimit,
    outputRatio,
    minOutputRatio,
    outputRatioBelowMin,
    validationPenalty,
    humanReason: [
      passNow ? 'pass_now' : null,
      feePerByteOverLimit ? 'fee_per_byte_above_limit' : null,
      outputRatioBelowMin ? 'output_ratio_below_min' : null,
      feeOverLimit ? 'fee_above_limit' : null,
      routeHopsOverLimit ? 'route_hops_above_limit' : null,
      result?.championshipGateBlockReason || null,
      defi?.decisionReason || null,
    ].filter(Boolean),
  };
}

function choosePreferredAmount(results, fallbackAmount) {
  const ranked = results.slice().sort((left, right) => {
    if (Number(right.passNow) !== Number(left.passNow)) return Number(right.passNow) - Number(left.passNow);
    if (left.validationPenalty !== right.validationPenalty) return left.validationPenalty - right.validationPenalty;
    if (Number(right.outputRatio || 0) !== Number(left.outputRatio || 0)) return Number(right.outputRatio || 0) - Number(left.outputRatio || 0);
    return left.amountSats - right.amountSats;
  });
  return ranked[0] || {
    amountSats: fallbackAmount,
    passNow: false,
    humanReason: ['no_amount_results'],
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const config = loadAgentConfig();
  const nowIso = new Date().toISOString();
  const amounts = parseAmountCandidates(flags, config);

  appendJsonLog('defi_amount_scan_started', {
    amounts,
    defaultAmountSats: config.routeEvaluator?.defaultAmountSats || 3000,
  });

  const results = [];
  for (const amountSats of amounts) {
    const evaluation = await runRouteEvaluatorSkill({
      dryRun: true,
      force: true,
      persist: false,
      'amount-sats': amountSats,
    });
    results.push(evaluateAmountResult(evaluation));
  }

  const preferred = choosePreferredAmount(results, Number(config.routeEvaluator?.defaultAmountSats || 3000));
  const finalState = updateAgentState(state => {
    state.defiAmountScan = {
      lastScanAt: nowIso,
      preferredAmountSats: preferred.amountSats,
      preferredReason: preferred.humanReason?.join(',') || preferred.reason || null,
      preferredPassNow: Boolean(preferred.passNow),
      amounts: results,
    };
    return state;
  });

  writeAgentStatus({
    checkedAt: nowIso,
    defiAmountScan: sanitizeValue(finalState.defiAmountScan),
  });

  appendJsonLog('defi_amount_scan_completed', sanitizeValue({
    amountsScanned: amounts,
    preferredAmountSats: preferred.amountSats,
    preferredPassNow: preferred.passNow,
    preferredReason: preferred.humanReason,
  }));

  console.log(JSON.stringify({
    ok: true,
    helper: 'agent-defi-amount-scan',
    scannedAt: nowIso,
    amounts,
    preferredAmountSats: preferred.amountSats,
    preferredPassNow: preferred.passNow,
    preferredReason: preferred.humanReason,
    results,
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
