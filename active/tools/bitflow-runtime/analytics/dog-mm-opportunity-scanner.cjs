#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv, buildChildEnv } = require('../runtime-env.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SAFE_WRAPPER = path.resolve(__dirname, '..', 'dog-mm-safe-wrapper.cjs');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-opportunity-scan.json');
const SCAN_DIR = path.resolve(STATE_DIR, 'opportunity-scan');

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

function parsePairList(value, fallbackPair) {
  const source = String(value || '').trim();
  if (!source) return fallbackPair;
  return source
    .split(/[;\n]/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [inputToken, outputToken] = item.split('>').map(part => part.trim());
      if (!inputToken || !outputToken) {
        throw new Error(`Invalid pair definition: ${item}`);
      }
      return { inputToken, outputToken };
    });
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

function buildPairCandidates(args) {
  const inputToken = args['input-token'] || process.env.DOG_MM_INPUT_TOKEN || '';
  const outputToken = args['output-token'] || process.env.DOG_MM_OUTPUT_TOKEN || '';
  const forward = [{ inputToken, outputToken }];
  const reverse = inputToken && outputToken ? [{ inputToken: outputToken, outputToken: inputToken }] : [];
  const parsed = parsePairList(args.pairs || process.env.DOG_MM_SCAN_PAIRS, [...forward, ...reverse]);

  const metadata = {
    inputToken,
    outputToken,
    inputTokenDecimals: args['input-token-decimals'] || process.env.DOG_MM_INPUT_TOKEN_DECIMALS || '',
    outputTokenDecimals: args['output-token-decimals'] || process.env.DOG_MM_OUTPUT_TOKEN_DECIMALS || '',
    inputTokenUsd: args['input-token-usd'] || process.env.DOG_MM_INPUT_TOKEN_USD || '',
    outputTokenUsd: args['output-token-usd'] || process.env.DOG_MM_OUTPUT_TOKEN_USD || '',
  };

  return parsed.map((pair, index) => {
    const isForward = pair.inputToken === metadata.inputToken && pair.outputToken === metadata.outputToken;
    const isReverse = pair.inputToken === metadata.outputToken && pair.outputToken === metadata.inputToken;
    return {
      pairId: `pair-${index + 1}:${pair.inputToken}->${pair.outputToken}`,
      inputToken: pair.inputToken,
      outputToken: pair.outputToken,
      direction: isForward ? 'FORWARD' : isReverse ? 'REVERSE' : 'CUSTOM',
      inputTokenDecimals: isForward
        ? metadata.inputTokenDecimals
        : isReverse
          ? metadata.outputTokenDecimals
          : '',
      outputTokenDecimals: isForward
        ? metadata.outputTokenDecimals
        : isReverse
          ? metadata.inputTokenDecimals
          : '',
      inputTokenUsd: isForward
        ? metadata.inputTokenUsd
        : isReverse
          ? metadata.outputTokenUsd
          : '',
      outputTokenUsd: isForward
        ? metadata.outputTokenUsd
        : isReverse
          ? metadata.inputTokenUsd
          : '',
    };
  });
}

function buildCandidates(args) {
  const baseAmountIn = Math.max(
    1,
    Math.round(toFiniteNumber(args['base-amount-in'], toFiniteNumber(process.env.DOG_MM_AMOUNT_IN, 13479)))
  );
  const notionals = parseList(
    args.levels || process.env.DOG_MM_SCAN_LEVELS || process.env.DOG_MM_NOTIONAL_STUDY_LEVELS,
    '1,2,5,10,20,50,100'
  ).map(value => {
    const multiplier = toFiniteNumber(value, null);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`Invalid notional multiplier: ${value}`);
    }
    return { label: `${value}x`, multiplier };
  });
  const ammStrategies = parseList(
    args['amm-strategies'] || process.env.DOG_MM_SCAN_AMM_STRATEGIES || process.env.DOG_MM_AMM_STRATEGY,
    'best'
  );
  const preferredAmmsRaw = String(args['preferred-amms'] || process.env.DOG_MM_SCAN_PREFERRED_AMMS || '')
    .split(',')
    .map(item => item.trim());
  const preferredAmms = preferredAmmsRaw.some(Boolean) ? preferredAmmsRaw.filter(Boolean) : [''];
  const pairs = buildPairCandidates(args);

  const candidates = [];
  let index = 0;
  for (const pair of pairs) {
    for (const strategy of ammStrategies) {
      for (const preferredAmm of preferredAmms) {
        for (const level of notionals) {
          index += 1;
          const amountIn = String(Math.max(1, Math.round(baseAmountIn * level.multiplier)));
          candidates.push({
            candidateId: `candidate-${index}`,
            pairId: pair.pairId,
            inputToken: pair.inputToken,
            outputToken: pair.outputToken,
            direction: pair.direction,
            amountIn,
            notionalLevel: level.label,
            multiplier: level.multiplier,
            ammStrategy: strategy,
            preferredAmm,
            inputTokenDecimals: pair.inputTokenDecimals,
            outputTokenDecimals: pair.outputTokenDecimals,
            inputTokenUsd: pair.inputTokenUsd,
            outputTokenUsd: pair.outputTokenUsd,
          });
        }
      }
    }
  }

  return { baseAmountIn, notionals, ammStrategies, preferredAmms, pairs, candidates };
}

