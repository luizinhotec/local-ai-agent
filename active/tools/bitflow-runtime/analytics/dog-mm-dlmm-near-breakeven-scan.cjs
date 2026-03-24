#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const ECONOMIC_JSON = path.resolve(STATE_DIR, 'dog-mm-dlmm-economic-analysis.json');
const CANDIDATE_DIR = path.resolve(STATE_DIR, 'universe-scan-expanded');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-dlmm-near-breakeven-analysis.json');

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

function loadCandidate(candidateId) {
  const filePath = path.resolve(CANDIDATE_DIR, `${candidateId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function bucketHopCount(value) {
  if (value === 1) return 'hop_1';
  if (value === 2) return 'hop_2';
  return 'hop_3_plus';
}

function summarizeGroup(items) {
  return {
    count: items.length,
    avg_net_edge: average(items.map(item => item.net_edge)),
    avg_worst_case_edge: average(items.map(item => item.worst_case_edge)),
    avg_break_even_gap: average(items.map(item => item.break_even_gap)),
    avg_min_output_ratio: average(items.map(item => item.min_output_ratio)),
    avg_price_impact_percent: average(items.map(item => item.price_impact_percent)),
  };
}

function sortAscendingByGap(items) {
  return [...items].sort((left, right) => {
    const gapDiff = (left.break_even_gap ?? Infinity) - (right.break_even_gap ?? Infinity);
    if (gapDiff !== 0) return gapDiff;
    return (right.net_edge ?? -Infinity) - (left.net_edge ?? -Infinity);
  });
}

function main() {
  if (!fs.existsSync(ECONOMIC_JSON)) {
    throw new Error(`Missing DLMM economic analysis: ${ECONOMIC_JSON}`);
  }

  const economic = readJson(ECONOMIC_JSON);
  const observed = Array.isArray(economic.opportunities) ? economic.opportunities : [];
  const executable = observed.filter(item => item.validation_status !== 'NON_EXECUTABLE_SIGNAL');

  const enriched = executable.map(item => {
    const candidate = loadCandidate(item.candidate_id);
    const executionPath = Array.isArray(candidate?.quote?.executionPath) ? candidate.quote.executionPath : [];
    const pools = executionPath
      .map(step => step?.pool_trait || step?.pool_id || null)
      .filter(Boolean);

    return {
      ...item,
      break_even_gap: Number.isFinite(item.worst_case_edge) ? round(0 - item.worst_case_edge) : null,
      expected_to_worst_gap:
        Number.isFinite(item.net_edge) && Number.isFinite(item.worst_case_edge)
          ? round(item.net_edge - item.worst_case_edge)
          : null,
      min_output_ratio: Number.isFinite(item.min_output_ratio) ? item.min_output_ratio : null,
      hop_count: item.execution_path_length,
      execution_pools: pools,
      execution_path_venues: pools.map(pool => (String(pool).toLowerCase().includes('dlmm') ? 'bitflow-dlmm' : 'unknown')),
    };
  });

  const top10NearBreakEven = sortAscendingByGap(enriched)
    .slice(0, 10)
    .map(item => ({
      candidate_id: item.candidate_id,
      pair: item.pair,
      input_token: item.input_token,
      output_token: item.output_token,
      notional_level: item.notional_level,
      hop_count: item.hop_count,
      break_even_gap: item.break_even_gap,
      expected_to_worst_gap: item.expected_to_worst_gap,
      net_edge: item.net_edge,
      worst_case_edge: item.worst_case_edge,
      min_output_ratio: item.min_output_ratio,
      price_impact_percent: item.price_impact_percent,
      execution_pools: item.execution_pools,
    }));

  const pairMap = new Map();
  for (const item of enriched) {
    if (!pairMap.has(item.pair)) pairMap.set(item.pair, []);
    pairMap.get(item.pair).push(item);
  }

  const pairRows = [...pairMap.entries()].map(([pair, items]) => ({
    pair,
    count: items.length,
    avg_net_edge: average(items.map(item => item.net_edge)),
    avg_worst_case_edge: average(items.map(item => item.worst_case_edge)),
    avg_break_even_gap: average(items.map(item => item.break_even_gap)),
    avg_min_output_ratio: average(items.map(item => item.min_output_ratio)),
    avg_price_impact_percent: average(items.map(item => item.price_impact_percent)),
    avg_execution_path_length: average(items.map(item => item.hop_count)),
    min_break_even_gap_observed: Math.min(...items.map(item => item.break_even_gap ?? Infinity)),
  }));

  const bestPairs = [...pairRows]
    .sort((left, right) => left.avg_break_even_gap - right.avg_break_even_gap)
    .slice(0, 8);
  const worstPairs = [...pairRows]
    .sort((left, right) => right.avg_break_even_gap - left.avg_break_even_gap)
    .slice(0, 8);

  const hopGroups = {
    hop_1: enriched.filter(item => item.hop_count === 1),
    hop_2: enriched.filter(item => item.hop_count === 2),
    hop_3_plus: enriched.filter(item => item.hop_count >= 3),
  };
  const pathAnalysis = {
    hop_1: summarizeGroup(hopGroups.hop_1),
    hop_2: summarizeGroup(hopGroups.hop_2),
    hop_3_plus: summarizeGroup(hopGroups.hop_3_plus),
  };

  const hop1Gap = pathAnalysis.hop_1.avg_break_even_gap;
  const hop3PlusGap = pathAnalysis.hop_3_plus.avg_break_even_gap;
  const multiHopPenaltyExists =
    Number.isFinite(hop1Gap) &&
    Number.isFinite(hop3PlusGap) &&
    hop3PlusGap > hop1Gap * 1.05;

  const poolMap = new Map();
  for (const item of enriched) {
    for (const pool of item.execution_pools) {
      if (!poolMap.has(pool)) poolMap.set(pool, []);
      poolMap.get(pool).push(item);
    }
  }

  const poolRows = [...poolMap.entries()].map(([pool_identifier, items]) => ({
    pool_identifier,
    count: items.length,
    avg_price_impact_percent: average(items.map(item => item.price_impact_percent)),
    avg_break_even_gap: average(items.map(item => item.break_even_gap)),
    avg_min_output_ratio: average(items.map(item => item.min_output_ratio)),
  }));

  const poolsHighestDamage = [...poolRows]
    .sort((left, right) => right.avg_break_even_gap - left.avg_break_even_gap)
    .slice(0, 8);
  const poolsLowestDamage = [...poolRows]
    .sort((left, right) => left.avg_break_even_gap - right.avg_break_even_gap)
    .slice(0, 8);

  const globalAvgGap = average(enriched.map(item => item.break_even_gap));
  const damagingPools = new Set(
    poolRows
      .filter(item => item.count >= 5 && Number.isFinite(item.avg_break_even_gap) && item.avg_break_even_gap >= globalAvgGap * 1.35)
      .map(item => item.pool_identifier)
  );
  const damagingPairs = new Set(
    pairRows
      .filter(item => item.count >= 5 && Number.isFinite(item.avg_break_even_gap) && item.avg_break_even_gap >= globalAvgGap * 1.35)
      .map(item => item.pair)
  );

  const slippageSourceBreakdown = {
    MULTI_HOP_DOMINANT: 0,
    POOL_SPECIFIC_DOMINANT: 0,
    PAIR_SPECIFIC_DOMINANT: 0,
    DIFFUSE: 0,
  };

  for (const item of enriched) {
    let source = 'DIFFUSE';
    if (
      multiHopPenaltyExists &&
      item.hop_count >= 3 &&
      Number.isFinite(item.break_even_gap) &&
      Number.isFinite(hop1Gap) &&
      item.break_even_gap >= hop1Gap * 1.1
    ) {
      source = 'MULTI_HOP_DOMINANT';
    } else if (item.execution_pools.some(pool => damagingPools.has(pool))) {
      source = 'POOL_SPECIFIC_DOMINANT';
    } else if (damagingPairs.has(item.pair)) {
      source = 'PAIR_SPECIFIC_DOMINANT';
    }
    item.slippage_source = source;
    slippageSourceBreakdown[source] += 1;
  }

  const dominantSource = Object.entries(slippageSourceBreakdown)
    .sort((left, right) => right[1] - left[1])[0]?.[0] || 'DIFFUSE';

  let conclusion = 'DLMM_INVIABILITY_IS_DIFFUSE';
  if (dominantSource === 'POOL_SPECIFIC_DOMINANT') {
    conclusion = 'DLMM_INVIABILITY_IS_CONCENTRATED_IN_SPECIFIC_POOLS';
  } else if (dominantSource === 'PAIR_SPECIFIC_DOMINANT') {
    conclusion = 'DLMM_INVIABILITY_IS_CONCENTRATED_IN_SPECIFIC_PAIRS';
  } else if (dominantSource === 'MULTI_HOP_DOMINANT') {
    conclusion = 'DLMM_INVIABILITY_IS_MAINLY_MULTI_HOP';
  }

  const output = {
    generated_at: new Date().toISOString(),
    source: {
      economic_analysis_json: ECONOMIC_JSON,
      economic_generated_at: economic.generated_at || null,
      truth_definition: 'quotes reais + execution_path real + agrupamento sobre dados observados',
    },
    summary: {
      total_opportunities: enriched.length,
      top_10_near_breakeven: top10NearBreakEven,
      multi_hop_penalty_exists: multiHopPenaltyExists,
      pool_level_analysis: poolRows.length > 0 ? 'AVAILABLE_FROM_RUNTIME_OUTPUT' : 'NOT_AVAILABLE_FROM_RUNTIME_OUTPUT',
    },
    pair_analysis: {
      best_pairs_by_break_even_gap: bestPairs,
      worst_pairs_by_break_even_gap: worstPairs,
    },
    path_analysis: pathAnalysis,
    pool_analysis: {
      status: poolRows.length > 0 ? 'AVAILABLE_FROM_RUNTIME_OUTPUT' : 'NOT_AVAILABLE_FROM_RUNTIME_OUTPUT',
      pools_with_highest_slippage_damage: poolsHighestDamage,
      pools_with_lowest_slippage_damage: poolsLowestDamage,
    },
    slippage_source_breakdown: slippageSourceBreakdown,
    opportunities: enriched,
    conclusion,
  };

  writeJson(OUTPUT_JSON, output);

  console.log('DOG-MM DLMM NEAR BREAKEVEN');
  console.log(`total_opportunities: ${output.summary.total_opportunities}`);
  console.log(`multi_hop_penalty_exists: ${output.summary.multi_hop_penalty_exists}`);
  console.log(`pool_level_analysis: ${output.summary.pool_level_analysis}`);
  console.log(`top_10_near_breakeven_pairs: ${top10NearBreakEven.map(item => item.pair).join(', ')}`);
  console.log(
    `best_pairs_by_break_even_gap: ${bestPairs.slice(0, 5).map(item => item.pair).join(', ')}`
  );
  console.log(
    `worst_pairs_by_break_even_gap: ${worstPairs.slice(0, 5).map(item => item.pair).join(', ')}`
  );
  console.log(`slippage_source_dominant: ${dominantSource}`);
  console.log(`conclusion: ${conclusion}`);
  console.log(`output_json: ${OUTPUT_JSON}`);
}

main();
