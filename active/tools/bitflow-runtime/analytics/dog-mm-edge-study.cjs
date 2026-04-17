#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv, buildChildEnv } = require('../runtime-env.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SAFE_WRAPPER = path.resolve(__dirname, '..', 'dog-mm-safe-wrapper.cjs');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-edge-study.json');
const STUDY_DIR = path.resolve(STATE_DIR, 'edge-study');

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function parseList(value, fallback) {
  const source = value || fallback;
  return String(source)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function toFiniteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function ratioToBps(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return round((numerator / denominator) * 10000);
}

function safeDivide(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function incrementCounter(map, key) {
  const normalized = String(key || 'UNKNOWN').trim() || 'UNKNOWN';
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function sortedCounts(map) {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.label.localeCompare(right.label);
    });
}

function buildPathSignature(plan) {
  const executionPath = Array.isArray(plan?.quote?.executionPath) ? plan.quote.executionPath : [];
  if (executionPath.length === 0) return 'no-path';
  return executionPath
    .map(step => {
      const pool = step.pool_trait || step.pool_id || 'unknown-pool';
      const fn = step.function_name || 'unknown-fn';
      const bin = step.expected_bin_id ?? 'na';
      return `${pool}:${fn}:${bin}`;
    })
    .join(' -> ');
}

function buildRoutePathSignature(plan) {
  const routePath = Array.isArray(plan?.quote?.routePath) ? plan.quote.routePath : [];
  return routePath.length > 0 ? routePath.join(' -> ') : 'no-route-path';
}

function classifyDominantCause(metrics, options = {}) {
  const {
    baselinePathSignature = null,
    baselineGrossEdgeBps = null,
    routeDegradationBpsThreshold = 10,
  } = options;

  if (metrics.validation !== 'PASS') {
    return 'VALIDATION_BLOCKED';
  }
  if (
    baselinePathSignature &&
    metrics.pathSignature !== baselinePathSignature &&
    baselineGrossEdgeBps !== null &&
    metrics.grossEdgeBps !== null &&
    metrics.grossEdgeBps < baselineGrossEdgeBps - routeDegradationBpsThreshold
  ) {
    return 'ROUTE_DEGRADATION';
  }
  if (metrics.grossEdgeUsd !== null && metrics.grossEdgeUsd <= 0) {
    return 'NEGATIVE_GROSS_EDGE';
  }
  if (
    metrics.slippageLossUsd !== null &&
    metrics.networkFeeUsd !== null &&
    metrics.grossEdgeUsd !== null &&
    metrics.slippageLossUsd >= metrics.networkFeeUsd &&
    metrics.worstCaseGrossEdgeUsd !== null &&
    metrics.worstCaseGrossEdgeUsd < 0
  ) {
    return 'SLIPPAGE_DOMINATED';
  }
  if (
    metrics.grossEdgeUsd !== null &&
    metrics.networkFeeUsd !== null &&
    metrics.grossEdgeUsd > 0 &&
    metrics.netProfitUsd !== null &&
    metrics.netProfitUsd < 0 &&
    metrics.networkFeeUsd >= metrics.grossEdgeUsd
  ) {
    return 'FEE_DOMINATED';
  }
  if (
    metrics.worstCaseGrossEdgeUsd !== null &&
    metrics.worstCaseGrossEdgeUsd < 0 &&
    metrics.netProfitUsd !== null &&
    metrics.netProfitUsd >= 0
  ) {
    return 'WORST_CASE_DOMINATED';
  }
  return 'COMBINATION';
}

function summarizeScenario(level, amountIn, payload, options = {}) {
  const plan = payload?.plan || {};
  const validation = payload?.validation || {};
  const profit = plan?.profitDiagnostics || {};
  const feeDiagnostics = plan?.feeDiagnostics || {};
  const inputUsd = toFiniteNumber(profit.inputUsd);
  const expectedOutputUsd = toFiniteNumber(profit.expectedOutputUsd);
  const minOutputUsd = toFiniteNumber(profit.minOutputUsd);
  const networkFeeUsd = toFiniteNumber(profit.networkFeeUsd);
  const grossEdgeUsd =
    inputUsd !== null && expectedOutputUsd !== null ? round(expectedOutputUsd - inputUsd) : null;
  const worstCaseGrossEdgeUsd =
    inputUsd !== null && minOutputUsd !== null ? round(minOutputUsd - inputUsd) : null;
  const slippageLossUsd =
    expectedOutputUsd !== null && minOutputUsd !== null ? round(expectedOutputUsd - minOutputUsd) : null;
  const outputRatio =
    Number(plan?.quote?.amountOut || 0) > 0
      ? round(Number(plan?.quote?.minAmountOut || 0) / Number(plan?.quote?.amountOut || 0), 6)
      : null;
  const expectedOutputRatioVsInputUsd =
    expectedOutputUsd !== null && inputUsd !== null ? round(expectedOutputUsd / inputUsd, 6) : null;
  const minOutputRatioVsInputUsd =
    minOutputUsd !== null && inputUsd !== null ? round(minOutputUsd / inputUsd, 6) : null;
  const grossEdgeBps = ratioToBps(grossEdgeUsd, inputUsd);
  const worstCaseGrossEdgeBps = ratioToBps(worstCaseGrossEdgeUsd, inputUsd);
  const slippageLossBpsVsInput = ratioToBps(slippageLossUsd, inputUsd);
  const slippageLossBpsVsExpectedOutput = ratioToBps(slippageLossUsd, expectedOutputUsd);
  const pathSignature = buildPathSignature(plan);
  const routePathSignature = buildRoutePathSignature(plan);

  const result = {
    ok: true,
    scenarioId: `scenario-${level.label}`,
    notionalLevel: level.label,
    multiplier: level.multiplier,
    amountIn,
    routeHops: toFiniteNumber(plan?.quote?.totalHops),
    executionPathLength: toFiniteNumber(feeDiagnostics.executionPathLength),
    routePathLength: Array.isArray(plan?.quote?.routePath) ? plan.quote.routePath.length : null,
    inputToken: plan.inputToken || null,
    outputToken: plan.outputToken || null,
    pathSignature,
    routePathSignature,
    inputUsd,
    expectedOutputUsd,
    minOutputUsd,
    grossEdgeUsd,
    worstCaseGrossEdgeUsd,
    grossEdgeBps,
    worstCaseGrossEdgeBps,
    outputRatio,
    expectedOutputRatioVsInputUsd,
    minOutputRatioVsInputUsd,
    slippageLossUsd,
    slippageLossBpsVsInput,
    slippageLossBpsVsExpectedOutput,
    networkFeeUsd,
    feePerByte: toFiniteNumber(feeDiagnostics.feePerByte),
    feeAsPercentOfInput: toFiniteNumber(profit.feeAsPercentOfInput),
    feeAsPercentOfExpectedOutput: toFiniteNumber(profit.feeAsPercentOfExpectedOutput),
    feeAsPercentOfGrossEdge:
      grossEdgeUsd !== null && grossEdgeUsd > 0 ? toFiniteNumber(profit.feeAsPercentOfGrossProfit) : null,
    netProfitUsd: toFiniteNumber(profit.netProfitUsd),
    worstCaseNetProfitUsd: toFiniteNumber(profit.worstCaseNetProfitUsd),
    netProfitBps: toFiniteNumber(profit.netProfitBps),
    worstCaseNetProfitBps: toFiniteNumber(profit.worstCaseNetProfitBps),
    validation: validation.ok ? 'PASS' : 'BLOCKED',
    decision: plan.decision || 'UNKNOWN',
    decisionReason: plan.decisionReason || 'unknown',
    paperMode: plan.paperMode === true,
    wouldBroadcast: plan.wouldBroadcast === true,
    broadcastAllowed: payload?.policy?.allowBroadcast === true,
  };

  result.dominantCause = classifyDominantCause(result, options);
  return result;
}

function runScenario(index, baseAmountIn, level, sharedArgs, options = {}) {
  const amountIn = String(Math.max(1, Math.round(baseAmountIn * level.multiplier)));
  const stateFile = path.resolve(STUDY_DIR, `edge-${index + 1}-${level.label}.json`);
  const summaryFile = path.resolve(STUDY_DIR, `edge-${index + 1}-${level.label}.md`);
  const childArgs = [
    SAFE_WRAPPER,
    '--json-only',
    '--amount-in',
    amountIn,
    '--max-amount-in',
    amountIn,
    '--state-file',
    stateFile,
    '--summary-file',
    summaryFile,
  ];

  for (const [key, value] of Object.entries(sharedArgs)) {
    if (value !== undefined && value !== null && value !== '') {
      childArgs.push(`--${key}`, String(value));
    }
  }

  const result = spawnSync(process.execPath, childArgs, {
    cwd: ROOT,
    env: buildChildEnv(),
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    return {
      ok: false,
      scenarioId: `scenario-${level.label}`,
      notionalLevel: level.label,
      multiplier: level.multiplier,
      amountIn,
      error: result.error.message,
    };
  }

  try {
    const payload = JSON.parse(result.stdout || '{}');
    return summarizeScenario(level, amountIn, payload, options);
  } catch (error) {
    return {
      ok: false,
      scenarioId: `scenario-${level.label}`,
      notionalLevel: level.label,
      multiplier: level.multiplier,
      amountIn,
      error: (result.stderr || result.stdout || error.message || `exit ${result.status}`).trim(),
    };
  }
}

function analyzeResults(results) {
  const successful = results.filter(result => result.ok);
  const failed = results.filter(result => !result.ok);
  const causeCounts = new Map();
  const routeCounts = new Map();

  successful.forEach(result => {
    incrementCounter(causeCounts, result.dominantCause);
    incrementCounter(routeCounts, result.pathSignature);
  });

  const baseline = successful[0] || null;
  const routeChanged = successful.some(result => result.pathSignature !== baseline?.pathSignature);
  const grossAlwaysNegative =
    successful.length > 0 && successful.every(result => (result.grossEdgeUsd ?? Number.POSITIVE_INFINITY) <= 0);
  const anyGrossPositiveFeeDestroyed = successful.some(result => {
    return (
      (result.grossEdgeUsd ?? Number.NEGATIVE_INFINITY) > 0 &&
      (result.netProfitUsd ?? Number.POSITIVE_INFINITY) < 0
    );
  });

  const slippageTrend = (() => {
    if (successful.length < 2) return 'INCONCLUSIVE';
    let increases = 0;
    let comparisons = 0;
    const ordered = [...successful].sort((left, right) => left.multiplier - right.multiplier);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1].slippageLossUsd;
      const current = ordered[index].slippageLossUsd;
      if (previous === null || current === null) continue;
      comparisons += 1;
      if (current > previous) increases += 1;
    }
    if (comparisons === 0) return 'INCONCLUSIVE';
    return increases >= Math.ceil(comparisons / 2) ? 'YES' : 'NO';
  })();

  const slippageBpsTrend = (() => {
    if (successful.length < 2) return 'INCONCLUSIVE';
    let increases = 0;
    let comparisons = 0;
    const ordered = [...successful].sort((left, right) => left.multiplier - right.multiplier);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1].slippageLossBpsVsInput;
      const current = ordered[index].slippageLossBpsVsInput;
      if (previous === null || current === null) continue;
      comparisons += 1;
      if (current > previous) increases += 1;
    }
    if (comparisons === 0) return 'INCONCLUSIVE';
    return increases >= Math.ceil(comparisons / 2) ? 'YES' : 'NO';
  })();

  const minOutTrend = (() => {
    if (successful.length < 2) return 'INCONCLUSIVE';
    let decreases = 0;
    let comparisons = 0;
    const ordered = [...successful].sort((left, right) => left.multiplier - right.multiplier);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1].minOutputRatioVsInputUsd;
      const current = ordered[index].minOutputRatioVsInputUsd;
      if (previous === null || current === null) continue;
      comparisons += 1;
      if (current < previous) decreases += 1;
    }
    if (comparisons === 0) return 'INCONCLUSIVE';
    return decreases >= Math.ceil(comparisons / 2) ? 'YES' : 'NO';
  })();

  const bestNet = [...successful].sort(
    (left, right) => (right.netProfitUsd ?? Number.NEGATIVE_INFINITY) - (left.netProfitUsd ?? Number.NEGATIVE_INFINITY)
  )[0] || null;
  const bestWorst = [...successful].sort(
    (left, right) =>
      (right.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY) -
      (left.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY)
  )[0] || null;

  return {
    successfulScenarioCount: successful.length,
    failedScenarioCount: failed.length,
    routeChangedBetweenNotionals: routeChanged,
    uniquePathSignatureCount: routeCounts.size,
    pathSignatureRanking: sortedCounts(routeCounts),
    dominantCauseRanking: sortedCounts(causeCounts),
    grossEdgeAlreadyNegative: grossAlwaysNegative,
    grossEdgePositiveButFeeDestroys: anyGrossPositiveFeeDestroyed,
    slippageIncreasesWithSizeUsd: slippageTrend,
    slippageIncreasesWithSizeBpsVsInput: slippageBpsTrend,
    minOutWorsensProportionallyWithSize: minOutTrend,
    bestNetProfitUsd: bestNet
      ? { notionalLevel: bestNet.notionalLevel, value: bestNet.netProfitUsd }
      : null,
    bestWorstCaseNetProfitUsd: bestWorst
      ? { notionalLevel: bestWorst.notionalLevel, value: bestWorst.worstCaseNetProfitUsd }
      : null,
    dominantCauseAggregate: sortedCounts(causeCounts)[0]?.label || 'UNKNOWN',
    setupHasPromisingRange: successful.some(
      result =>
        (result.netProfitUsd ?? Number.NEGATIVE_INFINITY) > 0 ||
        (result.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY) >= 0
    ),
  };
}

