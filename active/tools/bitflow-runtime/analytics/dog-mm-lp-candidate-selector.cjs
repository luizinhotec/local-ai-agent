#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const NEAR_BREAKEVEN_JSON = path.resolve(STATE_DIR, 'dog-mm-dlmm-near-breakeven-analysis.json');
const TOXIC_POOLS_JSON = path.resolve(__dirname, 'dog-mm-dlmm-toxic-pools.json');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-lp-candidate-pools.json');
const BFF_POOLS_URL = 'https://bff.bitflowapis.finance/api/quotes/v1/pools';

const THRESHOLDS = {
  maxAvgPriceImpactPercent: 5,
  maxAvgBreakEvenGap: 50,
  maxAvgExecutionPathLength: 3.5,
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function average(values, digits = 6) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length === 0) return null;
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(digits));
}

async function fetchBffPools() {
  const response = await fetch(BFF_POOLS_URL);
  const json = await response.json();
  return Array.isArray(json?.pools) ? json.pools : [];
}

function mainSelectorData(nearBreakeven, toxicPools, bffPools) {
  const toxicSet = new Set(toxicPools);
  const opportunities = Array.isArray(nearBreakeven?.opportunities) ? nearBreakeven.opportunities : [];
  const poolRows = new Map();

  for (const opportunity of opportunities) {
    for (const pool of opportunity.execution_pools || []) {
      if (!poolRows.has(pool)) poolRows.set(pool, []);
      poolRows.get(pool).push(opportunity);
    }
  }

  return [...poolRows.entries()].map(([pool_id, items]) => {
    const pairSet = new Set(items.map(item => item.pair).filter(Boolean));
    const bff = bffPools.find(pool => pool.pool_token === pool_id) || null;
    const avgPriceImpactPercent = average(items.map(item => item.price_impact_percent));
    const avgBreakEvenGap = average(items.map(item => item.break_even_gap));
    const avgExecutionPathLength = average(items.map(item => item.hop_count));
    const isToxic = toxicSet.has(pool_id);
    const eligible =
      !isToxic &&
      Number.isFinite(avgPriceImpactPercent) &&
      Number.isFinite(avgBreakEvenGap) &&
      Number.isFinite(avgExecutionPathLength) &&
      avgPriceImpactPercent <= THRESHOLDS.maxAvgPriceImpactPercent &&
      avgBreakEvenGap <= THRESHOLDS.maxAvgBreakEvenGap &&
      avgExecutionPathLength <= THRESHOLDS.maxAvgExecutionPathLength;

    return {
      pool_id,
      pool_symbol: bff?.pool_symbol || bff?.pool_name || null,
      pair_candidates: [...pairSet],
      venue: 'bitflow-dlmm',
      avg_price_impact_percent: avgPriceImpactPercent,
      avg_break_even_gap: avgBreakEvenGap,
      avg_execution_path_length: avgExecutionPathLength,
      tvl_usd: Number.isFinite(Number(bff?.tvl_usd)) ? Number(bff.tvl_usd) : null,
      active_bin: Number.isFinite(Number(bff?.active_bin)) ? Number(bff.active_bin) : null,
      bin_step: Number.isFinite(Number(bff?.bin_step)) ? Number(bff.bin_step) : null,
      total_fee_bps: Number.isFinite(Number(bff?.x_total_fee_bps)) ? Number(bff.x_total_fee_bps) : null,
      is_toxic: isToxic,
      selection_status: eligible ? 'ELIGIBLE' : 'REJECTED',
      rejection_reason: isToxic
        ? 'TOXIC_POOL'
        : avgPriceImpactPercent > THRESHOLDS.maxAvgPriceImpactPercent
          ? 'PRICE_IMPACT_TOO_HIGH'
          : avgBreakEvenGap > THRESHOLDS.maxAvgBreakEvenGap
            ? 'BREAK_EVEN_GAP_TOO_HIGH'
            : avgExecutionPathLength > THRESHOLDS.maxAvgExecutionPathLength
              ? 'PATH_TOO_LONG'
              : null,
    };
  });
}

async function main() {
  const nearBreakeven = readJson(NEAR_BREAKEVEN_JSON);
  const toxicPoolsJson = readJson(TOXIC_POOLS_JSON);
  const bffPools = await fetchBffPools();
  const selectorRows = mainSelectorData(
    nearBreakeven,
    toxicPoolsJson.toxic_pools || [],
    bffPools
  ).sort((left, right) => {
    const gapDiff = (left.avg_break_even_gap ?? Infinity) - (right.avg_break_even_gap ?? Infinity);
    if (gapDiff !== 0) return gapDiff;
    return (left.avg_price_impact_percent ?? Infinity) - (right.avg_price_impact_percent ?? Infinity);
  });

  const candidatePools = selectorRows.filter(item => item.selection_status === 'ELIGIBLE');

  const output = {
    generated_at: new Date().toISOString(),
    thresholds: THRESHOLDS,
    candidate_pool_count: candidatePools.length,
    candidate_pools: candidatePools,
    evaluated_pools: selectorRows,
  };

  writeJson(OUTPUT_JSON, output);

  console.log('DOG-MM LP CANDIDATE SELECTOR');
  console.log(`candidate_pool_count: ${candidatePools.length}`);
  console.log(`candidate_pools: ${candidatePools.map(item => item.pool_id).join(', ') || 'none'}`);
  console.log(`output_json: ${OUTPUT_JSON}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
