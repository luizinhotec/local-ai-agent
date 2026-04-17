#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv, buildChildEnv } = require('../runtime-env.cjs');
const { resolveCorePrices } = require('../diagnostics/price-feed.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SAFE_WRAPPER = path.resolve(__dirname, '..', 'dog-mm-safe-wrapper.cjs');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-universe-scan.json');
const OUTPUT_JSON_V2 = path.resolve(STATE_DIR, 'dog-mm-universe-scan-v2.json');
const SCAN_DIR = path.resolve(STATE_DIR, 'universe-scan');
const HODLMM_STATUS_FILE = path.resolve(ROOT, 'active', 'state', 'dog-mm-hodlmm-status.json');
const LAST_SWAP_PLAN_FILE = path.resolve(STATE_DIR, 'bitflow-last-swap-plan.json');
const LAST_LP_PLAN_FILE = path.resolve(STATE_DIR, 'bitflow-last-lp-add-plan.json');

const KNOWN_TOKEN_REGISTRY = {
  'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token': {
    symbol: 'sBTC',
    decimals: '8',
    usdHint: '',
  },
  'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx': {
    symbol: 'USDCx',
    decimals: '6',
    usdHint: '1',
  },
  'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2': {
    symbol: 'STX',
    decimals: '6',
    usdHint: '',
  },
};

const FAILURE_CATEGORY_PRIORITY = [
  'RUNTIME_COVERAGE',
  'ROUTING',
  'LIQUIDITY',
  'SAFETY',
  'ECONOMIC',
  'UNKNOWN',
];

