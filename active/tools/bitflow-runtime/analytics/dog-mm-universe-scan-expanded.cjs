#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv, buildChildEnv } = require('../runtime-env.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SAFE_WRAPPER = path.resolve(__dirname, '..', 'dog-mm-safe-wrapper.cjs');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const SCAN_DIR = path.resolve(STATE_DIR, 'universe-scan-expanded');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-universe-scan-expanded.json');
const PREVIOUS_JSON = path.resolve(STATE_DIR, 'dog-mm-universe-scan-v2.json');
const PHASE1_POOL_STATUS_FILE = path.resolve(ROOT, 'active', 'state', 'dog-mm-phase1-pool-status.json');
const OPS_BUNDLE_FILE = path.resolve(STATE_DIR, 'dog-mm-ops-bundle.json');
const HODLMM_STATUS_FILE = path.resolve(ROOT, 'active', 'state', 'dog-mm-hodlmm-status.json');
const LAST_SWAP_PLAN_FILE = path.resolve(STATE_DIR, 'bitflow-last-swap-plan.json');

const QUOTE_MULTI_URL = 'https://bff.bitflowapis.finance/api/quotes/v1/quote/multi';
const BFF_TOKENS_URL = 'https://bff.bitflowapis.finance/api/quotes/v1/tokens';
const BFF_POOLS_URL = 'https://bff.bitflowapis.finance/api/quotes/v1/pools';
const APP_POOLS_URL = 'https://app.bitflow.finance/api/sdk/get-pools-and-earn?timestamp=1';
const APP_TOKEN_DATA_URL = 'https://app.bitflow.finance/api/sdk/get-token-data';

const TOKEN_RESOLUTION_STATUS = {
  RESOLVED: 'RESOLVED',
  HINTED_BUT_UNRESOLVED: 'HINTED_BUT_UNRESOLVED',
  UNSUPPORTED: 'UNSUPPORTED',
  EXCLUDED_BY_POLICY: 'EXCLUDED_BY_POLICY',
  UNKNOWN_TOKEN_STATE: 'UNKNOWN_TOKEN_STATE',
};

const UNIVERSE_EXCLUSION_REASON = {
  TOKEN_UNRESOLVED: 'TOKEN_UNRESOLVED',
  PAIR_UNSUPPORTED: 'PAIR_UNSUPPORTED',
  DIRECTION_UNSUPPORTED: 'DIRECTION_UNSUPPORTED',
  ROUTE_UNAVAILABLE: 'ROUTE_UNAVAILABLE',
  POOL_UNAVAILABLE: 'POOL_UNAVAILABLE',
  VENUE_UNAVAILABLE: 'VENUE_UNAVAILABLE',
  QUOTE_SOURCE_MISSING: 'QUOTE_SOURCE_MISSING',
  EXECUTION_PATH_UNRESOLVED: 'EXECUTION_PATH_UNRESOLVED',
  DUPLICATE_UNIVERSE_ENTRY: 'DUPLICATE_UNIVERSE_ENTRY',
  UNKNOWN_UNIVERSE_EXCLUSION: 'UNKNOWN_UNIVERSE_EXCLUSION',
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

const SYMBOL_TO_APP_TOKEN_ID = {
  STX: 'token-stx',
  sBTC: 'token-sbtc',
  USDCx: 'token-usdcx',
  aeUSDC: 'token-aeusdc',
  USDh: 'token-usdh',
  DOG: 'token-dog',
  pBTC: 'token-pbtc',
};

const TOKEN_STATUS_PRIORITY = {
  [TOKEN_RESOLUTION_STATUS.UNKNOWN_TOKEN_STATE]: 0,
  [TOKEN_RESOLUTION_STATUS.HINTED_BUT_UNRESOLVED]: 1,
  [TOKEN_RESOLUTION_STATUS.EXCLUDED_BY_POLICY]: 2,
  [TOKEN_RESOLUTION_STATUS.UNSUPPORTED]: 3,
  [TOKEN_RESOLUTION_STATUS.RESOLVED]: 4,
};

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

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function chooseTokenStatus(existingStatus, nextStatus) {
  const existingPriority = TOKEN_STATUS_PRIORITY[existingStatus] ?? -1;
  const nextPriority = TOKEN_STATUS_PRIORITY[nextStatus] ?? -1;
  return nextPriority > existingPriority ? nextStatus : existingStatus;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${error.message}`);
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} from ${url}`);
    error.status = response.status;
    error.payload = json;
    throw error;
  }
  return json;
}