function classifyDominantCause(metrics, options = {}) {
  const {
    baselinePathSignature = null,
    baselineGrossEdgeBps = null,
    routeDegradationBpsThreshold = 10,
  } = options;

  if (metrics.validation !== 'PASS') return 'VALIDATION_BLOCKED';
  if (
    baselinePathSignature &&
    metrics.pathSignature !== baselinePathSignature &&
    baselineGrossEdgeBps !== null &&
    metrics.grossEdgeBps !== null &&
    metrics.grossEdgeBps < baselineGrossEdgeBps - routeDegradationBpsThreshold
  ) {
    return 'ROUTE_DEGRADATION';
  }
  if (metrics.grossEdgeUsd !== null && metrics.grossEdgeUsd <= 0) return 'NEGATIVE_GROSS_EDGE';
  if (
    metrics.grossEdgeUsd !== null &&
    metrics.networkFeeUsd !== null &&
    metrics.grossEdgeUsd > 0 &&
    metrics.netProfitUsd !== null &&
    metrics.netProfitUsd <= 0 &&
    metrics.networkFeeUsd >= metrics.grossEdgeUsd
  ) {
    return 'FEE_DOMINATED';
  }
  if (
    metrics.slippageLossUsd !== null &&
    metrics.networkFeeUsd !== null &&
    metrics.slippageLossUsd >= metrics.networkFeeUsd &&
    metrics.worstCaseGrossEdgeUsd !== null &&
    metrics.worstCaseGrossEdgeUsd < 0
  ) {
    return 'SLIPPAGE_DOMINATED';
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

function calculateOpportunityScore(metrics, options = {}) {
  const {
    baselinePathSignature = null,
  } = options;
  let score = 0;

  score += (metrics.grossEdgeUsd ?? -10) * 40;
  score += (metrics.worstCaseGrossEdgeUsd ?? -10) * 15;
  score += (metrics.netProfitUsd ?? -10) * 60;
  score += (metrics.worstCaseNetProfitUsd ?? -10) * 25;

  score -= (metrics.slippageLossBpsVsInput ?? 1000) * 0.4;
  score -= (metrics.feeAsPercentOfInput ?? 100) * 8;
  score -= (metrics.executionPathLength ?? 5) * 12;
  score -= Math.max(0, (metrics.routeHops ?? 1) - 1) * 20;

  if (baselinePathSignature && metrics.pathSignature !== baselinePathSignature) {
    score -= 25;
  }
  if ((metrics.netProfitUsd ?? Number.NEGATIVE_INFINITY) <= 0) {
    score -= 200;
  }
  if ((metrics.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY) < 0) {
    score -= 300;
  }
  if (metrics.validation !== 'PASS') {
    score -= 400;
  }
  return round(score, 4);
}

function summarizeCandidate(candidate, payload, options = {}) {
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

  const result = {
    ok: true,
    candidateId: candidate.candidateId,
    pairId: candidate.pairId,
    inputToken: candidate.inputToken,
    outputToken: candidate.outputToken,
    direction: candidate.direction,
    amountIn: candidate.amountIn,
    notionalLevel: candidate.notionalLevel,
    ammStrategy: candidate.ammStrategy,
    preferredAmm: candidate.preferredAmm || null,
    routeHops: toFiniteNumber(plan?.quote?.totalHops),
    executionPathLength: toFiniteNumber(feeDiagnostics.executionPathLength),
    routePathLength: Array.isArray(plan?.quote?.routePath) ? plan.quote.routePath.length : null,
    pathSignature,
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
  result.opportunityScore = calculateOpportunityScore(result, options);
  return result;
}

function runCandidate(candidate, index, baselineByGroup) {
  const stateFile = path.resolve(SCAN_DIR, `${candidate.candidateId}.json`);
  const summaryFile = path.resolve(SCAN_DIR, `${candidate.candidateId}.md`);
  const childArgs = [
    SAFE_WRAPPER,
    '--json-only',
    '--amount-in',
    candidate.amountIn,
    '--max-amount-in',
    candidate.amountIn,
    '--amm-strategy',
    candidate.ammStrategy,
    '--input-token',
    candidate.inputToken,
    '--output-token',
    candidate.outputToken,
    '--state-file',
    stateFile,
    '--summary-file',
    summaryFile,
  ];

  if (candidate.preferredAmm) childArgs.push('--preferred-amm', candidate.preferredAmm);
  if (candidate.inputTokenDecimals) childArgs.push('--input-token-decimals', candidate.inputTokenDecimals);
  if (candidate.outputTokenDecimals) childArgs.push('--output-token-decimals', candidate.outputTokenDecimals);
  if (candidate.inputTokenUsd) childArgs.push('--input-token-usd', candidate.inputTokenUsd);
  if (candidate.outputTokenUsd) childArgs.push('--output-token-usd', candidate.outputTokenUsd);
  if (process.env.DOG_MM_STX_USD) childArgs.push('--stx-usd', process.env.DOG_MM_STX_USD);
  if (process.env.DOG_MM_WALLET_NAME) childArgs.push('--wallet-name', process.env.DOG_MM_WALLET_NAME);
  if (process.env.DOG_MM_WALLET_ID) childArgs.push('--wallet-id', process.env.DOG_MM_WALLET_ID);
  if (process.env.DOG_MM_EXPECTED_ADDRESS) childArgs.push('--expected-address', process.env.DOG_MM_EXPECTED_ADDRESS);
  if (process.env.DOG_MM_SLIPPAGE_TOLERANCE) childArgs.push('--slippage-tolerance', process.env.DOG_MM_SLIPPAGE_TOLERANCE);

  const result = spawnSync(process.execPath, childArgs, {
    cwd: ROOT,
    env: buildChildEnv(),
    encoding: 'utf8',
    windowsHide: true,
  });

  const baselineKey = `${candidate.pairId}|${candidate.ammStrategy}|${candidate.preferredAmm || ''}`;
  const baseline = baselineByGroup.get(baselineKey) || {};

  if (result.error) {
    return {
      ok: false,
      candidateId: candidate.candidateId,
      pairId: candidate.pairId,
      inputToken: candidate.inputToken,
      outputToken: candidate.outputToken,
      direction: candidate.direction,
      amountIn: candidate.amountIn,
      notionalLevel: candidate.notionalLevel,
      error: result.error.message,
    };
  }

  try {
    const payload = JSON.parse(result.stdout || '{}');
    return summarizeCandidate(candidate, payload, baseline);
  } catch (error) {
    return {
      ok: false,
      candidateId: candidate.candidateId,
      pairId: candidate.pairId,
      inputToken: candidate.inputToken,
      outputToken: candidate.outputToken,
      direction: candidate.direction,
      amountIn: candidate.amountIn,
      notionalLevel: candidate.notionalLevel,
      error: (result.stderr || result.stdout || error.message || `exit ${result.status}`).trim(),
    };
  }
}

function buildBaselineContext(candidates) {
  const baselineByGroup = new Map();
  const grouped = new Map();

  for (const candidate of candidates) {
    const key = `${candidate.pairId}|${candidate.ammStrategy}|${candidate.preferredAmm || ''}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(candidate);
  }

  for (const [key, group] of grouped.entries()) {
    const sorted = [...group].sort((left, right) => left.multiplier - right.multiplier);
    const baselineCandidate = sorted[0];
    const stateFile = path.resolve(SCAN_DIR, `${baselineCandidate.candidateId}.json`);
    const summaryFile = path.resolve(SCAN_DIR, `${baselineCandidate.candidateId}.md`);
    const childArgs = [
      SAFE_WRAPPER,
      '--json-only',
      '--amount-in',
      baselineCandidate.amountIn,
      '--max-amount-in',
      baselineCandidate.amountIn,
      '--amm-strategy',
      baselineCandidate.ammStrategy,
      '--input-token',
      baselineCandidate.inputToken,
      '--output-token',
      baselineCandidate.outputToken,
      '--state-file',
      stateFile,
      '--summary-file',
      summaryFile,
    ];

    if (baselineCandidate.preferredAmm) childArgs.push('--preferred-amm', baselineCandidate.preferredAmm);
    if (baselineCandidate.inputTokenDecimals) childArgs.push('--input-token-decimals', baselineCandidate.inputTokenDecimals);
    if (baselineCandidate.outputTokenDecimals) childArgs.push('--output-token-decimals', baselineCandidate.outputTokenDecimals);
    if (baselineCandidate.inputTokenUsd) childArgs.push('--input-token-usd', baselineCandidate.inputTokenUsd);
    if (baselineCandidate.outputTokenUsd) childArgs.push('--output-token-usd', baselineCandidate.outputTokenUsd);
    if (process.env.DOG_MM_STX_USD) childArgs.push('--stx-usd', process.env.DOG_MM_STX_USD);
    if (process.env.DOG_MM_WALLET_NAME) childArgs.push('--wallet-name', process.env.DOG_MM_WALLET_NAME);
    if (process.env.DOG_MM_WALLET_ID) childArgs.push('--wallet-id', process.env.DOG_MM_WALLET_ID);
    if (process.env.DOG_MM_EXPECTED_ADDRESS) childArgs.push('--expected-address', process.env.DOG_MM_EXPECTED_ADDRESS);
    if (process.env.DOG_MM_SLIPPAGE_TOLERANCE) childArgs.push('--slippage-tolerance', process.env.DOG_MM_SLIPPAGE_TOLERANCE);

    const result = spawnSync(process.execPath, childArgs, {
      cwd: ROOT,
      env: buildChildEnv(),
      encoding: 'utf8',
      windowsHide: true,
    });

    try {
      const payload = JSON.parse(result.stdout || '{}');
      const plan = payload?.plan || {};
      const inputUsd = toFiniteNumber(plan?.profitDiagnostics?.inputUsd);
      const expectedOutputUsd = toFiniteNumber(plan?.profitDiagnostics?.expectedOutputUsd);
      const grossEdgeUsd =
        inputUsd !== null && expectedOutputUsd !== null ? round(expectedOutputUsd - inputUsd) : null;
      const grossEdgeBps = ratioToBps(grossEdgeUsd, inputUsd);
      baselineByGroup.set(key, {
        baselinePathSignature: buildPathSignature(plan),
        baselineGrossEdgeBps: grossEdgeBps,
      });
    } catch {
      baselineByGroup.set(key, {});
    }
  }

  return baselineByGroup;
}

function analyzeCandidates(results) {
  const successful = results.filter(result => result.ok);
  const causeCounts = new Map();
  successful.forEach(result => incrementCounter(causeCounts, result.dominantCause));

  const ranked = [...successful].sort((left, right) => {
    if ((right.opportunityScore ?? Number.NEGATIVE_INFINITY) !== (left.opportunityScore ?? Number.NEGATIVE_INFINITY)) {
      return (right.opportunityScore ?? Number.NEGATIVE_INFINITY) - (left.opportunityScore ?? Number.NEGATIVE_INFINITY);
    }
    return (right.netProfitUsd ?? Number.NEGATIVE_INFINITY) - (left.netProfitUsd ?? Number.NEGATIVE_INFINITY);
  });

  const worst = [...successful].sort((left, right) => {
    if ((left.opportunityScore ?? Number.POSITIVE_INFINITY) !== (right.opportunityScore ?? Number.POSITIVE_INFINITY)) {
      return (left.opportunityScore ?? Number.POSITIVE_INFINITY) - (right.opportunityScore ?? Number.POSITIVE_INFINITY);
    }
    return (left.netProfitUsd ?? Number.POSITIVE_INFINITY) - (right.netProfitUsd ?? Number.POSITIVE_INFINITY);
  });

  const firstPositiveGross = ranked.find(candidate => (candidate.grossEdgeUsd ?? Number.NEGATIVE_INFINITY) > 0) || null;
  const firstPositiveNet = ranked.find(candidate => (candidate.netProfitUsd ?? Number.NEGATIVE_INFINITY) > 0) || null;
  const firstNonNegativeWorst = ranked.find(
    candidate => (candidate.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY) >= 0
  ) || null;
  const bestByScore = ranked[0] || null;
  const bestByNetProfit = [...successful].sort(
    (left, right) => (right.netProfitUsd ?? Number.NEGATIVE_INFINITY) - (left.netProfitUsd ?? Number.NEGATIVE_INFINITY)
  )[0] || null;
  const bestByWorstCase = [...successful].sort(
    (left, right) =>
      (right.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY) -
      (left.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY)
  )[0] || null;

  return {
    successfulCandidateCount: successful.length,
    failedCandidateCount: results.length - successful.length,
    dominantCauseAggregate: sortedCounts(causeCounts)[0]?.label || 'UNKNOWN',
    dominantCauseRanking: sortedCounts(causeCounts),
    topOpportunities: ranked.slice(0, 5),
    worstOpportunities: worst.slice(0, 5),
    firstPositiveGrossEdgeCandidate: firstPositiveGross,
    firstPositiveNetProfitCandidate: firstPositiveNet,
    firstNonNegativeWorstCaseCandidate: firstNonNegativeWorst,
    bestByScore,
    bestByNetProfit,
    bestByWorstCase,
    promisingCandidateExists: Boolean(firstPositiveNet || firstNonNegativeWorst),
  };
}

function printCandidate(prefix, candidate, rank = null) {
  if (!candidate) {
    console.log(`${prefix}: none`);
    return;
  }
  const head = rank ? `${rank}.` : `${prefix}:`;
  console.log(
    `${head} ${candidate.candidateId} | pair=${candidate.pairId} | notional=${candidate.notionalLevel} | strategy=${candidate.ammStrategy}${candidate.preferredAmm ? ` | preferred_amm=${candidate.preferredAmm}` : ''} | score=${candidate.opportunityScore ?? 'n/a'} | net=${candidate.netProfitUsd ?? 'n/a'} | worst=${candidate.worstCaseNetProfitUsd ?? 'n/a'} | cause=${candidate.dominantCause}`
  );
}

function printSummary(scan) {
  console.log('DOG-MM OPPORTUNITY SCANNER');
  console.log(`candidate_count: ${scan.results.length}`);
  console.log(`successful_candidate_count: ${scan.summary.successfulCandidateCount}`);
  console.log(`failed_candidate_count: ${scan.summary.failedCandidateCount}`);
  console.log(`paper_mode_expected: yes`);
  console.log(`broadcast_allowed_expected: no`);
  console.log('');
  console.log('TOP CANDIDATES');
  if (scan.summary.topOpportunities.length === 0) {
    console.log('1. none');
  } else {
    scan.summary.topOpportunities.forEach((candidate, index) => printCandidate('', candidate, index + 1));
  }
  console.log('');
  console.log('WORST CANDIDATES');
  if (scan.summary.worstOpportunities.length === 0) {
    console.log('1. none');
  } else {
    scan.summary.worstOpportunities.forEach((candidate, index) => printCandidate('', candidate, index + 1));
  }
  console.log('');
  printCandidate('BEST BY SCORE', scan.summary.bestByScore);
  printCandidate('BEST BY NET PROFIT', scan.summary.bestByNetProfit);
  printCandidate('BEST BY WORST CASE', scan.summary.bestByWorstCase);
  printCandidate('FIRST POSITIVE GROSS EDGE', scan.summary.firstPositiveGrossEdgeCandidate);
  printCandidate('FIRST POSITIVE NET PROFIT', scan.summary.firstPositiveNetProfitCandidate);
  printCandidate('FIRST NON-NEGATIVE WORST CASE', scan.summary.firstNonNegativeWorstCaseCandidate);
  console.log('');
  console.log('SCANNER CONCLUSION');
  console.log(`promising_candidate_exists: ${scan.summary.promisingCandidateExists ? 'yes' : 'no'}`);
  console.log(`dominant_cause_aggregate: ${scan.summary.dominantCauseAggregate}`);
  console.log(`next_step: ${scan.summary.promisingCandidateExists ? 'validate top candidate deeper in paper mode' : 'expand pair universe / alternative venues / route sources'}`);
  console.log('');
  console.log(`scan_json: ${OUTPUT_JSON}`);
}

function main() {
  loadRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const grid = buildCandidates(args);
  ensureDir(OUTPUT_JSON);
  fs.mkdirSync(SCAN_DIR, { recursive: true });

  const baselineByGroup = buildBaselineContext(grid.candidates);
  const results = grid.candidates.map((candidate, index) => runCandidate(candidate, index, baselineByGroup));
  const summary = analyzeCandidates(results);

  const scan = {
    generatedAtUtc: new Date().toISOString(),
    baseAmountIn: grid.baseAmountIn,
    notionals: grid.notionals,
    ammStrategies: grid.ammStrategies,
    preferredAmms: grid.preferredAmms,
    pairs: grid.pairs,
    candidates: grid.candidates.map(candidate => ({
      candidateId: candidate.candidateId,
      pairId: candidate.pairId,
      inputToken: candidate.inputToken,
      outputToken: candidate.outputToken,
      direction: candidate.direction,
      amountIn: candidate.amountIn,
      notionalLevel: candidate.notionalLevel,
      ammStrategy: candidate.ammStrategy,
      preferredAmm: candidate.preferredAmm || null,
    })),
    results,
    summary,
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(scan, null, 2)}\n`);
  printSummary(scan);
}

try {
  main();
} catch (error) {
  console.error(`DOG-MM opportunity scanner failed: ${error.message}`);
  process.exit(1);
}