function printScenario(result) {
  console.log('');
  console.log(`[${result.notionalLevel}]`);
  if (!result.ok) {
    console.log(`status: ERROR`);
    console.log(`error: ${result.error}`);
    return;
  }
  console.log(`amount_in: ${result.amountIn}`);
  console.log(`route_hops: ${result.routeHops ?? 'n/a'}`);
  console.log(`execution_path_length: ${result.executionPathLength ?? 'n/a'}`);
  console.log(`route_path_length: ${result.routePathLength ?? 'n/a'}`);
  console.log(`path_signature: ${result.pathSignature}`);
  console.log(`input_usd: ${result.inputUsd ?? 'n/a'}`);
  console.log(`expected_output_usd: ${result.expectedOutputUsd ?? 'n/a'}`);
  console.log(`min_output_usd: ${result.minOutputUsd ?? 'n/a'}`);
  console.log(`gross_edge_usd: ${result.grossEdgeUsd ?? 'n/a'}`);
  console.log(`worst_case_gross_edge_usd: ${result.worstCaseGrossEdgeUsd ?? 'n/a'}`);
  console.log(`slippage_loss_usd: ${result.slippageLossUsd ?? 'n/a'}`);
  console.log(`network_fee_usd: ${result.networkFeeUsd ?? 'n/a'}`);
  console.log(`net_profit_usd: ${result.netProfitUsd ?? 'n/a'}`);
  console.log(`worst_case_net_profit_usd: ${result.worstCaseNetProfitUsd ?? 'n/a'}`);
  console.log(`output_ratio: ${result.outputRatio ?? 'n/a'}`);
  console.log(`decision: ${result.decision}`);
  console.log(`decision_reason: ${result.decisionReason}`);
  console.log(`dominant_cause: ${result.dominantCause}`);
}