function classifyAppPoolVenue(pool) {
  const wrapper = String(pool?.wrapper || '').toLowerCase();
  const contract = String(pool?.contract || '').toLowerCase();
  const poolContract = String(pool?.poolContract || '').toLowerCase();
  if (wrapper.includes('dlmm') || poolContract.includes('dlmm')) return 'bitflow-dlmm';
  if (pool?.isXYK === true || wrapper.includes('xyk') || poolContract.includes('xyk')) return 'bitflow-xyk';
  if (
    pool?.isStableSwapCore === true ||
    wrapper.includes('stable') ||
    contract.includes('stableswap') ||
    poolContract.includes('stableswap')
  ) {
    return 'bitflow-stableswap';
  }
  return 'bitflow-other';
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

function buildValidationFailureReport(candidate, payload, metrics, registryById) {
  const plan = payload.plan || payload || {};
  const validation = payload.validation || {};
  const policy = payload.policy || {};
  const failures = [];
  const routePath = Array.isArray(plan?.quote?.routePath) ? plan.quote.routePath : [];
  const executionPath = Array.isArray(plan?.quote?.executionPath) ? plan.quote.executionPath : [];
  const postConditions = Array.isArray(plan?.swap?.postConditions) ? plan.swap.postConditions : [];
  const validationErrors = Array.isArray(validation?.errors) ? validation.errors : [];

  [candidate.inputToken, candidate.outputToken].forEach(tokenId => {
    if (tokenId && !registryById.has(tokenId)) {
      upsertFailure(failures, 'MISSING_TOKEN_CONTRACT', 'RUNTIME_COVERAGE', { token: tokenId });
    }
  });

  if (!plan.quote) {
    upsertFailure(failures, 'MISSING_QUOTE', 'ROUTING', { pairId: candidate.pairId });
  }

  if (routePath.length === 0) {
    upsertFailure(failures, 'MISSING_ROUTE', 'ROUTING', { pairId: candidate.pairId });
  } else if (routePath.length < 2 || !routePath.includes(candidate.inputToken) || !routePath.includes(candidate.outputToken)) {
    upsertFailure(failures, 'ROUTE_INCOMPLETE', 'ROUTING', { routePath });
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
    upsertFailure(failures, 'UNKNOWN_VALIDATION_BLOCK', 'UNKNOWN', { validationErrors });
  }

  const sorted = sortFailures(failures);
  return {
    validationStatus: validation?.ok === true && sorted.length === 0 ? 'PASS' : 'BLOCKED',
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

function computeMetrics(candidate, payload, registryById) {
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
  const validation = payload?.validation?.ok === true ? 'PASS' : 'BLOCKED';

  const result = {
    candidateId: candidate.candidateId,
    universeId: `${candidate.pairId}|${candidate.direction}|${candidate.routeMode}|${venue}|${pathSignature}`,
    pairId: candidate.pairId,
    baseToken: candidate.baseToken,
    quoteToken: candidate.quoteToken,
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
    tokenResolutionStatus: candidate.tokenResolutionStatus,
    pairResolutionStatus: 'ELIGIBLE',
    routeResolutionStatus: 'RESOLVED',
    universeInclusionReason: candidate.universeInclusionReason,
    universeExclusionReason: null,
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
    validation,
    validationStatus: validation,
    decision: String(plan.decision || '').toUpperCase() || 'UNKNOWN',
    decisionReason: plan.decisionReason || null,
    pathSignatureRoute: routePathSignature,
    expectedNetProfitUsd: netProfitUsd,
    isEconomicallyPositiveExpected: Number.isFinite(netProfitUsd) ? netProfitUsd > 0 : false,
    isEconomicallyPositiveWorstCase: Number.isFinite(worstCaseNetProfitUsd) ? worstCaseNetProfitUsd >= 0 : false,
  };
  const validationReport = buildValidationFailureReport(candidate, payload, result, registryById);
  result.validationStatus = validationReport.validationStatus;
  result.validationFailureReason = validationReport.validationFailureReason;
  result.validationFailureCategory = validationReport.validationFailureCategory;
  result.primaryValidationFailureReason = validationReport.primaryValidationFailureReason;
  result.primaryValidationFailureCategory = validationReport.primaryValidationFailureCategory;
  result.secondaryValidationFailureReasons = validationReport.secondaryValidationFailureReasons;
  result.validationFailures = validationReport.failures;
  result.dominantCause = result.primaryValidationFailureReason || 'UNKNOWN';
  result.opportunityScore = calculateOpportunityScore(result);
  return result;
}

function buildChildArgs(candidate, stateFile, stxUsd) {
  const childArgs = [
    SAFE_WRAPPER,
    '--json-only',
    '--amount-in',
    candidate.amountIn,
    '--amm-strategy',
    'best',
    '--input-token',
    candidate.inputToken,
    '--output-token',
    candidate.outputToken,
    '--input-token-decimals',
    String(candidate.inputTokenDecimals),
    '--output-token-decimals',
    String(candidate.outputTokenDecimals),
    '--input-token-usd',
    String(candidate.inputTokenUsd),
    '--output-token-usd',
    String(candidate.outputTokenUsd),
    '--state-file',
    stateFile,
  ];
  if (Number.isFinite(stxUsd)) childArgs.push('--stx-usd', String(stxUsd));
  if (process.env.DOG_MM_WALLET_NAME) childArgs.push('--wallet-name', process.env.DOG_MM_WALLET_NAME);
  if (process.env.DOG_MM_WALLET_ID) childArgs.push('--wallet-id', process.env.DOG_MM_WALLET_ID);
  if (process.env.DOG_MM_EXPECTED_ADDRESS) childArgs.push('--expected-address', process.env.DOG_MM_EXPECTED_ADDRESS);
  if (process.env.DOG_MM_SLIPPAGE_TOLERANCE) childArgs.push('--slippage-tolerance', process.env.DOG_MM_SLIPPAGE_TOLERANCE);
  return childArgs;
}

function runCandidate(candidate, stxUsd) {
  const stateFile = path.resolve(SCAN_DIR, `${candidate.candidateId}.json`);
  const childArgs = buildChildArgs(candidate, stateFile, stxUsd);
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

function runCandidateWithRetry(candidate, stxUsd) {
  const first = runCandidate(candidate, stxUsd);
  if (first.ok) return first;
  const second = runCandidate(candidate, stxUsd);
  if (second.ok) {
    second.recoveredAfterRetry = true;
    second.firstAttemptError = first.error;
    return second;
  }
  return {
    ...second,
    firstAttemptError: first.error,
  };
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
    const key = `${result.pairId}|${result.routeMode}|${result.venue}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        universeId: key,
        pairId: result.pairId,
        inputToken: result.inputToken,
        outputToken: result.outputToken,
        direction: result.direction,
        venue: result.venue,
        routeMode: result.routeMode,
        totalCandidates: 0,
        positiveGrossEdgeCount: 0,
        positiveNetProfitCount: 0,
        nonNegativeWorstCaseCount: 0,
        validationPassCount: 0,
        netProfitUsdValues: [],
        worstCaseNetProfitUsdValues: [],
        failureReasonCounts: new Map(),
      });
    }
    const item = grouped.get(key);
    item.totalCandidates += 1;
    if ((result.grossEdgeUsd ?? -Infinity) > 0) item.positiveGrossEdgeCount += 1;
    if ((result.netProfitUsd ?? -Infinity) > 0) item.positiveNetProfitCount += 1;
    if ((result.worstCaseNetProfitUsd ?? -Infinity) >= 0) item.nonNegativeWorstCaseCount += 1;
    if (result.validationStatus === 'PASS') item.validationPassCount += 1;
    if (Number.isFinite(result.netProfitUsd)) item.netProfitUsdValues.push(result.netProfitUsd);
    if (Number.isFinite(result.worstCaseNetProfitUsd)) item.worstCaseNetProfitUsdValues.push(result.worstCaseNetProfitUsd);
    incrementCounter(item.failureReasonCounts, result.primaryValidationFailureReason || 'NONE');
  });

  return Array.from(grouped.values())
    .map(item => ({
      universeId: item.universeId,
      pairId: item.pairId,
      inputToken: item.inputToken,
      outputToken: item.outputToken,
      direction: item.direction,
      venue: item.venue,
      routeMode: item.routeMode,
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
      dominantCauseAggregate: sortedCounts(item.failureReasonCounts)[0]?.label || 'UNKNOWN',
    }))
    .sort((left, right) => {
      if ((right.avgWorstCaseNetProfitUsd ?? -Infinity) !== (left.avgWorstCaseNetProfitUsd ?? -Infinity)) {
        return (right.avgWorstCaseNetProfitUsd ?? -Infinity) - (left.avgWorstCaseNetProfitUsd ?? -Infinity);
      }
      return (right.avgNetProfitUsd ?? -Infinity) - (left.avgNetProfitUsd ?? -Infinity);
    });
}

function formatCandidate(candidate, rank = null) {
  if (!candidate) return 'none';
  const head = rank ? `${rank}.` : '-';
  return `${head} ${candidate.candidateId} | pair=${candidate.pairId} | direction=${candidate.direction} | venue=${candidate.venue} | route_mode=${candidate.routeMode} | notional=${candidate.notionalLevel} | expected=${candidate.expectedNetProfitUsd ?? 'n/a'} | worst=${candidate.worstCaseNetProfitUsd ?? 'n/a'} | validation=${candidate.validationStatus} | failure=${candidate.primaryValidationFailureReason || 'none'}`;
}

function buildComparison(previous, current) {
  const previousReasonCounts = new Map((previous?.summary?.validationFailureReasonCounts || []).map(item => [item.label, item.count]));
  const currentReasonCounts = new Map((current.failureReasonCounts || []).map(item => [item.label, item.count]));
  const previousCategoryCounts = new Map((previous?.summary?.validationFailureCategoryCounts || []).map(item => [item.label, item.count]));
  const currentCategoryCounts = new Map((current.failureCategoryCounts || []).map(item => [item.label, item.count]));

  const reasonDelta = unique([...previousReasonCounts.keys(), ...currentReasonCounts.keys()]).map(label => ({
    label,
    previous: previousReasonCounts.get(label) || 0,
    expanded: currentReasonCounts.get(label) || 0,
    delta: (currentReasonCounts.get(label) || 0) - (previousReasonCounts.get(label) || 0),
  })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label));

  const categoryDelta = unique([...previousCategoryCounts.keys(), ...currentCategoryCounts.keys()]).map(label => ({
    label,
    previous: previousCategoryCounts.get(label) || 0,
    expanded: currentCategoryCounts.get(label) || 0,
    delta: (currentCategoryCounts.get(label) || 0) - (previousCategoryCounts.get(label) || 0),
  })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label));

  return {
    previousCandidateCount: previous?.summary?.candidateCount ?? null,
    expandedCandidateCount: current.candidateCount,
    previousPromisingUniverseExists: Boolean(previous?.summary?.promisingUniverseExists),
    expandedPromisingUniverseExists: Boolean(current.promisingUniverseExists),
    previousDominantCauseAggregate: previous?.summary?.dominantCauseAggregate || null,
    expandedDominantCauseAggregate: current.dominantCauseAggregate || null,
    failureReasonDelta: reasonDelta,
    failureCategoryDelta: categoryDelta,
  };
}

function determineBaseNotionalUsd(previousScan, tokenRegistryBySymbol) {
  const fromPrevious = previousScan?.results?.find(item => item.notionalLevel === '1x' && Number.isFinite(item.inputUsd));
  if (fromPrevious) return fromPrevious.inputUsd;
  const sbtc = tokenRegistryBySymbol.get('sBTC');
  if (sbtc && Number.isFinite(sbtc.priceUsd)) return round((13479 / 10 ** Number(sbtc.decimals)) * sbtc.priceUsd, 6);
  return 10;
}

function amountForToken(baseNotionalUsd, multiplier, token) {
  const usdPrice = toFiniteNumber(token.priceUsd);
  const decimals = toFiniteNumber(token.decimals);
  if (!Number.isFinite(usdPrice) || usdPrice <= 0 || !Number.isFinite(decimals)) return null;
  const humanAmount = (baseNotionalUsd * multiplier) / usdPrice;
  return String(Math.max(1, Math.round(humanAmount * 10 ** decimals)));
}

function parsePoolSymbols(value) {
  return String(value || '')
    .split(/[-/]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeBffToken(rawToken) {
  return {
    symbol: rawToken.symbol,
    contractId: rawToken.contract_address || rawToken.contractId || rawToken.contract_id || null,
    decimals: rawToken.decimals,
    assetName: rawToken.asset_name || null,
  };
}

function resolveAppTokenContract(appEntry) {
  if (!appEntry) return null;
  if (appEntry.tokenContract && appEntry.tokenContract !== 'null') return appEntry.tokenContract;
  const wrapTokens = appEntry.wrapTokens || {};
  if (wrapTokens.BITFLOW_STABLE_XY_3?.tokenContract) return wrapTokens.BITFLOW_STABLE_XY_3.tokenContract;
  if (wrapTokens.BITFLOW_STABLE_XY_4?.tokenContract) return wrapTokens.BITFLOW_STABLE_XY_4.tokenContract;
  if (wrapTokens.BITFLOW_XYK_XY_2?.tokenContract) return wrapTokens.BITFLOW_XYK_XY_2.tokenContract;
  return null;
}

async function discoverUniverse(previousScan) {
  const bffTokensJson = await fetchJson(BFF_TOKENS_URL);
  const bffPoolsJson = await fetchJson(BFF_POOLS_URL);
  const appPoolsJson = await fetchJson(APP_POOLS_URL);

  const bffTokens = Array.isArray(bffTokensJson?.tokens) ? bffTokensJson.tokens.map(normalizeBffToken) : [];
  const bffPools = Array.isArray(bffPoolsJson?.pools) ? bffPoolsJson.pools : [];
  const appPools = Array.isArray(appPoolsJson?.data) ? appPoolsJson.data : [];

  const hintedSymbols = new Set();
  bffTokens.forEach(token => hintedSymbols.add(token.symbol));
  bffPools.forEach(pool => parsePoolSymbols(pool.pool_symbol || pool.symbol).forEach(symbol => hintedSymbols.add(symbol)));

  const phase1 = readJson(PHASE1_POOL_STATUS_FILE);
  const opsBundle = readJson(OPS_BUNDLE_FILE);
  const hodlmm = readJson(HODLMM_STATUS_FILE);
  const lastSwapPlan = readJson(LAST_SWAP_PLAN_FILE);

  parsePoolSymbols(phase1?.selectedPool).forEach(symbol => hintedSymbols.add(symbol));
  parsePoolSymbols(phase1?.comparison?.fallbackPoolSymbol).forEach(symbol => hintedSymbols.add(symbol));
  Object.keys(phase1?.tokens || {}).forEach(symbol => hintedSymbols.add(symbol));
  Object.keys(opsBundle?.phase1PoolStatus?.tokens || {}).forEach(symbol => hintedSymbols.add(symbol));
  parsePoolSymbols(opsBundle?.phase1PoolStatus?.selectedPool).forEach(symbol => hintedSymbols.add(symbol));
  (hodlmm?.recommendedTrainingPools || []).forEach(pool => {
    parsePoolSymbols(pool.pool_symbol || pool.symbol).forEach(symbol => hintedSymbols.add(symbol));
  });
  (previousScan?.discoveredSupport?.unsupportedUniverseHints || []).forEach(hint => {
    parsePoolSymbols(hint.symbol).forEach(symbol => hintedSymbols.add(symbol));
  });
  (Array.isArray(lastSwapPlan?.quote?.routePath) ? lastSwapPlan.quote.routePath : []).forEach(tokenId => {
    const token = bffTokens.find(item => item.contractId === tokenId);
    if (token?.symbol) hintedSymbols.add(token.symbol);
  });

  const appTokenIds = unique(Array.from(hintedSymbols).map(symbol => SYMBOL_TO_APP_TOKEN_ID[symbol]).filter(Boolean));
  const appTokenDataJson = appTokenIds.length > 0
    ? await fetchJson(`${APP_TOKEN_DATA_URL}?token=${appTokenIds.join(',')}&timestamp=1`)
    : { data: {} };
  const appTokenData = appTokenDataJson?.data || {};

  const tokenRegistryBySymbol = new Map();
  const tokenRegistryById = new Map();

  function registerToken(entry) {
    if (!entry || !entry.symbol) return;
    const existing = tokenRegistryBySymbol.get(entry.symbol) || {};
    const merged = {
      symbol: entry.symbol,
      contractId: entry.contractId || existing.contractId || null,
      decimals: entry.decimals ?? existing.decimals ?? null,
      priceUsd:
        entry.priceUsd ??
        existing.priceUsd ??
        (entry.symbol === 'USDCx' ? 1 : null) ??
        (entry.symbol === 'USDh' ? 1 : null),
      tokenId: entry.tokenId || existing.tokenId || SYMBOL_TO_APP_TOKEN_ID[entry.symbol] || null,
      hintedFrom: unique([...(existing.hintedFrom || []), ...(entry.hintedFrom || [])]),
      sources: unique([...(existing.sources || []), ...(entry.sources || [])]),
      venuesObserved: unique([...(existing.venuesObserved || []), ...(entry.venuesObserved || [])]),
      poolSymbolsObserved: unique([...(existing.poolSymbolsObserved || []), ...(entry.poolSymbolsObserved || [])]),
      tokenResolutionStatus: chooseTokenStatus(
        existing.tokenResolutionStatus || TOKEN_RESOLUTION_STATUS.UNKNOWN_TOKEN_STATE,
        entry.tokenResolutionStatus || TOKEN_RESOLUTION_STATUS.UNKNOWN_TOKEN_STATE
      ),
      notes: unique([...(existing.notes || []), ...(entry.notes || [])]),
    };
    tokenRegistryBySymbol.set(merged.symbol, merged);
    if (merged.contractId) tokenRegistryById.set(merged.contractId, merged);
  }

  bffTokens.forEach(token => {
    registerToken({
      symbol: token.symbol,
      contractId: token.contractId,
      decimals: token.decimals,
      hintedFrom: ['bff-tokens'],
      sources: ['bff-tokens'],
      tokenResolutionStatus: TOKEN_RESOLUTION_STATUS.RESOLVED,
    });
  });

  Array.from(hintedSymbols).forEach(symbol => {
    const appEntry = appTokenData[SYMBOL_TO_APP_TOKEN_ID[symbol]] || null;
    const appContract = resolveAppTokenContract(appEntry);
    registerToken({
      symbol,
      contractId: appContract,
      decimals: appEntry?.tokenDecimals ?? null,
      priceUsd: appEntry?.priceData?.last_price ?? null,
      tokenId: SYMBOL_TO_APP_TOKEN_ID[symbol] || null,
      hintedFrom: ['project-state'],
      sources: appEntry ? ['app-token-data'] : [],
      tokenResolutionStatus: appContract
        ? TOKEN_RESOLUTION_STATUS.RESOLVED
        : TOKEN_RESOLUTION_STATUS.HINTED_BUT_UNRESOLVED,
      notes: !appEntry && symbol === 'pBTC' ? ['hinted in legacy state but not resolvable from current token-data endpoint'] : [],
    });
  });

  bffPools.forEach(pool => {
    parsePoolSymbols(pool.pool_symbol || pool.symbol).forEach(symbol => {
      registerToken({
        symbol,
        hintedFrom: ['bff-pools'],
        sources: ['bff-pools'],
        venuesObserved: ['bitflow-dlmm'],
        poolSymbolsObserved: [pool.pool_symbol || pool.symbol],
      });
    });
  });

  const relevantAppPools = appPools.filter(pool => {
    const symbols = parsePoolSymbols(pool.symbol || pool.name);
    return symbols.some(symbol => tokenRegistryBySymbol.has(symbol));
  });

  relevantAppPools.forEach(pool => {
    const venue = classifyAppPoolVenue(pool);
    parsePoolSymbols(pool.symbol || pool.name)
      .filter(symbol => tokenRegistryBySymbol.has(symbol))
      .forEach(symbol => {
        registerToken({
          symbol,
          hintedFrom: ['app-pools'],
          sources: ['app-pools'],
          venuesObserved: [venue],
          poolSymbolsObserved: [pool.symbol || pool.name],
        });
      });
  });

  return {
    previousScan,
    bffTokens,
    bffPools,
    appPools: relevantAppPools,
    tokenRegistryBySymbol,
    tokenRegistryById,
    discoveredTokens: Array.from(tokenRegistryBySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}

async function probePair(pair, amountIn) {
  try {
    const json = await fetchJson(QUOTE_MULTI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input_token: pair.inputToken,
        output_token: pair.outputToken,
        amount_in: amountIn,
        amm_strategy: 'best',
        slippage_tolerance: Number(process.env.DOG_MM_SLIPPAGE_TOLERANCE || 3),
      }),
    });
    const routes = Array.isArray(json?.routes) ? json.routes : [];
    if (routes.length === 0) {
      return { eligible: false, exclusionReason: UNIVERSE_EXCLUSION_REASON.ROUTE_UNAVAILABLE, exclusionDetail: 'quote succeeded but returned zero routes', statusCode: 200 };
    }
    const firstRoute = routes[0];
    const executionPath = Array.isArray(firstRoute?.execution_path) ? firstRoute.execution_path : [];
    if (executionPath.length === 0) {
      return {
        eligible: false,
        exclusionReason: UNIVERSE_EXCLUSION_REASON.EXECUTION_PATH_UNRESOLVED,
        exclusionDetail: 'route returned without execution path',
        statusCode: 200,
        routeCount: routes.length,
        routePath: firstRoute?.route_path || [],
      };
    }
    const poolTraits = unique(executionPath.map(step => step?.pool_trait || step?.pool_id).filter(Boolean));
    return {
      eligible: true,
      exclusionReason: null,
      routeCount: routes.length,
      routePath: firstRoute?.route_path || [],
      executionPathLength: executionPath.length,
      pathSignature: executionPath
        .map(step => `${step?.pool_trait || step?.pool_id || 'unknown'}:${step?.function_name || 'unknown'}:${step?.expected_bin_id ?? 'na'}`)
        .join(' -> '),
      venue: poolTraits.every(pool => String(pool).toLowerCase().includes('dlmm')) ? 'bitflow-dlmm' : 'bitflow-other',
      poolTraits,
      rawRouteSample: {
        total_hops: firstRoute?.total_hops ?? null,
        route_path: firstRoute?.route_path || [],
        execution_path: executionPath,
      },
    };
  } catch (error) {
    const payload = error.payload || {};
    const message = payload?.error || error.message;
    const normalized = String(message || '').toLowerCase();
    let exclusionReason = UNIVERSE_EXCLUSION_REASON.UNKNOWN_UNIVERSE_EXCLUSION;
    if (error.status === 400 && normalized.includes('unsupported input token')) {
      exclusionReason = UNIVERSE_EXCLUSION_REASON.DIRECTION_UNSUPPORTED;
    } else if (error.status === 400 && normalized.includes('unsupported output token')) {
      exclusionReason = UNIVERSE_EXCLUSION_REASON.DIRECTION_UNSUPPORTED;
    } else if (error.status === 404) {
      exclusionReason = UNIVERSE_EXCLUSION_REASON.QUOTE_SOURCE_MISSING;
    } else if (normalized.includes('no route') || normalized.includes('no routes')) {
      exclusionReason = UNIVERSE_EXCLUSION_REASON.ROUTE_UNAVAILABLE;
    }
    return {
      eligible: false,
      exclusionReason,
      exclusionDetail: message,
      statusCode: error.status || null,
      errorPayload: payload,
    };
  }
}

function buildLevels(args) {
  return parseList(
    args.levels || process.env.DOG_MM_UNIVERSE_LEVELS || process.env.DOG_MM_SCAN_LEVELS || process.env.DOG_MM_NOTIONAL_STUDY_LEVELS,
    '1,2,5,10,20,50,100'
  ).map(value => {
    const multiplier = toFiniteNumber(value, null);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`Invalid notional multiplier: ${value}`);
    }
    return { label: `${value}x`, multiplier };
  });
}

async function buildPairs(discovery, baseNotionalUsd, levels) {
  const consideredTokens = Array.from(discovery.tokenRegistryBySymbol.values()).filter(token =>
    [
      TOKEN_RESOLUTION_STATUS.RESOLVED,
      TOKEN_RESOLUTION_STATUS.UNSUPPORTED,
      TOKEN_RESOLUTION_STATUS.HINTED_BUT_UNRESOLVED,
      TOKEN_RESOLUTION_STATUS.UNKNOWN_TOKEN_STATE,
    ].includes(token.tokenResolutionStatus)
  );
  const pairUniverse = [];
  const eligiblePairs = [];
  const excludedPairs = [];
  const observedPaths = new Set();
  const observedPools = new Set();
  const observedRuntimeVenues = new Set();

  for (const input of consideredTokens) {
    for (const output of consideredTokens) {
      if (input.symbol === output.symbol) continue;
      const pair = {
        pairId: `${input.symbol}->${output.symbol}`,
        baseToken: input.symbol,
        quoteToken: output.symbol,
        inputToken: input.contractId,
        outputToken: output.contractId,
        direction: `${input.symbol}->${output.symbol}`,
        routeMode: 'best:auto',
        tokenResolutionStatus: {
          input: input.tokenResolutionStatus,
          output: output.tokenResolutionStatus,
        },
        pairResolutionStatus: 'PENDING',
        routeResolutionStatus: 'PENDING',
        universeInclusionReason: null,
        universeExclusionReason: null,
        exclusionDetail: null,
        notionalPreviewUsd: baseNotionalUsd,
      };

      if (!input.contractId || !output.contractId) {
        pair.pairResolutionStatus = 'EXCLUDED';
        pair.routeResolutionStatus = 'UNRESOLVED';
        pair.universeExclusionReason = UNIVERSE_EXCLUSION_REASON.TOKEN_UNRESOLVED;
        pair.exclusionDetail = !input.contractId ? `${input.symbol} missing contract` : `${output.symbol} missing contract`;
        excludedPairs.push(pair);
        pairUniverse.push(pair);
        continue;
      }

      const amountIn = amountForToken(baseNotionalUsd, 1, input);
      if (!amountIn) {
        pair.pairResolutionStatus = 'EXCLUDED';
        pair.routeResolutionStatus = 'UNRESOLVED';
        pair.universeExclusionReason = UNIVERSE_EXCLUSION_REASON.TOKEN_UNRESOLVED;
        pair.exclusionDetail = `missing decimals/usd price for ${input.symbol}`;
        excludedPairs.push(pair);
        pairUniverse.push(pair);
        continue;
      }

      const probe = await probePair(pair, amountIn);
      pair.probe = probe;

      if (!probe.eligible) {
        pair.pairResolutionStatus = 'EXCLUDED';
        pair.routeResolutionStatus = 'UNRESOLVED';
        pair.universeExclusionReason = probe.exclusionReason;
        pair.exclusionDetail = probe.exclusionDetail;
        excludedPairs.push(pair);
        pairUniverse.push(pair);
        continue;
      }

      pair.pairResolutionStatus = 'ELIGIBLE';
      pair.routeResolutionStatus = 'RESOLVED';
      pair.universeInclusionReason = 'QUOTE_PROBE_RESOLVED';
      pair.venue = probe.venue;
      pair.pathSignature = probe.pathSignature;
      pair.poolTraits = probe.poolTraits;
      eligiblePairs.push({
        ...pair,
        inputTokenDecimals: input.decimals,
        outputTokenDecimals: output.decimals,
        inputTokenUsd: input.priceUsd,
        outputTokenUsd: output.priceUsd,
        levels: levels
          .map(level => ({
            label: level.label,
            multiplier: level.multiplier,
            amountIn: amountForToken(baseNotionalUsd, level.multiplier, input),
          }))
          .filter(level => level.amountIn),
      });
      pairUniverse.push(pair);
      observedPaths.add(probe.pathSignature);
      probe.poolTraits.forEach(pool => observedPools.add(pool));
      if (probe.venue) observedRuntimeVenues.add(probe.venue);
    }
  }

  const supportedSymbols = new Set();
  eligiblePairs.forEach(pair => {
    supportedSymbols.add(pair.baseToken);
    supportedSymbols.add(pair.quoteToken);
  });
  discovery.tokenRegistryBySymbol.forEach(token => {
    if (supportedSymbols.has(token.symbol)) {
      token.tokenResolutionStatus = TOKEN_RESOLUTION_STATUS.RESOLVED;
    } else if (token.contractId && !discovery.bffTokens.some(item => item.symbol === token.symbol)) {
      token.tokenResolutionStatus = TOKEN_RESOLUTION_STATUS.UNSUPPORTED;
    } else if (!token.contractId && token.tokenResolutionStatus !== TOKEN_RESOLUTION_STATUS.HINTED_BUT_UNRESOLVED) {
      token.tokenResolutionStatus = TOKEN_RESOLUTION_STATUS.UNKNOWN_TOKEN_STATE;
    }
    if (token.contractId) discovery.tokenRegistryById.set(token.contractId, token);
  });

  return {
    pairUniverse,
    eligiblePairs,
    excludedPairs,
    observedPaths: Array.from(observedPaths).sort(),
    observedRuntimeVenues: Array.from(observedRuntimeVenues).sort(),
    observedPools: Array.from(observedPools).sort(),
  };
}

function buildSummary(results, errors, pairData, discovery, previousScan) {
  const registryValues = Array.from(discovery.tokenRegistryBySymbol.values());
  const ranked = [...results].sort((left, right) => (right.opportunityScore ?? -Infinity) - (left.opportunityScore ?? -Infinity));
  const failureReasonCounts = new Map();
  const failureCategoryCounts = new Map();
  const candidateCountByPair = new Map();
  const candidateCountByVenue = new Map();
  const candidateCountByRouteMode = new Map();
  const excludedCountByReason = new Map();

  results.forEach(result => {
    incrementCounter(failureReasonCounts, result.primaryValidationFailureReason || 'NONE');
    incrementCounter(failureCategoryCounts, result.primaryValidationFailureCategory || 'NONE');
    incrementCounter(candidateCountByPair, result.pairId);
    incrementCounter(candidateCountByVenue, result.venue);
    incrementCounter(candidateCountByRouteMode, result.routeMode);
  });
  pairData.excludedPairs.forEach(pair => incrementCounter(excludedCountByReason, pair.universeExclusionReason || 'UNKNOWN_UNIVERSE_EXCLUSION'));

  const universes = aggregateUniverse(results);
  const promisingUniverses = universes.filter(
    universe =>
      universe.validationPassCount > 0 &&
      universe.positiveNetProfitCount > 0 &&
      universe.nonNegativeWorstCaseCount > 0
  );
  const comparisonWithPhase51 = buildComparison(previousScan, {
    candidateCount: results.length + errors.length,
    promisingUniverseExists: promisingUniverses.length > 0,
    dominantCauseAggregate: sortedCounts(failureReasonCounts)[0]?.label || 'UNKNOWN',
    failureReasonCounts: sortedCounts(failureReasonCounts),
    failureCategoryCounts: sortedCounts(failureCategoryCounts),
  });

  return {
    tokensTotalConsidered: registryValues.length,
    tokensResolvedCount: registryValues.filter(token => token.tokenResolutionStatus === TOKEN_RESOLUTION_STATUS.RESOLVED).length,
    tokensHintedButUnresolvedCount: registryValues.filter(token => token.tokenResolutionStatus === TOKEN_RESOLUTION_STATUS.HINTED_BUT_UNRESOLVED).length,
    tokensUnsupportedCount: registryValues.filter(token => token.tokenResolutionStatus === TOKEN_RESOLUTION_STATUS.UNSUPPORTED).length,
    pairsTotalConsidered: pairData.pairUniverse.length,
    pairsEligibleCount: pairData.eligiblePairs.length,
    pairsExcludedCount: pairData.excludedPairs.length,
    venuesObserved: unique([...discovery.bffPools.map(() => 'bitflow-dlmm'), ...discovery.appPools.map(pool => classifyAppPoolVenue(pool))]).sort(),
    venuesObservedCount: unique([...discovery.bffPools.map(() => 'bitflow-dlmm'), ...discovery.appPools.map(pool => classifyAppPoolVenue(pool))]).length,
    poolsObservedCount: unique([
      ...discovery.bffPools.map(pool => pool.pool_token || pool.pool_symbol || pool.pool_id),
      ...discovery.appPools.map(pool => pool.poolContract || pool.symbol || pool.poolId),
    ]).length,
    pathsObservedCount: pairData.observedPaths.length,
    candidateCount: results.length + errors.length,
    successfulCandidateCount: results.length,
    failedCandidateCount: errors.length,
    candidateCountByPair: sortedCounts(candidateCountByPair),
    candidateCountByVenue: sortedCounts(candidateCountByVenue),
    candidateCountByRouteMode: sortedCounts(candidateCountByRouteMode),
    excludedCountByReason: sortedCounts(excludedCountByReason),
    failureReasonCounts: sortedCounts(failureReasonCounts),
    failureCategoryCounts: sortedCounts(failureCategoryCounts),
    promisingUniverseExists: promisingUniverses.length > 0,
    dominantCauseAggregate: sortedCounts(failureReasonCounts)[0]?.label || 'UNKNOWN',
    topCandidatesByExpectedNet: [...results].sort((a, b) => (b.expectedNetProfitUsd ?? -Infinity) - (a.expectedNetProfitUsd ?? -Infinity)).slice(0, 10),
    topCandidatesByWorstCaseNet: [...results].sort((a, b) => (b.worstCaseNetProfitUsd ?? -Infinity) - (a.worstCaseNetProfitUsd ?? -Infinity)).slice(0, 10),
    bestOverallCandidates: ranked.slice(0, 10),
    bestOverall: ranked[0] || null,
    bestByPair: bestByDimension(results, 'pairId'),
    bestByVenue: bestByDimension(results, 'venue'),
    bestByDirection: bestByDimension(results, 'direction'),
    bestByRouteMode: bestByDimension(results, 'routeMode'),
    bestByNotional: bestByDimension(results, 'notionalLevel'),
    universes,
    comparisonWithPhase51,
  };
}

function printScan(scan) {
  console.log('DOG-MM UNIVERSE SCAN EXPANDED');
  console.log(`tokens_total_considered: ${scan.summary.tokensTotalConsidered}`);
  console.log(`tokens_resolved_count: ${scan.summary.tokensResolvedCount}`);
  console.log(`tokens_hinted_but_unresolved_count: ${scan.summary.tokensHintedButUnresolvedCount}`);
  console.log(`tokens_unsupported_count: ${scan.summary.tokensUnsupportedCount}`);
  console.log(`pairs_total_considered: ${scan.summary.pairsTotalConsidered}`);
  console.log(`pairs_eligible_count: ${scan.summary.pairsEligibleCount}`);
  console.log(`pairs_excluded_count: ${scan.summary.pairsExcludedCount}`);
  console.log(`candidate_count: ${scan.summary.candidateCount}`);
  console.log(`successful_candidate_count: ${scan.summary.successfulCandidateCount}`);
  console.log(`failed_candidate_count: ${scan.summary.failedCandidateCount}`);
  console.log('paper_mode_expected: yes');
  console.log('broadcast_allowed_expected: no');
  console.log('');
  console.log('TOP FAILURE REASONS');
  scan.summary.failureReasonCounts.slice(0, 10).forEach((item, index) => console.log(`${index + 1}. ${item.label} | count=${item.count}`));
  if (scan.summary.failureReasonCounts.length === 0) console.log('none');
  console.log('');
  console.log('TOP FAILURE CATEGORIES');
  scan.summary.failureCategoryCounts.slice(0, 10).forEach((item, index) => console.log(`${index + 1}. ${item.label} | count=${item.count}`));
  if (scan.summary.failureCategoryCounts.length === 0) console.log('none');
  console.log('');
  console.log('TOP 10 CANDIDATES BY EXPECTED NET');
  scan.summary.topCandidatesByExpectedNet.forEach((candidate, index) => console.log(formatCandidate(candidate, index + 1)));
  if (scan.summary.topCandidatesByExpectedNet.length === 0) console.log('none');
  console.log('');
  console.log('TOP 10 CANDIDATES BY WORST-CASE NET');
  scan.summary.topCandidatesByWorstCaseNet.forEach((candidate, index) => console.log(formatCandidate(candidate, index + 1)));
  if (scan.summary.topCandidatesByWorstCaseNet.length === 0) console.log('none');
  console.log('');
  console.log('COMPARISON VS PHASE 5.1');
  console.log(`previous_candidate_count: ${scan.summary.comparisonWithPhase51.previousCandidateCount ?? 'n/a'}`);
  console.log(`expanded_candidate_count: ${scan.summary.comparisonWithPhase51.expandedCandidateCount}`);
  console.log(`previous_dominant_cause_aggregate: ${scan.summary.comparisonWithPhase51.previousDominantCauseAggregate || 'n/a'}`);
  console.log(`expanded_dominant_cause_aggregate: ${scan.summary.comparisonWithPhase51.expandedDominantCauseAggregate || 'n/a'}`);
  console.log('');
  console.log('FINAL CONCLUSION');
  console.log(`promising_universe_exists: ${scan.summary.promisingUniverseExists ? 'yes' : 'no'}`);
  console.log(`dominant_cause_aggregate: ${scan.summary.dominantCauseAggregate}`);
  console.log(`best_overall_candidate: ${scan.summary.bestOverall?.candidateId || 'none'}`);
  console.log(`best_overall_pair: ${scan.summary.bestOverall?.pairId || 'none'}`);
  console.log(`scan_json_expanded: ${OUTPUT_JSON}`);
}

async function main() {
  loadRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const previousScan = readJson(PREVIOUS_JSON);
  const discovery = await discoverUniverse(previousScan);
  const levels = buildLevels(args);
  const baseNotionalUsd = determineBaseNotionalUsd(previousScan, discovery.tokenRegistryBySymbol);
  const pairData = await buildPairs(discovery, baseNotionalUsd, levels);
  const stxUsd = toFiniteNumber(
    discovery.tokenRegistryBySymbol.get('STX')?.priceUsd,
    toFiniteNumber(process.env.DOG_MM_STX_USD, null)
  );

  const results = [];
  const errors = [];
  let candidateIndex = 0;

  for (const pair of pairData.eligiblePairs) {
    for (const level of pair.levels) {
      candidateIndex += 1;
      const candidate = {
        candidateId: `candidate-${candidateIndex}`,
        pairId: pair.pairId,
        baseToken: pair.baseToken,
        quoteToken: pair.quoteToken,
        inputToken: pair.inputToken,
        outputToken: pair.outputToken,
        direction: pair.direction,
        amountIn: level.amountIn,
        notionalLevel: level.label,
        routeMode: 'best:auto',
        inputTokenDecimals: pair.inputTokenDecimals,
        outputTokenDecimals: pair.outputTokenDecimals,
        inputTokenUsd: pair.inputTokenUsd,
        outputTokenUsd: pair.outputTokenUsd,
        tokenResolutionStatus: pair.tokenResolutionStatus,
        pairResolutionStatus: 'ELIGIBLE',
        routeResolutionStatus: 'RESOLVED',
        universeInclusionReason: pair.universeInclusionReason,
        universeExclusionReason: null,
      };

      const run = runCandidateWithRetry(candidate, stxUsd);
      if (!run.ok) {
        errors.push({
          candidateId: candidate.candidateId,
          pairId: candidate.pairId,
          direction: candidate.direction,
          notionalLevel: candidate.notionalLevel,
          amountIn: candidate.amountIn,
          error: run.error,
          firstAttemptError: run.firstAttemptError || null,
          stderr: run.stderr || null,
          stdout: run.stdout || null,
        });
        continue;
      }
      results.push(computeMetrics(candidate, run.payload, discovery.tokenRegistryById));
    }
  }

  const scan = {
    generatedAt: new Date().toISOString(),
    paperMode: true,
    broadcastAllowed: false,
    wouldBroadcast: false,
    discovery: {
      baseNotionalUsd,
      notionals: levels,
      tokensConsidered: Array.from(discovery.tokenRegistryBySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol)),
      tokensResolved: Array.from(discovery.tokenRegistryBySymbol.values())
        .filter(token => token.tokenResolutionStatus === TOKEN_RESOLUTION_STATUS.RESOLVED)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
      tokensHintedButUnresolved: Array.from(discovery.tokenRegistryBySymbol.values())
        .filter(token => token.tokenResolutionStatus === TOKEN_RESOLUTION_STATUS.HINTED_BUT_UNRESOLVED)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
      tokensUnsupported: Array.from(discovery.tokenRegistryBySymbol.values())
        .filter(token => token.tokenResolutionStatus === TOKEN_RESOLUTION_STATUS.UNSUPPORTED)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
      tokensDiscarded: Array.from(discovery.tokenRegistryBySymbol.values())
        .filter(token => token.tokenResolutionStatus === TOKEN_RESOLUTION_STATUS.EXCLUDED_BY_POLICY)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
      pairsConsidered: pairData.pairUniverse,
      pairsEligible: pairData.eligiblePairs,
      pairsExcluded: pairData.excludedPairs,
      venuesObserved: unique([
        ...discovery.bffPools.map(() => 'bitflow-dlmm'),
        ...discovery.appPools.map(pool => classifyAppPoolVenue(pool)),
      ]).sort(),
      venuesEligibleInRuntime: pairData.observedRuntimeVenues,
      poolsObserved: {
        bff: discovery.bffPools.map(pool => ({
          poolId: pool.pool_id || pool.poolId || null,
          poolToken: pool.pool_token || null,
          poolSymbol: pool.pool_symbol || pool.symbol || null,
          venue: 'bitflow-dlmm',
        })),
        app: discovery.appPools.map(pool => ({
          poolId: pool.poolId || null,
          poolToken: pool.poolContract || null,
          poolSymbol: pool.symbol || pool.name || null,
          venue: classifyAppPoolVenue(pool),
        })),
      },
      pathsObserved: pairData.observedPaths,
    },
    results,
    errors,
  };

  scan.summary = buildSummary(results, errors, pairData, discovery, previousScan);
  writeJson(OUTPUT_JSON, scan);
  printScan(scan);
}

main().catch(error => {
  console.error(`DOG-MM expanded universe scan failed: ${error.message}`);
  process.exit(1);
});
