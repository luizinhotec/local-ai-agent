#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const ECONOMIC_JSON = path.resolve(STATE_DIR, 'dog-mm-dlmm-economic-analysis.json');
const NEAR_BREAKEVEN_JSON = path.resolve(STATE_DIR, 'dog-mm-dlmm-near-breakeven-analysis.json');
const CANDIDATE_DIR = path.resolve(STATE_DIR, 'universe-scan-expanded');
const TOXIC_POOLS_JSON = path.resolve(__dirname, 'dog-mm-dlmm-toxic-pools.json');
const OUTPUT_JSON = path.resolve(__dirname, 'dog-mm-dlmm-economic-analysis-excluding-toxic.json');

const REQUIRED_TOXIC_POOLS = [
  'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-usdh-usdcx-v-1-bps-1',
  'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10',
];

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

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values, digits = 6) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length === 0) return null;
  return round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length, digits);
}

function summarizeSizeWindow(opportunities) {
  const viable = opportunities
    .filter(item => item.validation_status === 'PASS' && Number.isFinite(item.worst_case_edge) && item.worst_case_edge > 0)
    .sort((left, right) => (right.worst_case_edge ?? -Infinity) - (left.worst_case_edge ?? -Infinity))[0] || null;

  return {
    has_positive_size_window: Boolean(viable),
    best_size: viable
      ? {
          candidate_id: viable.candidate_id,
          pair: viable.pair,
          amount_in: viable.amount_in,
          notional_level: viable.notional_level,
          execution_path_length: viable.execution_path_length,
          worst_case_edge: viable.worst_case_edge,
        }
      : null,
  };
}

function loadExecutionPools(candidateId) {
  const filePath = path.resolve(CANDIDATE_DIR, `${candidateId}.json`);
  if (!fs.existsSync(filePath)) return [];
  const plan = readJson(filePath);
  const executionPath = Array.isArray(plan?.quote?.executionPath) ? plan.quote.executionPath : [];
  return executionPath.map(step => step?.pool_trait || step?.pool_id || null).filter(Boolean);
}

function selectToxicPools(nearBreakeven) {
  const poolRows = Array.isArray(nearBreakeven?.pool_analysis?.pools_with_highest_slippage_damage)
    ? nearBreakeven.pool_analysis.pools_with_highest_slippage_damage
    : [];

  const ranked = [...poolRows]
    .sort((left, right) => {
      const gapDiff = (right.avg_break_even_gap ?? -Infinity) - (left.avg_break_even_gap ?? -Infinity);
      if (gapDiff !== 0) return gapDiff;
      return (right.avg_price_impact_percent ?? -Infinity) - (left.avg_price_impact_percent ?? -Infinity);
    })
    .slice(0, 3);

  const union = new Map();
  for (const row of ranked) {
    union.set(row.pool_identifier, row);
  }
  for (const pool of REQUIRED_TOXIC_POOLS) {
    if (!union.has(pool)) {
      const found = poolRows.find(row => row.pool_identifier === pool);
      union.set(pool, found || {
        pool_identifier: pool,
        avg_break_even_gap: null,
        avg_price_impact_percent: null,
        forced_inclusion: true,
      });
    }
  }

  return Array.from(union.values()).map(item => ({
    pool_identifier: item.pool_identifier,
    avg_break_even_gap: item.avg_break_even_gap ?? null,
    avg_price_impact_percent: item.avg_price_impact_percent ?? null,
    forced_inclusion: item.forced_inclusion === true,
  }));
}

