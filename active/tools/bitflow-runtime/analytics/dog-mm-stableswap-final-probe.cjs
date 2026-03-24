#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv } = require('../runtime-env.cjs');
const { main: runXykConsistencyCheck } = require('./dog-mm-xyk-consistency-check.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const EXPANDED_SCAN_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-universe-scan-expanded.json');
const CAPABILITY_MATRIX_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-capability-matrix.json');
const STABLESWAP_OUTPUT_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-stableswap-final-probe.json');
const FINAL_VERDICT_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-non-dlmm-final-verdict.json');
const QUOTE_MULTI_URL = 'https://bff.bitflowapis.finance/api/quotes/v1/quote/multi';

const PAIR_DEFS = [
  ['USDCx', 'aeUSDC'],
  ['aeUSDC', 'USDCx'],
  ['USDCx', 'USDA'],
  ['USDA', 'USDCx'],
  ['USDCx', 'USDh'],
  ['USDh', 'USDCx'],
];

const TIER_MULTIPLIERS = [
  { label: 'small', multiplier: 1 },
  { label: 'medium', multiplier: 10 },
  { label: 'large', multiplier: 100 },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function classifyMaterializedVenue(executionPath) {
  const labels = unique(
    (executionPath || []).map(step => {
      const value = String(step?.pool_trait || step?.pool_id || '').toLowerCase();
      if (!value) return null;
      if (value.includes('dlmm')) return 'bitflow-dlmm';
      if (value.includes('xyk')) return 'bitflow-xyk';
      if (value.includes('stable')) return 'bitflow-stableswap';
      return 'bitflow-other';
    })
  );
  if (labels.length === 0) return 'none';
  if (labels.length === 1) return labels[0];
  return labels.join('|');
}

function buildTokenRegistry(expanded) {
  const map = new Map();
  (expanded.discovery.tokensConsidered || []).forEach(token => {
    map.set(token.symbol, token);
  });
  return map;
}

function findBaselineAmount(expanded, pairId) {
  return (
    expanded.results.find(item => item.pairId === pairId && item.notionalLevel === '1x')?.amountIn ||
    expanded.discovery.eligiblePairs?.find(item => item.pairId === pairId)?.levels?.[0]?.amountIn ||
    null
  );
}

function amountForTier(baseAmount, multiplier) {
  const value = Number(baseAmount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return String(Math.max(1, Math.round(value * multiplier)));
}

function inferRejectionLayer(statusCode, routeCount, executionPathLength) {
  if (statusCode !== 200) return 'QUOTE_LAYER';
  if (routeCount === 0) return 'ROUTE_LAYER';
  if (routeCount > 0 && executionPathLength === 0) return 'EXECUTION_LAYER';
  return 'UNKNOWN';
}

function findValidationStatus(matrix, materializedVenue, pairId) {
  if (!materializedVenue || materializedVenue === 'none') return 'NOT_REACHED';
  const row = matrix.entries.find(entry => entry.venue === materializedVenue && entry.pairId === pairId);
  return row?.validationStatus || 'NOT_REACHED';
}

async function fetchProbe({ inputToken, outputToken, amountIn, preferredAmm, routeModeLabel }) {
  const body = {
    input_token: inputToken,
    output_token: outputToken,
    amount_in: amountIn,
    amm_strategy: 'best',
    slippage_tolerance: Number(process.env.DOG_MM_SLIPPAGE_TOLERANCE || 3),
  };
  if (preferredAmm) body.preferred_amm = preferredAmm;

  const response = await fetch(QUOTE_MULTI_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  const routes = Array.isArray(json?.routes) ? json.routes : [];
  const firstRoute = routes[0] || null;
  const executionPath = Array.isArray(firstRoute?.execution_path) ? firstRoute.execution_path : [];
  return {
    routeMode: routeModeLabel,
    preferredAmm: preferredAmm || null,
    statusCode: response.status,
    error: json?.error || null,
    quoteSuccess: Boolean(response.ok && json?.success),
    materializedVenue: classifyMaterializedVenue(executionPath),
    executionPathRaw: executionPath,
    executionPathLength: executionPath.length,
    amountOut: firstRoute?.amount_out ?? null,
    minAmountOut: firstRoute?.min_amount_out ?? null,
    routeCount: routes.length,
  };
}

async function main() {
  loadRuntimeEnv();
  const expanded = readJson(EXPANDED_SCAN_JSON);
  const matrix = readJson(CAPABILITY_MATRIX_JSON);
  const tokenRegistry = buildTokenRegistry(expanded);

  const probes = [];
  for (const [baseSymbol, quoteSymbol] of PAIR_DEFS) {
    const baseToken = tokenRegistry.get(baseSymbol);
    const quoteToken = tokenRegistry.get(quoteSymbol);
    const pairId = `${baseSymbol}->${quoteSymbol}`;
    const baselineAmount = findBaselineAmount(expanded, pairId);

    for (const tier of TIER_MULTIPLIERS) {
      for (const mode of [
        { routeModeLabel: 'best:auto', preferredAmm: null },
        { routeModeLabel: 'best:stableswap', preferredAmm: 'stableswap' },
      ]) {
        if (!baseToken || !quoteToken || !baselineAmount) {
          probes.push({
            pairId,
            baseToken: baseSymbol,
            quoteToken: quoteSymbol,
            direction: `${baseSymbol}->${quoteSymbol}`,
            amountTier: tier.label,
            routeMode: mode.routeModeLabel,
            statusCode: null,
            error: !baseToken || !quoteToken ? 'TOKEN_UNRESOLVED' : 'BASELINE_AMOUNT_UNAVAILABLE',
            quoteSuccess: false,
            materializedVenue: 'none',
            executionPathRaw: [],
            executionPathLength: 0,
            amountOut: null,
            minAmountOut: null,
            validationStatus: 'NOT_REACHED',
            rejectionLayer: 'UNKNOWN',
          });
          continue;
        }

        const amountIn = amountForTier(baselineAmount, tier.multiplier);
        const result = await fetchProbe({
          inputToken: baseToken.contractId,
          outputToken: quoteToken.contractId,
          amountIn,
          preferredAmm: mode.preferredAmm,
          routeModeLabel: mode.routeModeLabel,
        });
        probes.push({
          pairId,
          baseToken: baseSymbol,
          quoteToken: quoteSymbol,
          direction: `${baseSymbol}->${quoteSymbol}`,
          amountTier: tier.label,
          amountIn,
          ...result,
          validationStatus: findValidationStatus(matrix, result.materializedVenue, pairId),
          rejectionLayer: inferRejectionLayer(result.statusCode, result.routeCount, result.executionPathLength),
        });
      }
    }
  }

  const defaultByKey = new Map();
  probes
    .filter(item => item.routeMode === 'best:auto')
    .forEach(item => defaultByKey.set(`${item.pairId}|${item.amountTier}`, item));

  const stableswapProbes = probes.filter(item => item.routeMode === 'best:stableswap');
  const stableswapSummary = {
    total_probes: stableswapProbes.length,
    quote_success_count: stableswapProbes.filter(item => item.quoteSuccess).length,
    materialized_as_stableswap_count: stableswapProbes.filter(item => item.materializedVenue === 'bitflow-stableswap').length,
    materialized_as_dlmm_count: stableswapProbes.filter(item => item.materializedVenue === 'bitflow-dlmm').length,
    rejected_count: stableswapProbes.filter(item => !item.quoteSuccess).length,
    rejection_breakdown: {
      QUOTE_LAYER: stableswapProbes.filter(item => item.rejectionLayer === 'QUOTE_LAYER').length,
      ROUTE_LAYER: stableswapProbes.filter(item => item.rejectionLayer === 'ROUTE_LAYER').length,
      EXECUTION_LAYER: stableswapProbes.filter(item => item.rejectionLayer === 'EXECUTION_LAYER').length,
      UNKNOWN: stableswapProbes.filter(item => item.rejectionLayer === 'UNKNOWN').length,
    },
    any_execution_path_non_dlmm: stableswapProbes.some(
      item => item.executionPathLength > 0 && item.materializedVenue !== 'bitflow-dlmm' && item.materializedVenue !== 'none'
    ),
    any_validation_reached: stableswapProbes.some(
      item => item.materializedVenue === 'bitflow-stableswap' && item.validationStatus !== 'NOT_REACHED'
    ),
    best_min_output_delta_vs_dlmm: 0,
    verdict: 'NOT_VIABLE_UNDER_CURRENT_API',
  };

  const deltaCandidates = stableswapProbes
    .map(item => {
      const baseline = defaultByKey.get(`${item.pairId}|${item.amountTier}`);
      if (!baseline || item.minAmountOut === null || baseline.minAmountOut === null) return null;
      return Number(item.minAmountOut) - Number(baseline.minAmountOut);
    })
    .filter(value => Number.isFinite(value));
  if (deltaCandidates.length > 0) {
    stableswapSummary.best_min_output_delta_vs_dlmm = Math.max(...deltaCandidates);
  }
  if (
    stableswapSummary.materialized_as_stableswap_count > 0 &&
    stableswapSummary.any_execution_path_non_dlmm &&
    stableswapSummary.any_validation_reached &&
    stableswapSummary.best_min_output_delta_vs_dlmm > 0
  ) {
    stableswapSummary.verdict = 'VIABLE_SIGNAL_DETECTED';
  }

  const xykReport = await runXykConsistencyCheck();
  const xykSummary = {
    total_probes: xykReport.totalProbes,
    remapped_to_dlmm_count: xykReport.remappedToDlmmCount,
    remap_rate: xykReport.remapRate,
    verdict: xykReport.remapRate >= 0.999 ? 'FULLY_REMAPPED_TO_DLMM' : xykReport.verdict,
  };

  const global = {
    non_dlmm_viable: stableswapSummary.verdict !== 'NOT_VIABLE_UNDER_CURRENT_API',
    changes_economic_outcome: stableswapSummary.best_min_output_delta_vs_dlmm > 0,
    final_recommendation:
      stableswapSummary.verdict !== 'NOT_VIABLE_UNDER_CURRENT_API'
        ? 'INVESTIGATE_STABLESWAP_PATH_FURTHER'
        : 'LOCK_TO_DLMM_AND_STOP_NON_DLMM_INVESTMENT',
  };

  const stableswapReport = {
    generatedAt: new Date().toISOString(),
    probes,
    stableswap: stableswapSummary,
    xyk: xykSummary,
    global,
  };

  writeJson(STABLESWAP_OUTPUT_JSON, stableswapReport);
  writeJson(FINAL_VERDICT_JSON, {
    stableswap: stableswapSummary,
    xyk: xykSummary,
    global,
  });

  if (require.main === module) {
    console.log('DOG-MM STABLESWAP FINAL PROBE');
    console.log(`stableswap_total_probes: ${stableswapSummary.total_probes}`);
    console.log(`stableswap_quote_success_count: ${stableswapSummary.quote_success_count}`);
    console.log(`stableswap_materialized_as_stableswap_count: ${stableswapSummary.materialized_as_stableswap_count}`);
    console.log(`stableswap_materialized_as_dlmm_count: ${stableswapSummary.materialized_as_dlmm_count}`);
    console.log(`stableswap_verdict: ${stableswapSummary.verdict}`);
    console.log(`xyk_total_probes: ${xykSummary.total_probes}`);
    console.log(`xyk_remapped_to_dlmm_count: ${xykSummary.remapped_to_dlmm_count}`);
    console.log(`xyk_remap_rate: ${xykSummary.remap_rate}`);
    console.log(`xyk_verdict: ${xykSummary.verdict}`);
    console.log(`global_non_dlmm_viable: ${global.non_dlmm_viable}`);
    console.log(`global_changes_economic_outcome: ${global.changes_economic_outcome}`);
    console.log(`global_final_recommendation: ${global.final_recommendation}`);
    console.log(`final_verdict_json: ${FINAL_VERDICT_JSON}`);
  }

  return stableswapReport;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`DOG-MM stableswap final probe failed: ${error.message}`);
    process.exit(1);
  });
} else {
  module.exports = { main };
}
