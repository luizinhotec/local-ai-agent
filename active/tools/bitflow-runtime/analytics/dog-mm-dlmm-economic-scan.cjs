#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const EXPANDED_SCAN_JSON = path.resolve(STATE_DIR, 'dog-mm-universe-scan-expanded.json');
const EXPANDED_SCAN_DIR = path.resolve(STATE_DIR, 'universe-scan-expanded');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-dlmm-economic-analysis.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function toFiniteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values, digits = 6) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length === 0) return null;
  return round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length, digits);
}

function sum(values, digits = 6) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length === 0) return null;
  return round(filtered.reduce((total, value) => total + value, 0), digits);
}

function ratio(numerator, denominator, digits = 6) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return round(numerator / denominator, digits);
}

function ratioPercent(numerator, denominator, digits = 6) {
  const value = ratio(numerator, denominator, digits + 4);
  return value === null ? null : round(value * 100, digits);
}

function ratioBps(numerator, denominator, digits = 6) {
  const value = ratio(numerator, denominator, digits + 4);
  return value === null ? null : round(value * 10000, digits);
}

function multiplierFromNotional(label) {
  const parsed = Number(String(label || '').replace(/x$/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function sizeTierFromMultiplier(multiplier) {
  if (!Number.isFinite(multiplier)) return 'unknown';
  if (multiplier <= 1) return 'very_small';
  if (multiplier <= 5) return 'small';
  if (multiplier <= 20) return 'medium';
  return 'large';
}

function deltaAtomic(amountOut, minAmountOut) {
  try {
    return (BigInt(String(amountOut || '0')) - BigInt(String(minAmountOut || '0'))).toString();
  } catch (_error) {
    return null;
  }
}

function buildTokenMaps(scanJson) {
  const bySymbol = new Map();
  const byContract = new Map();
  const discoveryTokens = Array.isArray(scanJson?.discovery?.tokensConsidered) ? scanJson.discovery.tokensConsidered : [];
  for (const token of discoveryTokens) {
    const item = {
      symbol: token.symbol || null,
      contractId: token.contractId || null,
      decimals: toFiniteNumber(token.decimals),
      priceUsd: toFiniteNumber(token.priceUsd),
    };
    if (item.symbol) bySymbol.set(item.symbol, item);
    if (item.contractId) byContract.set(item.contractId, item);
  }
  return { bySymbol, byContract };
}

function loadCandidatePlan(candidateId) {
  const filePath = path.resolve(EXPANDED_SCAN_DIR, `${candidateId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function computePoolFeeUsd(plan, tokenMaps) {
  const hopDetails = Array.isArray(plan?.quote?.executionDetails?.hop_details) ? plan.quote.executionDetails.hop_details : [];
  const executionPath = Array.isArray(plan?.quote?.executionPath) ? plan.quote.executionPath : [];
  let totalUsd = 0;
  let hasAny = false;

  const perHop = hopDetails.map((hop, index) => {
    const executionStep = executionPath[index] || {};
    const feeAtoms = toFiniteNumber(hop?.fee_amount);
    const functionName = String(hop?.function_name || executionStep?.function_name || '').toLowerCase();
    const feeTokenContract = functionName.includes('swap-x-for-y')
      ? executionStep?.x_token_trait
      : functionName.includes('swap-y-for-x')
        ? executionStep?.y_token_trait
        : null;
    const tokenMeta = tokenMaps.byContract.get(feeTokenContract) || null;
    const feeHuman =
      Number.isFinite(feeAtoms) && Number.isFinite(tokenMeta?.decimals)
        ? feeAtoms / 10 ** tokenMeta.decimals
        : null;
    const feeUsd =
      Number.isFinite(feeHuman) && Number.isFinite(tokenMeta?.priceUsd)
        ? feeHuman * tokenMeta.priceUsd
        : null;

    if (Number.isFinite(feeUsd)) {
      totalUsd += feeUsd;
      hasAny = true;
    }

    return {
      hopIndex: index + 1,
      functionName: hop?.function_name || executionStep?.function_name || null,
      feeAmountAtomic: Number.isFinite(feeAtoms) ? String(Math.round(feeAtoms)) : hop?.fee_amount || null,
      feeRate: toFiniteNumber(hop?.fee_rate),
      feeTokenContract: feeTokenContract || null,
      feeTokenSymbol: tokenMeta?.symbol || null,
      feeUsd: round(feeUsd),
      priceImpactBps: toFiniteNumber(hop?.price_impact_bps),
    };
  });

  return {
    totalUsd: hasAny ? round(totalUsd) : null,
    perHop,
  };
}

function computePriceImpactPercent(plan) {
  const executionDetails = plan?.quote?.executionDetails || {};
  const routeLevelBps = toFiniteNumber(executionDetails.price_impact_bps);
  const hopDetails = Array.isArray(executionDetails.hop_details) ? executionDetails.hop_details : [];
  const hopLevelBps = hopDetails
    .map(item => Math.abs(toFiniteNumber(item?.price_impact_bps, 0)))
    .reduce((sumValue, value) => sumValue + value, 0);

  if (Number.isFinite(routeLevelBps) && routeLevelBps !== 0) {
    return { value: round(routeLevelBps / 100), source: 'route_level_bps' };
  }
  if (hopDetails.length > 0) {
    return { value: round(hopLevelBps / 100), source: 'hop_sum_abs_bps' };
  }
  return { value: null, source: 'missing' };
}

function classifyDominantUnsafeCause(slippageCost, poolFeeCost, networkFeeCost) {
  const items = [
    { label: 'SLIPPAGE_DOMINANT', value: slippageCost },
    { label: 'FEE_DOMINANT', value: poolFeeCost },
    { label: 'NETWORK_FEE_DOMINANT', value: networkFeeCost },
  ].filter(item => Number.isFinite(item.value) && item.value > 0);

  if (items.length === 0) return 'MIXED';
  items.sort((left, right) => right.value - left.value);
  if (items.length === 1) return items[0].label;
  const [top, second] = items;
  if (second.value === 0) return top.label;
  if (top.value / second.value <= 1.15) return 'MIXED';
  return top.label;
}

function aggregateBy(items, getKey, getValue) {
  const grouped = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(getValue(item));
  }
  return grouped;
}

function sortByOpportunityQuality(items) {
  return [...items].sort((left, right) => {
    const worstDiff = (right.avg_worst_case_edge ?? -Infinity) - (left.avg_worst_case_edge ?? -Infinity);
    if (worstDiff !== 0) return worstDiff;
    const netDiff = (right.avg_net_edge ?? -Infinity) - (left.avg_net_edge ?? -Infinity);
    if (netDiff !== 0) return netDiff;
    return (left.avg_delta_to_safe_usd ?? Infinity) - (right.avg_delta_to_safe_usd ?? Infinity);
  });
}

function summarizeRouteGroup(items) {
  return {
    count: items.length,
    avg_slippage_cost: average(items.map(item => item.slippage_cost)),
    avg_pool_fee_cost: average(items.map(item => item.pool_fee_cost)),
    avg_network_fee_cost: average(items.map(item => item.network_fee_cost)),
    avg_net_edge: average(items.map(item => item.net_edge)),
    avg_worst_case_edge: average(items.map(item => item.worst_case_edge)),
    avg_min_output_ratio: average(items.map(item => item.min_output_ratio)),
  };
}

function main() {
  if (!fs.existsSync(EXPANDED_SCAN_JSON)) {
    throw new Error(`Missing source scan: ${EXPANDED_SCAN_JSON}`);
  }

  const expandedScan = readJson(EXPANDED_SCAN_JSON);
  const tokenMaps = buildTokenMaps(expandedScan);
  const sourceResults = Array.isArray(expandedScan.results) ? expandedScan.results : [];
  const dlmmResults = sourceResults.filter(item => item.venue === 'bitflow-dlmm');

  const opportunities = [];
  const breakdown = {
    SLIPPAGE_DOMINANT: 0,
    FEE_DOMINANT: 0,
    NETWORK_FEE_DOMINANT: 0,
    MIXED: 0,
  };

  for (const result of dlmmResults) {
    const plan = loadCandidatePlan(result.candidateId);
    if (!plan) continue;

    const executionPath = Array.isArray(plan?.quote?.executionPath) ? plan.quote.executionPath : [];
    const hasExecutableSignal = executionPath.length > 0;
    if (!hasExecutableSignal) {
      opportunities.push({
        candidate_id: result.candidateId,
        pair: result.pairId,
        token: result.baseToken,
        input_token: result.baseToken,
        output_token: result.quoteToken,
        amount_in: result.amountIn,
        validation_status: 'NON_EXECUTABLE_SIGNAL',
        rejection_reason: 'NON_EXECUTABLE_SIGNAL',
      });
      continue;
    }

    const poolFee = computePoolFeeUsd(plan, tokenMaps);
    const priceImpact = computePriceImpactPercent(plan);
    const quote = plan?.quote || {};
    const profit = plan?.profitDiagnostics || {};
    const multiplier = multiplierFromNotional(result.notionalLevel);
    const sizeTier = sizeTierFromMultiplier(multiplier);
    const amountOut = String(quote.amountOut || '');
    const minAmountOut = String(quote.minAmountOut || '');
    const deltaToSafeAtomic = deltaAtomic(amountOut, minAmountOut);
    const slippageCost = toFiniteNumber(result.slippageLossUsd);
    const poolFeeCost = toFiniteNumber(poolFee.totalUsd);
    const networkFeeCost = toFiniteNumber(result.networkFeeUsd);
    const dominantCause =
      result.primaryValidationFailureReason === 'MIN_OUTPUT_UNSAFE'
        ? classifyDominantUnsafeCause(slippageCost, poolFeeCost, networkFeeCost)
        : null;

    if (dominantCause) breakdown[dominantCause] += 1;

    opportunities.push({
      candidate_id: result.candidateId,
      pair: result.pairId,
      token: result.baseToken,
      input_token: result.baseToken,
      output_token: result.quoteToken,
      amount_in: result.amountIn,
      amount_out: amountOut || null,
      min_amount_out: minAmountOut || null,
      amount_in_human: toFiniteNumber(profit.inputAmountHuman),
      amount_out_human: toFiniteNumber(profit.expectedOutputHuman),
      min_amount_out_human: toFiniteNumber(profit.minOutputHuman),
      input_usd: toFiniteNumber(result.inputUsd),
      amount_out_usd: toFiniteNumber(result.expectedOutputUsd),
      min_amount_out_usd: toFiniteNumber(result.minOutputUsd),
      price_impact_percent: priceImpact.value,
      price_impact_percent_source: priceImpact.source,
      pool_fee: poolFee.totalUsd,
      network_fee: networkFeeCost,
      expected_slippage: ratioPercent(
        toFiniteNumber(result.expectedOutputUsd) - toFiniteNumber(result.minOutputUsd),
        toFiniteNumber(result.expectedOutputUsd)
      ),
      execution_path_length: toFiniteNumber(result.executionPathLength),
      route_hops: toFiniteNumber(result.routeHops),
      gross_edge: toFiniteNumber(result.grossEdgeUsd),
      net_edge: toFiniteNumber(result.netProfitUsd),
      worst_case_edge: toFiniteNumber(result.worstCaseNetProfitUsd),
      validation_status: result.validationStatus || result.validation || null,
      rejection_reason: result.primaryValidationFailureReason || null,
      notional_level: result.notionalLevel,
      size_tier: sizeTier,
      min_output_ratio: ratio(
        toFiniteNumber(result.minOutputUsd),
        toFiniteNumber(result.expectedOutputUsd)
      ),
      delta_to_safe: deltaToSafeAtomic,
      delta_to_safe_usd: slippageCost,
      slippage_cost: slippageCost,
      pool_fee_cost: poolFeeCost,
      network_fee_cost: networkFeeCost,
      min_output_unsafe_cause: dominantCause,
      pool_fee_hops: poolFee.perHop,
      validation_failures: result.validationFailures || [],
      path_signature: result.pathSignature || null,
      route_mode: result.routeMode || null,
    });
  }

  const executableOpportunities = opportunities.filter(
    item => item.validation_status !== 'NON_EXECUTABLE_SIGNAL'
  );
  const unsafeOpportunities = executableOpportunities.filter(
    item => item.rejection_reason === 'MIN_OUTPUT_UNSAFE'
  );

  const pairGroups = aggregateBy(executableOpportunities, item => item.pair, item => item);
  const pairAnalysis = sortByOpportunityQuality(
    Array.from(pairGroups.entries()).map(([pair, items]) => {
      const sizeGroups = aggregateBy(items, item => item.size_tier, item => item);
      const sizeAnalysis = ['very_small', 'small', 'medium', 'large'].map(tier => {
        const tierItems = sizeGroups.get(tier) || [];
        if (tierItems.length === 0) return null;
        return {
          size_tier: tier,
          count: tierItems.length,
          avg_net_edge: average(tierItems.map(item => item.net_edge)),
          avg_worst_case_edge: average(tierItems.map(item => item.worst_case_edge)),
          avg_min_output_ratio: average(tierItems.map(item => item.min_output_ratio)),
          avg_delta_to_safe_usd: average(tierItems.map(item => item.delta_to_safe_usd)),
        };
      }).filter(Boolean);

      return {
        pair,
        count: items.length,
        avg_net_edge: average(items.map(item => item.net_edge)),
        avg_worst_case_edge: average(items.map(item => item.worst_case_edge)),
        avg_slippage_cost: average(items.map(item => item.slippage_cost)),
        avg_pool_fee_cost: average(items.map(item => item.pool_fee_cost)),
        avg_network_fee_cost: average(items.map(item => item.network_fee_cost)),
        avg_delta_to_safe_usd: average(items.map(item => item.delta_to_safe_usd)),
        avg_min_output_ratio: average(items.map(item => item.min_output_ratio)),
        best_worst_case_edge: Math.max(...items.map(item => item.worst_case_edge ?? -Infinity)),
        has_positive_size_window: items.some(
          item => item.validation_status === 'PASS' && Number.isFinite(item.worst_case_edge) && item.worst_case_edge > 0
        ),
        size_analysis: sizeAnalysis,
      };
    })
  );

  const topPairs = pairAnalysis.slice(0, 5).map(item => ({
    pair: item.pair,
    avg_net_edge: item.avg_net_edge,
    avg_worst_case_edge: item.avg_worst_case_edge,
    avg_slippage_cost: item.avg_slippage_cost,
    avg_delta_to_safe_usd: item.avg_delta_to_safe_usd,
    avg_min_output_ratio: item.avg_min_output_ratio,
    best_worst_case_edge: item.best_worst_case_edge,
  }));

  const routeLength1 = executableOpportunities.filter(item => item.execution_path_length === 1);
  const routeLengthGreater = executableOpportunities.filter(item => item.execution_path_length > 1);
  const routeAnalysis = {
    path_length_1: summarizeRouteGroup(routeLength1),
    path_length_gt_1: summarizeRouteGroup(routeLengthGreater),
    path_length_1_better:
      routeLength1.length > 0 &&
      routeLengthGreater.length > 0 &&
      (average(routeLength1.map(item => item.worst_case_edge)) ?? -Infinity) >
        (average(routeLengthGreater.map(item => item.worst_case_edge)) ?? -Infinity),
  };

  const positiveWindowOpportunity = executableOpportunities
    .filter(item => item.validation_status === 'PASS' && Number.isFinite(item.worst_case_edge) && item.worst_case_edge > 0)
    .sort((left, right) => (right.worst_case_edge ?? -Infinity) - (left.worst_case_edge ?? -Infinity))[0] || null;

  const summary = {
    total_opportunities: executableOpportunities.length,
    negative_edge_count: executableOpportunities.filter(
      item => Number.isFinite(item.net_edge) && item.net_edge <= 0
    ).length,
    min_output_unsafe_count: unsafeOpportunities.length,
    viable_count: executableOpportunities.filter(
      item => item.validation_status === 'PASS' && Number.isFinite(item.worst_case_edge) && item.worst_case_edge > 0
    ).length,
  };

  const sizeAnalysis = {
    has_positive_size_window: Boolean(positiveWindowOpportunity),
    best_size: positiveWindowOpportunity
      ? {
          candidate_id: positiveWindowOpportunity.candidate_id,
          pair: positiveWindowOpportunity.pair,
          notional_level: positiveWindowOpportunity.notional_level,
          size_tier: positiveWindowOpportunity.size_tier,
          worst_case_edge: positiveWindowOpportunity.worst_case_edge,
        }
      : null,
    by_pair: pairAnalysis.map(item => ({
      pair: item.pair,
      has_positive_size_window: item.has_positive_size_window,
      size_analysis: item.size_analysis,
    })),
  };

  const breakdownDominant = Object.entries(breakdown)
    .sort((left, right) => right[1] - left[1])[0]?.[0] || 'MIXED';
  const viable = summary.viable_count > 0;
  const conclusion = viable ? 'DLMM_HAS_EXECUTABLE_EDGE' : 'DLMM_NOT_ECONOMICALLY_VIABLE';

  const output = {
    generated_at: new Date().toISOString(),
    source: {
      expanded_scan_json: EXPANDED_SCAN_JSON,
      expanded_scan_generated_at: expandedScan.generatedAt || null,
      candidate_dir: EXPANDED_SCAN_DIR,
      venue_scope: 'bitflow-dlmm',
      truth_definition: 'execution_path real + quote values reais + validation real',
    },
    summary,
    breakdown,
    size_analysis: sizeAnalysis,
    route_analysis: routeAnalysis,
    top_pairs: topPairs,
    pair_analysis: pairAnalysis,
    opportunities,
    top_candidate_pairs: topPairs.map(item => item.pair),
    dominant_block_cause: breakdownDominant,
    conclusion,
    verdict: viable ? 'VIAVEL' : 'NAO_VIAVEL_ECONOMICAMENTE',
  };

  writeJson(OUTPUT_JSON, output);

  console.log('DOG-MM DLMM ECONOMIC FEASIBILITY');
  console.log(`source_generated_at: ${output.source.expanded_scan_generated_at || 'unknown'}`);
  console.log(`total_opportunities: ${summary.total_opportunities}`);
  console.log(`negative_edge_count: ${summary.negative_edge_count}`);
  console.log(`min_output_unsafe_count: ${summary.min_output_unsafe_count}`);
  console.log(`viable_count: ${summary.viable_count}`);
  console.log(`dominant_block_cause: ${breakdownDominant}`);
  console.log(`has_positive_size_window: ${sizeAnalysis.has_positive_size_window}`);
  console.log(`path_length_1_better: ${routeAnalysis.path_length_1_better}`);
  console.log(`top_pairs: ${topPairs.map(item => item.pair).join(', ') || 'none'}`);
  console.log(`conclusion: ${conclusion}`);
  console.log(`output_json: ${OUTPUT_JSON}`);
}

main();