function main() {
  if (!fs.existsSync(ECONOMIC_JSON)) throw new Error(`Missing ${ECONOMIC_JSON}`);
  if (!fs.existsSync(NEAR_BREAKEVEN_JSON)) throw new Error(`Missing ${NEAR_BREAKEVEN_JSON}`);

  const economic = readJson(ECONOMIC_JSON);
  const nearBreakeven = readJson(NEAR_BREAKEVEN_JSON);
  const toxicPools = selectToxicPools(nearBreakeven);
  const toxicPoolSet = new Set(toxicPools.map(item => item.pool_identifier));

  writeJson(TOXIC_POOLS_JSON, {
    generated_at: new Date().toISOString(),
    source: NEAR_BREAKEVEN_JSON,
    toxic_pools: toxicPools.map(item => item.pool_identifier),
    toxic_pool_metadata: toxicPools,
  });

  const allOpportunities = Array.isArray(economic.opportunities) ? economic.opportunities : [];
  const filtered = [];
  const excluded = [];

  for (const opportunity of allOpportunities) {
    const executionPools = loadExecutionPools(opportunity.candidate_id);
    const hasUnknownPool = executionPools.length === 0;
    const toxicHits = executionPools.filter(pool => toxicPoolSet.has(pool));

    const enriched = {
      ...opportunity,
      execution_pools: executionPools,
      unknown_pool: hasUnknownPool,
      excluded_by_toxic_pool_filter: toxicHits.length > 0,
      toxic_pool_hits: toxicHits,
    };

    if (toxicHits.length > 0) {
      excluded.push(enriched);
      continue;
    }
    filtered.push(enriched);
  }

  const viableExamples = filtered
    .filter(item => item.validation_status === 'PASS' && Number.isFinite(item.worst_case_edge) && item.worst_case_edge > 0)
    .sort((left, right) => (right.worst_case_edge ?? -Infinity) - (left.worst_case_edge ?? -Infinity))
    .slice(0, 10)
    .map(item => ({
      candidate_id: item.candidate_id,
      pair: item.pair,
      amount_in: item.amount_in,
      notional_level: item.notional_level,
      execution_path_length: item.execution_path_length,
      worst_case_edge: item.worst_case_edge,
      net_edge: item.net_edge,
      execution_pools: item.execution_pools,
    }));

  const breakdown = {
    SLIPPAGE_DOMINANT: filtered.filter(item => item.min_output_unsafe_cause === 'SLIPPAGE_DOMINANT').length,
    FEE_DOMINANT: filtered.filter(item => item.min_output_unsafe_cause === 'FEE_DOMINANT').length,
    NETWORK_FEE_DOMINANT: filtered.filter(item => item.min_output_unsafe_cause === 'NETWORK_FEE_DOMINANT').length,
    MIXED: filtered.filter(item => item.min_output_unsafe_cause === 'MIXED').length,
  };

  const summary = {
    total_opportunities_before_filter: allOpportunities.length,
    total_opportunities_after_filter: filtered.length,
    viable_count: viableExamples.length,
    min_output_unsafe_count: filtered.filter(item => item.rejection_reason === 'MIN_OUTPUT_UNSAFE').length,
    negative_edge_count: filtered.filter(item => Number.isFinite(item.net_edge) && item.net_edge <= 0).length,
    unknown_pool_count: filtered.filter(item => item.unknown_pool).length,
    excluded_by_toxic_pool_count: excluded.length,
  };

  const improvement = {
    viable_delta: summary.viable_count - (economic?.summary?.viable_count ?? 0),
    min_output_unsafe_delta: summary.min_output_unsafe_count - (economic?.summary?.min_output_unsafe_count ?? 0),
    opportunities_removed: summary.total_opportunities_before_filter - summary.total_opportunities_after_filter,
  };

  const sizeAnalysis = summarizeSizeWindow(filtered);
  const firstViableCase = viableExamples[0] || null;

  let conclusion = 'DLMM_STILL_NOT_VIABLE_AFTER_POOL_EXCLUSION';
  if (summary.viable_count > 0 && summary.viable_count <= 3) {
    conclusion = 'DLMM_VIABLE_ONLY_IN_NARROW_SUBSET';
  } else if (summary.viable_count > 3) {
    conclusion = 'DLMM_VIABLE_WITH_POOL_FILTERING';
  }

  const output = {
    generated_at: new Date().toISOString(),
    source: {
      economic_analysis_json: ECONOMIC_JSON,
      near_breakeven_json: NEAR_BREAKEVEN_JSON,
      toxic_pools_json: TOXIC_POOLS_JSON,
      truth_definition: 'quotes reais + execution_path real + exclusao real baseada em pools',
    },
    toxic_pools: toxicPools,
    summary,
    improvement,
    breakdown,
    size_analysis: sizeAnalysis,
    first_viable_case: firstViableCase,
    viable_examples: viableExamples,
    remaining_opportunities: filtered,
    excluded_opportunities: excluded.map(item => ({
      candidate_id: item.candidate_id,
      pair: item.pair,
      toxic_pool_hits: item.toxic_pool_hits,
    })),
    conclusion,
    verdict: summary.viable_count > 0 ? 'SUBUNIVERSO_VIAVEL' : 'NAO_VIAVEL_ECONOMICAMENTE',
  };

  writeJson(OUTPUT_JSON, output);

  console.log('DOG-MM DLMM ECONOMIC FEASIBILITY EXCLUDING TOXIC POOLS');
  console.log(`toxic_pools: ${toxicPools.map(item => item.pool_identifier).join(', ')}`);
  console.log(`total_opportunities_before_filter: ${summary.total_opportunities_before_filter}`);
  console.log(`total_opportunities_after_filter: ${summary.total_opportunities_after_filter}`);
  console.log(`excluded_by_toxic_pool_count: ${summary.excluded_by_toxic_pool_count}`);
  console.log(`viable_count: ${summary.viable_count}`);
  console.log(`min_output_unsafe_count: ${summary.min_output_unsafe_count}`);
  console.log(`has_positive_size_window: ${sizeAnalysis.has_positive_size_window}`);
  console.log(`conclusion: ${conclusion}`);
  console.log(`toxic_pools_json: ${TOXIC_POOLS_JSON}`);
  console.log(`output_json: ${OUTPUT_JSON}`);
}

main();