function printSummary(summary) {
  console.log('');
  console.log('DOG-MM EDGE STUDY SUMMARY');
  console.log(`gross_edge_already_negative: ${summary.grossEdgeAlreadyNegative ? 'yes' : 'no'}`);
  console.log(`gross_edge_positive_but_fee_destroys: ${summary.grossEdgePositiveButFeeDestroys ? 'yes' : 'no'}`);
  console.log(`slippage_increases_with_size_usd: ${summary.slippageIncreasesWithSizeUsd}`);
  console.log(`slippage_increases_with_size_bps_vs_input: ${summary.slippageIncreasesWithSizeBpsVsInput}`);
  console.log(`minout_worsens_proportionally_with_size: ${summary.minOutWorsensProportionallyWithSize}`);
  console.log(`route_changed_between_notionals: ${summary.routeChangedBetweenNotionals ? 'yes' : 'no'}`);
  console.log(`dominant_cause_aggregate: ${summary.dominantCauseAggregate}`);
  console.log(
    `best_net_profit_usd: ${
      summary.bestNetProfitUsd ? `${summary.bestNetProfitUsd.value} @ ${summary.bestNetProfitUsd.notionalLevel}` : 'n/a'
    }`
  );
  console.log(
    `best_worst_case_net_profit_usd: ${
      summary.bestWorstCaseNetProfitUsd
        ? `${summary.bestWorstCaseNetProfitUsd.value} @ ${summary.bestWorstCaseNetProfitUsd.notionalLevel}`
        : 'n/a'
    }`
  );
  console.log(`setup_has_promising_range: ${summary.setupHasPromisingRange ? 'yes' : 'no'}`);
  console.log('');
  console.log('DOMINANT CAUSE RANKING');
  if (summary.dominantCauseRanking.length === 0) {
    console.log('1. UNKNOWN: 0');
  } else {
    summary.dominantCauseRanking.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.label}: ${entry.count}`);
    });
  }
  console.log('');
  console.log('PATH SIGNATURE RANKING');
  if (summary.pathSignatureRanking.length === 0) {
    console.log('1. no-path: 0');
  } else {
    summary.pathSignatureRanking.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.label}: ${entry.count}`);
    });
  }
}