const FAILURE_REASON_PRIORITY = [
  'MISSING_TOKEN_CONTRACT',
  'MISSING_ROUTE',
  'MISSING_QUOTE',
  'EXECUTION_PATH_UNRESOLVED',
  'ROUTE_INCOMPLETE',
  'INSUFFICIENT_LIQUIDITY',
  'SLIPPAGE_EXCEEDED',
  'MIN_OUTPUT_UNSAFE',
  'POST_CONDITION_RISK',
  'FEE_TOO_HIGH',
  'NEGATIVE_WORST_CASE',
  'NEGATIVE_EXPECTED_NET',
  'UNKNOWN_VALIDATION_BLOCK',
];

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

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function parseList(value, fallback) {
  const source = value || fallback;
  return String(source)
    .split(/[,\n;]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parsePairList(value) {
  return parseList(value, '')
    .map(item => {
      const [inputToken, outputToken] = item.split('>').map(part => part.trim());
      if (!inputToken || !outputToken) return null;
      return { inputToken, outputToken };
    })
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

function upsertFailure(failures, reason, category, details = {}) {
  const existing = failures.find(item => item.reason === reason);
  if (existing) {
    existing.details = { ...existing.details, ...details };
    return;
  }
  failures.push({ reason, category, details });
}

function getFailurePriority(failure) {
  const categoryIndex = FAILURE_CATEGORY_PRIORITY.indexOf(failure.category);
  const reasonIndex = FAILURE_REASON_PRIORITY.indexOf(failure.reason);
  return {
    categoryIndex: categoryIndex >= 0 ? categoryIndex : FAILURE_CATEGORY_PRIORITY.length,
    reasonIndex: reasonIndex >= 0 ? reasonIndex : FAILURE_REASON_PRIORITY.length,
  };
}

function sortFailures(failures) {
  return [...failures].sort((left, right) => {
    const leftPriority = getFailurePriority(left);
    const rightPriority = getFailurePriority(right);
    if (leftPriority.categoryIndex !== rightPriority.categoryIndex) {
      return leftPriority.categoryIndex - rightPriority.categoryIndex;
    }
    if (leftPriority.reasonIndex !== rightPriority.reasonIndex) {
      return leftPriority.reasonIndex - rightPriority.reasonIndex;
    }
    return left.reason.localeCompare(right.reason);
  });
}

function safeSymbol(token) {
  return KNOWN_TOKEN_REGISTRY[token]?.symbol || String(token || '').split('.').pop() || 'UNKNOWN';
}

function discoverSupportedTokens() {
  const tokens = new Map();
  for (const [tokenId, metadata] of Object.entries(KNOWN_TOKEN_REGISTRY)) {
    tokens.set(tokenId, { tokenId, ...metadata });
  }

  const envInput = process.env.DOG_MM_INPUT_TOKEN || '';
  const envOutput = process.env.DOG_MM_OUTPUT_TOKEN || '';
  if (envInput && !tokens.has(envInput)) {
    tokens.set(envInput, { tokenId: envInput, symbol: safeSymbol(envInput), decimals: '', usdHint: '' });
  }
  if (envOutput && !tokens.has(envOutput)) {
    tokens.set(envOutput, { tokenId: envOutput, symbol: safeSymbol(envOutput), decimals: '', usdHint: '' });
  }

  const lastSwapPlan = readJson(LAST_SWAP_PLAN_FILE);
  const routePath = Array.isArray(lastSwapPlan?.quote?.routePath) ? lastSwapPlan.quote.routePath : [];
  routePath.forEach(tokenId => {
    if (!tokens.has(tokenId)) {
      tokens.set(tokenId, { tokenId, symbol: safeSymbol(tokenId), decimals: '', usdHint: '' });
    }
  });

  const executionPath = Array.isArray(lastSwapPlan?.quote?.executionPath) ? lastSwapPlan.quote.executionPath : [];
  executionPath.forEach(step => {
    [step?.x_token_trait, step?.y_token_trait].forEach(tokenId => {
      if (tokenId && !tokens.has(tokenId)) {
        tokens.set(tokenId, { tokenId, symbol: safeSymbol(tokenId), decimals: '', usdHint: '' });
      }
    });
  });

  const lastLpPlan = readJson(LAST_LP_PLAN_FILE);
  [lastLpPlan?.xToken, lastLpPlan?.yToken].forEach(tokenId => {
    if (tokenId && !tokens.has(tokenId)) {
      tokens.set(tokenId, { tokenId, symbol: safeSymbol(tokenId), decimals: '', usdHint: '' });
    }
  });

  return Array.from(tokens.values());
}

function discoverKnownPools() {
  const pools = [];
  const hodlmm = readJson(HODLMM_STATUS_FILE);
  const recommended = Array.isArray(hodlmm?.recommendedTrainingPools) ? hodlmm.recommendedTrainingPools : [];
  recommended.forEach(pool => {
    pools.push({
      poolId: pool.pool_id || null,
      poolToken: pool.pool_token || null,
      poolSymbol: pool.pool_symbol || null,
      venue: 'bitflow-dlmm',
      routeMode: 'best:auto',
    });
  });
  return pools;
}

function tokenUsdHint(tokenId, resolvedPrices) {
  if (!tokenId) return '';
  const registry = KNOWN_TOKEN_REGISTRY[tokenId];
  if (registry?.usdHint) return registry.usdHint;
  if (registry?.symbol === 'STX' && Number.isFinite(resolvedPrices?.stxUsd)) {
    return String(resolvedPrices.stxUsd);
  }
  return '';
}

function tokenDecimals(tokenId) {
  return KNOWN_TOKEN_REGISTRY[tokenId]?.decimals || '';
}

function buildPairUniverse(args, resolvedPrices) {
  const explicitPairs = parsePairList(args.pairs || process.env.DOG_MM_UNIVERSE_PAIRS || process.env.DOG_MM_SCAN_PAIRS);
  if (explicitPairs.length > 0) {
    return explicitPairs.map((pair, index) => ({
      pairId: `pair-${index + 1}:${pair.inputToken}->${pair.outputToken}`,
      inputToken: pair.inputToken,
      outputToken: pair.outputToken,
      direction: 'CUSTOM',
      inputTokenDecimals: tokenDecimals(pair.inputToken),
      outputTokenDecimals: tokenDecimals(pair.outputToken),
      inputTokenUsd: tokenUsdHint(pair.inputToken, resolvedPrices),
      outputTokenUsd: tokenUsdHint(pair.outputToken, resolvedPrices),
    }));
  }

  const tokens = discoverSupportedTokens();
  const pairs = [];
  let pairIndex = 0;
  for (const input of tokens) {
    for (const output of tokens) {
      if (input.tokenId === output.tokenId) continue;
      pairIndex += 1;
      pairs.push({
        pairId: `pair-${pairIndex}:${input.tokenId}->${output.tokenId}`,
        inputToken: input.tokenId,
        outputToken: output.tokenId,
        direction: `${input.symbol}->${output.symbol}`,
        inputTokenDecimals: input.decimals || '',
        outputTokenDecimals: output.decimals || '',
        inputTokenUsd: tokenUsdHint(input.tokenId, resolvedPrices),
        outputTokenUsd: tokenUsdHint(output.tokenId, resolvedPrices),
      });
    }
  }
  return pairs;
}

function buildCandidates(args, resolvedPrices) {
  const baseAmountIn = Math.max(
    1,
    Math.round(toFiniteNumber(args['base-amount-in'], toFiniteNumber(process.env.DOG_MM_AMOUNT_IN, 13479)))
  );
  const notionals = parseList(
    args.levels || process.env.DOG_MM_UNIVERSE_LEVELS || process.env.DOG_MM_SCAN_LEVELS || process.env.DOG_MM_NOTIONAL_STUDY_LEVELS,
    '1,2,5,10,20,50,100'
  ).map(value => {
    const multiplier = toFiniteNumber(value, null);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`Invalid notional multiplier: ${value}`);
    }
    return { label: `${value}x`, multiplier };
  });
  const ammStrategies = parseList(
    args['amm-strategies'] || process.env.DOG_MM_UNIVERSE_AMM_STRATEGIES || process.env.DOG_MM_SCAN_AMM_STRATEGIES || process.env.DOG_MM_AMM_STRATEGY,
    'best'
  );
  const preferredAmmsRaw = parseList(
    args['preferred-amms'] || process.env.DOG_MM_UNIVERSE_PREFERRED_AMMS || process.env.DOG_MM_SCAN_PREFERRED_AMMS,
    ''
  );
  const preferredAmms = preferredAmmsRaw.length > 0 ? preferredAmmsRaw : [''];
  const pairs = buildPairUniverse(args, resolvedPrices);

  const candidates = [];
  let index = 0;
  for (const pair of pairs) {
    for (const strategy of ammStrategies) {
      for (const preferredAmm of preferredAmms) {
        for (const level of notionals) {
          index += 1;
          candidates.push({
            candidateId: `candidate-${index}`,
            pairId: pair.pairId,
            inputToken: pair.inputToken,
            outputToken: pair.outputToken,
            direction: pair.direction,
            amountIn: String(Math.max(1, Math.round(baseAmountIn * level.multiplier))),
            notionalLevel: level.label,
            multiplier: level.multiplier,
            ammStrategy: strategy,
            preferredAmm,
            routeMode: `${strategy}:${preferredAmm || 'auto'}`,
            inputTokenDecimals: pair.inputTokenDecimals,
            outputTokenDecimals: pair.outputTokenDecimals,
            inputTokenUsd: pair.inputTokenUsd,
            outputTokenUsd: pair.outputTokenUsd,
          });
        }
      }
    }
  }

  return {
    baseAmountIn,
    notionals,
    ammStrategies,
    preferredAmms,
    pairs,
    candidates,
    knownPools: discoverKnownPools(),
  };
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

function classifyVenue(plan) {
  const executionPath = Array.isArray(plan?.quote?.executionPath) ? plan.quote.executionPath : [];
  if (executionPath.length === 0) return 'unknown';
  const labels = new Set(
    executionPath
      .map(step => String(step?.pool_trait || step?.pool_id || '').toLowerCase())
      .filter(Boolean)
      .map(value => (value.includes('dlmm') ? 'bitflow-dlmm' : 'bitflow-other'))
  );
  if (labels.size === 1) return Array.from(labels)[0];
  return 'bitflow-mixed';
}

function extractPoolId(plan) {
  const executionPath = Array.isArray(plan?.quote?.executionPath) ? plan.quote.executionPath : [];
  const uniquePools = Array.from(
    new Set(executionPath.map(step => step?.pool_trait || step?.pool_id).filter(Boolean))
  );
  if (uniquePools.length === 0) return null;
  if (uniquePools.length === 1) return uniquePools[0];
  return uniquePools.join(' | ');
}

function classifyDominantCause(metrics) {
  if (metrics.validation !== 'PASS') return 'VALIDATION_BLOCKED';
  if (metrics.grossEdgeUsd !== null && metrics.grossEdgeUsd <= 0) return 'NEGATIVE_GROSS_EDGE';
  if (
    metrics.grossEdgeUsd !== null &&
    metrics.grossEdgeUsd > 0 &&
    metrics.networkFeeUsd !== null &&
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
    metrics.pathSignature &&
    metrics.executionPathLength !== null &&
    metrics.executionPathLength > 1
  ) {
    return 'ROUTE_DEGRADATION';
  }
  if (metrics.worstCaseNetProfitUsd !== null && metrics.worstCaseNetProfitUsd < 0) {
    return 'WORST_CASE_DOMINATED';
  }
  return 'COMBINATION';
}

function buildValidationFailureReport(candidate, payload, metrics) {
  const plan = payload.plan || payload || {};
  const validation = payload.validation || {};
  const policy = payload.policy || {};
  const failures = [];
  const routePath = Array.isArray(plan?.quote?.routePath) ? plan.quote.routePath : [];
  const executionPath = Array.isArray(plan?.quote?.executionPath) ? plan.quote.executionPath : [];
  const postConditions = Array.isArray(plan?.swap?.postConditions) ? plan.swap.postConditions : [];
  const validationErrors = Array.isArray(validation?.errors) ? validation.errors : [];

  [candidate.inputToken, candidate.outputToken].forEach(tokenId => {
    if (tokenId && !KNOWN_TOKEN_REGISTRY[tokenId]) {
      upsertFailure(failures, 'MISSING_TOKEN_CONTRACT', 'RUNTIME_COVERAGE', {
        token: tokenId,
      });
    }
  });

  if (!plan.quote) {
    upsertFailure(failures, 'MISSING_QUOTE', 'ROUTING', {
      pairId: candidate.pairId,
    });
  }

  if (routePath.length === 0) {
    upsertFailure(failures, 'MISSING_ROUTE', 'ROUTING', {
      pairId: candidate.pairId,
    });
  } else if (routePath.length < 2 || !routePath.includes(candidate.inputToken) || !routePath.includes(candidate.outputToken)) {
    upsertFailure(failures, 'ROUTE_INCOMPLETE', 'ROUTING', {
      routePath,
    });
  }

  if (executionPath.length === 0) {
    upsertFailure(failures, 'EXECUTION_PATH_UNRESOLVED', 'ROUTING', {
      pathSignature: metrics.pathSignature,
    });
  }

  if (
    plan?.quote?.executionDetails?.max_bins_reached === true ||
    (Array.isArray(plan?.quote?.executionDetails?.hop_details) &&
      plan.quote.executionDetails.hop_details.some(detail => detail?.max_bins_reached === true))
  ) {
    upsertFailure(failures, 'INSUFFICIENT_LIQUIDITY', 'LIQUIDITY', {
      poolId: metrics.poolId,
      pathSignature: metrics.pathSignature,
    });
  }

  if (validationErrors.some(error => error.includes('outputRatio') && error.includes('below minOutputRatio'))) {
    upsertFailure(failures, 'SLIPPAGE_EXCEEDED', 'LIQUIDITY', {
      outputRatio: validation?.metrics?.outputRatio ?? null,
      minOutputRatio: policy?.minOutputRatio ?? null,
    });
  }

  if (validationErrors.some(error => error.includes('feePerByte') || error.includes('feeAsPercentOfGrossProfit'))) {
    upsertFailure(failures, 'FEE_TOO_HIGH', 'ECONOMIC', {
      feePerByte: validation?.metrics?.feePerByte ?? null,
      feeAsPercentOfGrossProfit: validation?.metrics?.feeAsPercentOfGrossProfit ?? null,
    });
  }

  if (
    postConditions.length === 0 ||
    postConditions.some(condition => String(condition?.token_asset_name || '').toLowerCase() === 'unknown')
  ) {
    upsertFailure(failures, 'POST_CONDITION_RISK', 'SAFETY', {
      postConditionCount: postConditions.length,
      poolId: metrics.poolId,
    });
  }

  if (
    Number.isFinite(metrics.minOutputUsd) &&
    Number.isFinite(metrics.inputUsd) &&
    metrics.minOutputUsd < metrics.inputUsd
  ) {
    upsertFailure(failures, 'MIN_OUTPUT_UNSAFE', 'SAFETY', {
      minOutputUsd: metrics.minOutputUsd,
      inputUsd: metrics.inputUsd,
    });
  }

  if (
    Number.isFinite(metrics.worstCaseNetProfitUsd) &&
    metrics.worstCaseNetProfitUsd < toFiniteNumber(plan?.minWorstCaseNetUsd, 0)
  ) {
    upsertFailure(failures, 'NEGATIVE_WORST_CASE', 'ECONOMIC', {
      worstCaseNetProfitUsd: metrics.worstCaseNetProfitUsd,
      threshold: toFiniteNumber(plan?.minWorstCaseNetUsd, 0),
      decisionReason: plan?.decisionReason || null,
    });
  }

  if (
    Number.isFinite(metrics.netProfitUsd) &&
    metrics.netProfitUsd < toFiniteNumber(plan?.minExpectedNetUsd, 0.1)
  ) {
    upsertFailure(failures, 'NEGATIVE_EXPECTED_NET', 'ECONOMIC', {
      expectedNetProfitUsd: metrics.netProfitUsd,
      threshold: toFiniteNumber(plan?.minExpectedNetUsd, 0.1),
      decisionReason: plan?.decisionReason || null,
    });
  }

  if (validationErrors.length > 0 && failures.length === 0) {
    upsertFailure(failures, 'UNKNOWN_VALIDATION_BLOCK', 'UNKNOWN', {
      validationErrors,
    });
  }

  const sorted = sortFailures(failures);
  return {
    validationStatus: validation?.ok === true ? 'PASS' : 'BLOCKED',
    validationFailureReason: sorted[0]?.reason || null,
    validationFailureCategory: sorted[0]?.category || null,
    primaryValidationFailureReason: sorted[0]?.reason || null,
    primaryValidationFailureCategory: sorted[0]?.category || null,
    secondaryValidationFailureReasons: sorted.slice(1).map(item => item.reason),
    failures: sorted,
  };
}

function calculateOpportunityScore(metrics) {
  let score = 0;
  score += (metrics.grossEdgeUsd ?? -5) * 120;
  score += (metrics.worstCaseGrossEdgeUsd ?? -5) * 140;
  score += (metrics.netProfitUsd ?? -5) * 180;
  score += (metrics.worstCaseNetProfitUsd ?? -5) * 220;
  score -= (metrics.slippageLossBpsVsInput ?? 1000) * 0.35;
  score -= (metrics.feeAsPercentOfInput ?? 100) * 6;
  score -= (metrics.executionPathLength ?? 5) * 12;
  score -= Math.max(0, (metrics.routeHops ?? 1) - 1) * 20;
  if (metrics.netProfitUsd === null || metrics.netProfitUsd <= 0) score -= 500;
  if (metrics.worstCaseNetProfitUsd === null || metrics.worstCaseNetProfitUsd < 0) score -= 700;
  if (metrics.validation !== 'PASS') score -= 900;
  return round(score, 4);
}

function computeMetrics(candidate, payload) {
  const plan = payload.plan || payload;
  const profit = plan.profitDiagnostics || {};
  const feeDiagnostics = plan.feeDiagnostics || {};
  const pathSignature = buildPathSignature(plan);
  const routePathSignature = buildRoutePathSignature(plan);
  const venue = classifyVenue(plan);
  const poolId = extractPoolId(plan);
  const routeHops = toFiniteNumber(plan?.quote?.totalHops);
  const executionPathLength = toFiniteNumber(feeDiagnostics.executionPathLength);
  const routePathLength = Array.isArray(plan?.quote?.routePath) ? plan.quote.routePath.length : null;
  const inputUsd = toFiniteNumber(profit.inputUsd);
  const expectedOutputUsd = toFiniteNumber(profit.expectedOutputUsd);
  const minOutputUsd = toFiniteNumber(profit.minOutputUsd);
  const networkFeeUsd = toFiniteNumber(profit.networkFeeUsd);
  const grossEdgeUsd =
    Number.isFinite(expectedOutputUsd) && Number.isFinite(inputUsd) ? expectedOutputUsd - inputUsd : null;
  const worstCaseGrossEdgeUsd =
    Number.isFinite(minOutputUsd) && Number.isFinite(inputUsd) ? minOutputUsd - inputUsd : null;
  const slippageLossUsd =
    Number.isFinite(expectedOutputUsd) && Number.isFinite(minOutputUsd) ? expectedOutputUsd - minOutputUsd : null;
  const netProfitUsd =
    Number.isFinite(grossEdgeUsd) && Number.isFinite(networkFeeUsd) ? grossEdgeUsd - networkFeeUsd : null;
  const worstCaseNetProfitUsd =
    Number.isFinite(worstCaseGrossEdgeUsd) && Number.isFinite(networkFeeUsd)
      ? worstCaseGrossEdgeUsd - networkFeeUsd
      : null;
  const grossEdgeBps = ratioToBps(grossEdgeUsd, inputUsd);
  const worstCaseGrossEdgeBps = ratioToBps(worstCaseGrossEdgeUsd, inputUsd);
  const slippageLossBpsVsInput = ratioToBps(slippageLossUsd, inputUsd);
  const slippageLossBpsVsExpectedOutput = ratioToBps(slippageLossUsd, expectedOutputUsd);
  const feeAsPercentOfInput =
    Number.isFinite(networkFeeUsd) && Number.isFinite(inputUsd) && inputUsd !== 0
      ? round((networkFeeUsd / inputUsd) * 100, 6)
      : null;
  const feeAsPercentOfExpectedOutput =
    Number.isFinite(networkFeeUsd) && Number.isFinite(expectedOutputUsd) && expectedOutputUsd !== 0
      ? round((networkFeeUsd / expectedOutputUsd) * 100, 6)
      : null;
  const feeAsPercentOfGrossEdge =
    Number.isFinite(networkFeeUsd) && Number.isFinite(grossEdgeUsd) && grossEdgeUsd > 0
      ? round((networkFeeUsd / grossEdgeUsd) * 100, 6)
      : null;
  const netProfitBps = ratioToBps(netProfitUsd, inputUsd);
  const worstCaseNetProfitBps = ratioToBps(worstCaseNetProfitUsd, inputUsd);

  const result = {
    candidateId: candidate.candidateId,
    universeId: `${candidate.pairId}|${candidate.direction}|${candidate.routeMode}|${venue}|${pathSignature}`,
    pairId: candidate.pairId,
    inputToken: candidate.inputToken,
    outputToken: candidate.outputToken,
    direction: candidate.direction,
    venue,
    poolId,
    routeMode: candidate.routeMode,
    routeHops,
    executionPathLength,
    routePathLength,
    pathSignature,
    amountIn: candidate.amountIn,
    notionalLevel: candidate.notionalLevel,
    inputUsd,
    expectedOutputUsd,
    minOutputUsd,
    grossEdgeUsd,
    worstCaseGrossEdgeUsd,
    networkFeeUsd,
    slippageLossUsd,
    netProfitUsd,
    worstCaseNetProfitUsd,
    grossEdgeBps,
    worstCaseGrossEdgeBps,
    slippageLossBpsVsInput,
    slippageLossBpsVsExpectedOutput,
    feePerByte: toFiniteNumber(feeDiagnostics.feePerByte),
    feeAsPercentOfInput,
    feeAsPercentOfExpectedOutput,
    feeAsPercentOfGrossEdge,
    netProfitBps,
    worstCaseNetProfitBps,
    validation: payload?.validation?.ok === true ? 'PASS' : 'BLOCKED',
    validationStatus: payload?.validation?.ok === true ? 'PASS' : 'BLOCKED',
    decision: String(plan.decision || '').toUpperCase() || 'UNKNOWN',
    decisionReason: plan.decisionReason || null,
    pathSignatureRoute: routePathSignature,
    opportunityScore: null,
    dominantCause: null,
    expectedNetProfitUsd: netProfitUsd,
    worstCaseNetProfitUsd,
    isEconomicallyPositiveExpected: Number.isFinite(netProfitUsd) ? netProfitUsd > 0 : false,
    isEconomicallyPositiveWorstCase: Number.isFinite(worstCaseNetProfitUsd) ? worstCaseNetProfitUsd >= 0 : false,
  };
  const validationReport = buildValidationFailureReport(candidate, payload, result);
  result.validationFailureReason = validationReport.validationFailureReason;
  result.validationFailureCategory = validationReport.validationFailureCategory;
  result.primaryValidationFailureReason = validationReport.primaryValidationFailureReason;
  result.primaryValidationFailureCategory = validationReport.primaryValidationFailureCategory;
  result.secondaryValidationFailureReasons = validationReport.secondaryValidationFailureReasons;
  result.validationFailures = validationReport.failures;
  result.dominantCause = result.primaryValidationFailureReason || classifyDominantCause(result);
  result.opportunityScore = calculateOpportunityScore(result);
  return result;
}

function buildChildArgs(candidate, stateFile) {
  const childArgs = [
    SAFE_WRAPPER,
    '--json-only',
    '--amount-in',
    candidate.amountIn,
    '--amm-strategy',
    candidate.ammStrategy,
    '--input-token',
    candidate.inputToken,
    '--output-token',
    candidate.outputToken,
    '--state-file',
    stateFile,
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
  return childArgs;
}

function runCandidate(candidate) {
  const stateFile = path.resolve(SCAN_DIR, `${candidate.candidateId}.json`);
  const childArgs = buildChildArgs(candidate, stateFile);
  const result = spawnSync(process.execPath, childArgs, {
    cwd: ROOT,
    stdio: 'pipe',
    env: buildChildEnv(),
    encoding: 'utf8',
    windowsHide: true,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (result.error) {
    return { ok: false, error: result.error.message, stdout, stderr, stateFile };
  }
  if (result.status !== 0) {
    return { ok: false, error: `safe wrapper exited with code ${result.status}`, stdout, stderr, stateFile };
  }
  let payload = null;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    return { ok: false, error: `invalid json output: ${error.message}`, stdout, stderr, stateFile };
  }
  return { ok: true, payload, stdout, stderr, stateFile };
}

function bestByDimension(results, key) {
  const grouped = new Map();
  results.forEach(result => {
    const value = result[key] ?? 'UNKNOWN';
    const current = grouped.get(value);
    if (!current || (result.opportunityScore ?? -Infinity) > (current.opportunityScore ?? -Infinity)) {
      grouped.set(value, result);
    }
  });
  return Array.from(grouped.entries())
    .map(([label, candidate]) => ({ label, candidate }))
    .sort((left, right) => (right.candidate.opportunityScore ?? -Infinity) - (left.candidate.opportunityScore ?? -Infinity));
}

function aggregateUniverse(results) {
  const grouped = new Map();
  results.forEach(result => {
    const key = result.universeId;
    if (!grouped.has(key)) {
      grouped.set(key, {
        universeId: key,
        pairId: result.pairId,
        inputToken: result.inputToken,
        outputToken: result.outputToken,
        direction: result.direction,
        venue: result.venue,
        poolId: result.poolId,
        routeMode: result.routeMode,
        pathSignature: result.pathSignature,
        totalCandidates: 0,
        positiveGrossEdgeCount: 0,
        positiveNetProfitCount: 0,
        nonNegativeWorstCaseCount: 0,
        validationPassCount: 0,
        netProfitUsdValues: [],
        worstCaseNetProfitUsdValues: [],
        dominantCauseCounts: new Map(),
      });
    }
    const item = grouped.get(key);
    item.totalCandidates += 1;
    if ((result.grossEdgeUsd ?? -Infinity) > 0) item.positiveGrossEdgeCount += 1;
    if ((result.netProfitUsd ?? -Infinity) > 0) item.positiveNetProfitCount += 1;
    if ((result.worstCaseNetProfitUsd ?? -Infinity) >= 0) item.nonNegativeWorstCaseCount += 1;
    if (result.validation === 'PASS') item.validationPassCount += 1;
    if (Number.isFinite(result.netProfitUsd)) item.netProfitUsdValues.push(result.netProfitUsd);
    if (Number.isFinite(result.worstCaseNetProfitUsd)) item.worstCaseNetProfitUsdValues.push(result.worstCaseNetProfitUsd);
    incrementCounter(item.dominantCauseCounts, result.dominantCause);
  });

  return Array.from(grouped.values())
    .map(item => ({
      universeId: item.universeId,
      pairId: item.pairId,
      inputToken: item.inputToken,
      outputToken: item.outputToken,
      direction: item.direction,
      venue: item.venue,
      poolId: item.poolId,
      routeMode: item.routeMode,
      pathSignature: item.pathSignature,
      totalCandidates: item.totalCandidates,
      positiveGrossEdgeCount: item.positiveGrossEdgeCount,
      positiveNetProfitCount: item.positiveNetProfitCount,
      nonNegativeWorstCaseCount: item.nonNegativeWorstCaseCount,
      validationPassCount: item.validationPassCount,
      avgNetProfitUsd:
        item.netProfitUsdValues.length > 0
          ? round(item.netProfitUsdValues.reduce((sum, value) => sum + value, 0) / item.netProfitUsdValues.length)
          : null,
      avgWorstCaseNetProfitUsd:
        item.worstCaseNetProfitUsdValues.length > 0
          ? round(
              item.worstCaseNetProfitUsdValues.reduce((sum, value) => sum + value, 0) /
                item.worstCaseNetProfitUsdValues.length
            )
          : null,
      dominantCauseAggregate: sortedCounts(item.dominantCauseCounts)[0]?.label || 'UNKNOWN',
    }))
    .sort((left, right) => {
      if ((right.avgWorstCaseNetProfitUsd ?? -Infinity) !== (left.avgWorstCaseNetProfitUsd ?? -Infinity)) {
        return (right.avgWorstCaseNetProfitUsd ?? -Infinity) - (left.avgWorstCaseNetProfitUsd ?? -Infinity);
      }
      return (right.avgNetProfitUsd ?? -Infinity) - (left.avgNetProfitUsd ?? -Infinity);
    });
}

function buildSummary(results, errors) {
  const successful = results.filter(result => result.validation);
  const ranked = [...successful].sort(
    (left, right) => (right.opportunityScore ?? -Infinity) - (left.opportunityScore ?? -Infinity)
  );
  const worst = [...successful].sort(
    (left, right) => (left.opportunityScore ?? Infinity) - (right.opportunityScore ?? Infinity)
  );
  const causeCounts = new Map();
  const failureReasonCounts = new Map();
  const failureCategoryCounts = new Map();
  successful.forEach(result => incrementCounter(causeCounts, result.dominantCause));
  successful.forEach(result => {
    incrementCounter(failureReasonCounts, result.primaryValidationFailureReason || 'NONE');
    incrementCounter(failureCategoryCounts, result.primaryValidationFailureCategory || 'NONE');
  });
  const universes = aggregateUniverse(successful);

  const firstPositiveGrossEdge = ranked.find(result => (result.grossEdgeUsd ?? -Infinity) > 0) || null;
  const firstPositiveNetProfit = ranked.find(result => (result.netProfitUsd ?? -Infinity) > 0) || null;
  const firstNonNegativeWorstCase = ranked.find(result => (result.worstCaseNetProfitUsd ?? -Infinity) >= 0) || null;
  const promisingUniverses = universes.filter(
    universe =>
      universe.validationPassCount > 0 &&
      universe.positiveNetProfitCount > 0 &&
      universe.nonNegativeWorstCaseCount > 0
  );
  const lessBadUniverses = universes.filter(
    universe =>
      !promisingUniverses.some(item => item.universeId === universe.universeId) &&
      (universe.positiveNetProfitCount > 0 || (universe.avgNetProfitUsd ?? -Infinity) > -0.05)
  );
  const rejectedUniverses = universes.filter(
    universe =>
      !promisingUniverses.some(item => item.universeId === universe.universeId) &&
      !lessBadUniverses.some(item => item.universeId === universe.universeId)
  );

  return {
    candidateCount: results.length + errors.length,
    successfulCandidateCount: successful.length,
    failedCandidateCount: errors.length,
    bestOverallCandidates: ranked.slice(0, 10),
    worstCandidates: worst.slice(0, 10),
    bestByPair: bestByDimension(successful, 'pairId'),
    bestByDirection: bestByDimension(successful, 'direction'),
    bestByVenue: bestByDimension(successful, 'venue'),
    bestByRouteMode: bestByDimension(successful, 'routeMode'),
    bestByNotional: bestByDimension(successful, 'notionalLevel'),
    universes,
    promisingUniverses,
    lessBadUniverses,
    rejectedUniverses,
    bestOverall: ranked[0] || null,
    firstPositiveGrossEdgeCandidate: firstPositiveGrossEdge,
    firstPositiveNetProfitCandidate: firstPositiveNetProfit,
    firstNonNegativeWorstCaseCandidate: firstNonNegativeWorstCase,
    promisingUniverseExists: promisingUniverses.length > 0,
    dominantCauseAggregate: sortedCounts(causeCounts)[0]?.label || 'UNKNOWN',
    validationFailureReasonCounts: sortedCounts(failureReasonCounts),
    validationFailureCategoryCounts: sortedCounts(failureCategoryCounts),
    economicFailureCount: successful.filter(result => result.primaryValidationFailureCategory === 'ECONOMIC').length,
    runtimeCoverageFailureCount: successful.filter(result => result.primaryValidationFailureCategory === 'RUNTIME_COVERAGE').length,
    routingFailureCount: successful.filter(result => result.primaryValidationFailureCategory === 'ROUTING').length,
    liquidityFailureCount: successful.filter(result => result.primaryValidationFailureCategory === 'LIQUIDITY').length,
    safetyFailureCount: successful.filter(result => result.primaryValidationFailureCategory === 'SAFETY').length,
    unknownFailureCount: successful.filter(result => result.primaryValidationFailureCategory === 'UNKNOWN').length,
    topExpectedNetCandidates: [...successful]
      .sort((left, right) => (right.expectedNetProfitUsd ?? -Infinity) - (left.expectedNetProfitUsd ?? -Infinity))
      .slice(0, 10),
    topWorstCaseNetCandidates: [...successful]
      .sort((left, right) => (right.worstCaseNetProfitUsd ?? -Infinity) - (left.worstCaseNetProfitUsd ?? -Infinity))
      .slice(0, 10),
  };
}

function formatCandidate(candidate, rank = null) {
  if (!candidate) return 'none';
  const head = rank ? `${rank}.` : '-';
  return `${head} ${candidate.candidateId} | universe=${candidate.universeId} | pair=${candidate.pairId} | direction=${candidate.direction} | venue=${candidate.venue} | route_mode=${candidate.routeMode} | notional=${candidate.notionalLevel} | score=${candidate.opportunityScore ?? 'n/a'} | net=${candidate.netProfitUsd ?? 'n/a'} | worst=${candidate.worstCaseNetProfitUsd ?? 'n/a'} | cause=${candidate.dominantCause}`;
}

function formatDimensionGroup(title, groups, limit = 10) {
  console.log(title);
  groups.slice(0, limit).forEach((item, index) => {
    console.log(
      `${index + 1}. ${item.label} | candidate=${item.candidate.candidateId} | score=${item.candidate.opportunityScore ?? 'n/a'} | net=${item.candidate.netProfitUsd ?? 'n/a'} | worst=${item.candidate.worstCaseNetProfitUsd ?? 'n/a'} | cause=${item.candidate.dominantCause}`
    );
  });
  if (groups.length === 0) console.log('none');
  console.log('');
}

function printScan(scan) {
  console.log('DOG-MM UNIVERSE SCAN');
  console.log(`candidate_count: ${scan.summary.candidateCount}`);
  console.log(`successful_candidate_count: ${scan.summary.successfulCandidateCount}`);
  console.log(`failed_candidate_count: ${scan.summary.failedCandidateCount}`);
  console.log('paper_mode_expected: yes');
  console.log('broadcast_allowed_expected: no');
  console.log('');

  console.log('BEST OVERALL');
  scan.summary.bestOverallCandidates.slice(0, 10).forEach((candidate, index) => {
    console.log(formatCandidate(candidate, index + 1));
  });
  if (scan.summary.bestOverallCandidates.length === 0) console.log('none');
  console.log('');

  formatDimensionGroup('BEST BY PAIR', scan.summary.bestByPair);
  formatDimensionGroup('BEST BY VENUE', scan.summary.bestByVenue);
  formatDimensionGroup('BEST BY DIRECTION', scan.summary.bestByDirection);
  formatDimensionGroup('BEST BY ROUTE MODE', scan.summary.bestByRouteMode);
  formatDimensionGroup('BEST BY NOTIONAL', scan.summary.bestByNotional);

  console.log('TOP FAILURE REASONS');
  scan.summary.validationFailureReasonCounts.slice(0, 10).forEach((item, index) => {
    console.log(`${index + 1}. ${item.label} | count=${item.count}`);
  });
  if (scan.summary.validationFailureReasonCounts.length === 0) console.log('none');
  console.log('');

  console.log('TOP FAILURE CATEGORIES');
  scan.summary.validationFailureCategoryCounts.slice(0, 10).forEach((item, index) => {
    console.log(`${index + 1}. ${item.label} | count=${item.count}`);
  });
  if (scan.summary.validationFailureCategoryCounts.length === 0) console.log('none');
  console.log('');

  console.log('TOP CANDIDATES BY EXPECTED NET');
  scan.summary.topExpectedNetCandidates.slice(0, 10).forEach((candidate, index) => {
    console.log(
      `${index + 1}. ${candidate.candidateId} | expected_net=${candidate.expectedNetProfitUsd ?? 'n/a'} | worst=${candidate.worstCaseNetProfitUsd ?? 'n/a'} | failure=${candidate.primaryValidationFailureReason || 'none'}`
    );
  });
  if (scan.summary.topExpectedNetCandidates.length === 0) console.log('none');
  console.log('');

  console.log('TOP CANDIDATES BY WORST-CASE NET');
  scan.summary.topWorstCaseNetCandidates.slice(0, 10).forEach((candidate, index) => {
    console.log(
      `${index + 1}. ${candidate.candidateId} | worst=${candidate.worstCaseNetProfitUsd ?? 'n/a'} | expected_net=${candidate.expectedNetProfitUsd ?? 'n/a'} | failure=${candidate.primaryValidationFailureReason || 'none'}`
    );
  });
  if (scan.summary.topWorstCaseNetCandidates.length === 0) console.log('none');
  console.log('');

  console.log('PROMISING UNIVERSES');
  if (scan.summary.promisingUniverses.length === 0) {
    console.log('none');
  } else {
    scan.summary.promisingUniverses.slice(0, 10).forEach((universe, index) => {
      console.log(
        `${index + 1}. ${universe.universeId} | avg_net=${universe.avgNetProfitUsd ?? 'n/a'} | avg_worst=${universe.avgWorstCaseNetProfitUsd ?? 'n/a'} | positive_net_count=${universe.positiveNetProfitCount} | non_negative_worst_case_count=${universe.nonNegativeWorstCaseCount} | cause=${universe.dominantCauseAggregate}`
      );
    });
  }
  console.log('');

  console.log('LESS BAD UNIVERSES');
  if (scan.summary.lessBadUniverses.length === 0) {
    console.log('none');
  } else {
    scan.summary.lessBadUniverses.slice(0, 10).forEach((universe, index) => {
      console.log(
        `${index + 1}. ${universe.universeId} | avg_net=${universe.avgNetProfitUsd ?? 'n/a'} | avg_worst=${universe.avgWorstCaseNetProfitUsd ?? 'n/a'} | positive_net_count=${universe.positiveNetProfitCount} | non_negative_worst_case_count=${universe.nonNegativeWorstCaseCount} | validation_pass_count=${universe.validationPassCount} | cause=${universe.dominantCauseAggregate}`
      );
    });
  }
  console.log('');

  console.log('REJECTED UNIVERSES');
  scan.summary.rejectedUniverses.slice(0, 10).forEach((universe, index) => {
    console.log(
      `${index + 1}. ${universe.universeId} | avg_net=${universe.avgNetProfitUsd ?? 'n/a'} | avg_worst=${universe.avgWorstCaseNetProfitUsd ?? 'n/a'} | cause=${universe.dominantCauseAggregate}`
    );
  });
  if (scan.summary.rejectedUniverses.length === 0) console.log('none');
  console.log('');

  console.log('FINAL CONCLUSION');
  console.log(`promising_universe_exists: ${scan.summary.promisingUniverseExists ? 'yes' : 'no'}`);
  console.log(`dominant_cause_aggregate: ${scan.summary.dominantCauseAggregate}`);
  console.log(`economic_failure_count: ${scan.summary.economicFailureCount}`);
  console.log(`runtime_coverage_failure_count: ${scan.summary.runtimeCoverageFailureCount}`);
  console.log(`routing_failure_count: ${scan.summary.routingFailureCount}`);
  console.log(`liquidity_failure_count: ${scan.summary.liquidityFailureCount}`);
  console.log(`safety_failure_count: ${scan.summary.safetyFailureCount}`);
  console.log(`unknown_failure_count: ${scan.summary.unknownFailureCount}`);
  console.log(
    `best_universe: ${scan.summary.universes[0]?.universeId || 'none'}`
  );
  console.log(
    `first_positive_gross_edge_candidate: ${scan.summary.firstPositiveGrossEdgeCandidate?.candidateId || 'none'}`
  );
  console.log(
    `first_positive_net_profit_candidate: ${scan.summary.firstPositiveNetProfitCandidate?.candidateId || 'none'}`
  );
  console.log(
    `first_non_negative_worst_case_candidate: ${scan.summary.firstNonNegativeWorstCaseCandidate?.candidateId || 'none'}`
  );
  console.log(
    `next_step: ${
      scan.summary.promisingUniverseExists
        ? 'validate the best universe with deeper paper-only route sampling'
        : 'expand token universe / explicit venue selectors / new route sources'
    }`
  );
  console.log('');
  console.log(`scan_json: ${OUTPUT_JSON}`);
  console.log(`scan_json_v2: ${OUTPUT_JSON_V2}`);
}

async function main() {
  loadRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const resolvedPrices = await resolveCorePrices({
    inputToken: process.env.DOG_MM_INPUT_TOKEN || '',
    outputToken: process.env.DOG_MM_OUTPUT_TOKEN || '',
    inputTokenUsd: process.env.DOG_MM_INPUT_TOKEN_USD || null,
    outputTokenUsd: process.env.DOG_MM_OUTPUT_TOKEN_USD || null,
    stxUsd: process.env.DOG_MM_STX_USD || null,
    cacheFile: path.resolve(STATE_DIR, 'core-prices-cache.json'),
    timeoutMs: 4000,
    userAgent: 'local-ai-agent/dog-mm-universe-scan',
  });

  const grid = buildCandidates(args, resolvedPrices);
  const results = [];
  const errors = [];

  for (const candidate of grid.candidates) {
    const run = runCandidate(candidate);
    if (!run.ok) {
      errors.push({
        candidateId: candidate.candidateId,
        universeId: `${candidate.pairId}|${candidate.direction}|${candidate.routeMode}`,
        pairId: candidate.pairId,
        inputToken: candidate.inputToken,
        outputToken: candidate.outputToken,
        direction: candidate.direction,
        routeMode: candidate.routeMode,
        amountIn: candidate.amountIn,
        notionalLevel: candidate.notionalLevel,
        error: run.error,
        stderr: run.stderr || null,
        stdout: run.stdout || null,
      });
      continue;
    }
    results.push(computeMetrics(candidate, run.payload));
  }

  const scan = {
    generatedAt: new Date().toISOString(),
    paperMode: true,
    broadcastAllowed: false,
    wouldBroadcast: false,
    grid: {
      baseAmountIn: grid.baseAmountIn,
      notionals: grid.notionals,
      ammStrategies: grid.ammStrategies,
      preferredAmms: grid.preferredAmms,
      pairs: grid.pairs,
      knownPools: grid.knownPools,
    },
    discoveredSupport: {
      tokens: discoverSupportedTokens(),
      knownPools: grid.knownPools,
      unsupportedUniverseHints: [
        {
          symbol: 'aeUSDC-USDCx',
          reason: 'pool discovered in state, but aeUSDC token contract is not resolved in the runtime today',
        },
      ],
    },
    results,
    errors,
  };
  scan.summary = buildSummary(results, errors);

  writeJson(OUTPUT_JSON, scan);
  writeJson(OUTPUT_JSON_V2, scan);
  printScan(scan);
}

main().catch(error => {
  console.error(`DOG-MM universe scan failed: ${error.message}`);
  process.exit(1);
});