function main() {
  loadRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const baseAmountIn = Math.max(
    1,
    Math.round(toFiniteNumber(args['base-amount-in'], toFiniteNumber(process.env.DOG_MM_AMOUNT_IN, 13479)))
  );
  const levels = parseList(
    args.levels || process.env.DOG_MM_EDGE_STUDY_LEVELS || process.env.DOG_MM_NOTIONAL_STUDY_LEVELS,
    '1,2,5,10,20,50,100'
  ).map(value => {
    const multiplier = toFiniteNumber(value, null);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`Invalid notional multiplier: ${value}`);
    }
    return { label: `${value}x`, multiplier };
  });

  const sharedArgs = {
    'wallet-name': args['wallet-name'] || process.env.DOG_MM_WALLET_NAME || '',
    'wallet-id': args['wallet-id'] || process.env.DOG_MM_WALLET_ID || '',
    'expected-address': args['expected-address'] || process.env.DOG_MM_EXPECTED_ADDRESS || '',
    'input-token': args['input-token'] || process.env.DOG_MM_INPUT_TOKEN || '',
    'output-token': args['output-token'] || process.env.DOG_MM_OUTPUT_TOKEN || '',
    'amm-strategy': args['amm-strategy'] || process.env.DOG_MM_AMM_STRATEGY || 'best',
    'input-token-usd': args['input-token-usd'] || process.env.DOG_MM_INPUT_TOKEN_USD || '',
    'output-token-usd': args['output-token-usd'] || process.env.DOG_MM_OUTPUT_TOKEN_USD || '',
    'stx-usd': args['stx-usd'] || process.env.DOG_MM_STX_USD || '',
    'input-token-decimals': args['input-token-decimals'] || process.env.DOG_MM_INPUT_TOKEN_DECIMALS || '',
    'output-token-decimals': args['output-token-decimals'] || process.env.DOG_MM_OUTPUT_TOKEN_DECIMALS || '',
    'slippage-tolerance': args['slippage-tolerance'] || process.env.DOG_MM_SLIPPAGE_TOLERANCE || '',
  };

  const baselineRaw = runScenario(0, baseAmountIn, levels[0], sharedArgs);
  const baselineContext = baselineRaw.ok
    ? {
        baselinePathSignature: baselineRaw.pathSignature,
        baselineGrossEdgeBps: baselineRaw.grossEdgeBps,
      }
    : {};

  const results = levels.map((level, index) => {
    if (index === 0) return baselineRaw;
    return runScenario(index, baseAmountIn, level, sharedArgs, baselineContext);
  }).map(result => {
    if (!result.ok || result.notionalLevel === levels[0].label) {
      return result.ok ? { ...result, dominantCause: classifyDominantCause(result, baselineContext) } : result;
    }
    return result;
  });

  const summary = analyzeResults(results);
  const study = {
    generatedAtUtc: new Date().toISOString(),
    baseAmountIn,
    paperModeExpected: true,
    broadcastAllowedExpected: false,
    levels,
    results,
    summary,
  };

  ensureDir(OUTPUT_JSON);
  fs.mkdirSync(STUDY_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(study, null, 2)}\n`);

  console.log('DOG-MM EDGE STUDY');
  console.log(`base_amount_in: ${baseAmountIn}`);
  console.log(`levels: ${levels.map(level => level.label).join(', ')}`);
  console.log(`paper_mode_expected: yes`);
  console.log(`broadcast_allowed_expected: no`);
  results.forEach(printScenario);
  printSummary(summary);
  console.log('');
  console.log(`study_json: ${OUTPUT_JSON}`);
}

try {
  main();
} catch (error) {
  console.error(`DOG-MM edge study failed: ${error.message}`);
  process.exit(1);
}
