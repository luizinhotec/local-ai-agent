#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const CANDIDATE_JSON = path.resolve(STATE_DIR, 'dog-mm-lp-candidate-pools.json');
const NEAR_BREAKEVEN_JSON = path.resolve(STATE_DIR, 'dog-mm-dlmm-near-breakeven-analysis.json');
const ECONOMIC_JSON = path.resolve(STATE_DIR, 'dog-mm-dlmm-economic-analysis.json');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-market-condition.json');

const STABLE_THRESHOLDS = {
  maxVolatilityRecentPct: 2,
  maxPriceImpactMean: 5,
  maxBreakEvenGap: 10,
  minStabilityScore: 60,
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

function stddev(values, digits = 6) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length <= 1) return 0;
  const mean = filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
  const variance = filtered.reduce((sum, value) => sum + (value - mean) ** 2, 0) / filtered.length;
  return Number(Math.sqrt(variance).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function main() {
  const candidates = readJson(CANDIDATE_JSON);
  const nearBreakeven = readJson(NEAR_BREAKEVEN_JSON);
  const economic = readJson(ECONOMIC_JSON);
  const opportunities = Array.isArray(nearBreakeven?.opportunities) ? nearBreakeven.opportunities : [];
  const economicOpportunities = Array.isArray(economic?.opportunities) ? economic.opportunities : [];

  const poolStates = (candidates.candidate_pools || []).map(pool => {
    const poolOpportunities = opportunities.filter(item => (item.execution_pools || []).includes(pool.pool_id));
    const economicMatches = economicOpportunities.filter(item => item.candidate_id && poolOpportunities.some(match => match.candidate_id === item.candidate_id));
    const recentVolatilityPct = stddev(poolOpportunities.map(item => item.price_impact_percent));
    const priceImpactMean = average(poolOpportunities.map(item => item.price_impact_percent));
    const breakEvenMean = average(poolOpportunities.map(item => item.break_even_gap));
    const netEdgeMean = average(economicMatches.map(item => item.net_edge));
    const stabilityScore = clamp(
      100 - ((priceImpactMean || 0) * 8 + (recentVolatilityPct || 0) * 12 + (breakEvenMean || 0) * 0.8),
      0,
      100
    );
    const marketState =
      (recentVolatilityPct || 0) <= STABLE_THRESHOLDS.maxVolatilityRecentPct &&
      (priceImpactMean || 0) <= STABLE_THRESHOLDS.maxPriceImpactMean &&
      (breakEvenMean || 0) <= STABLE_THRESHOLDS.maxBreakEvenGap &&
      stabilityScore >= STABLE_THRESHOLDS.minStabilityScore
        ? 'STABLE'
        : 'VOLATILE';

    return {
      pool_id: pool.pool_id,
      pool_symbol: pool.pool_symbol,
      pair_candidates: pool.pair_candidates,
      recent_volatility_pct: recentVolatilityPct,
      price_impact_mean: priceImpactMean,
      break_even_gap_mean: breakEvenMean,
      avg_net_edge: netEdgeMean,
      stability_score: stabilityScore,
      market_state: marketState,
    };
  });

  const overallState = poolStates.some(item => item.market_state === 'STABLE') ? 'STABLE' : 'VOLATILE';
  const output = {
    generated_at: new Date().toISOString(),
    thresholds: STABLE_THRESHOLDS,
    market_state: overallState,
    pools: poolStates,
  };

  writeJson(OUTPUT_JSON, output);

  console.log('DOG-MM MARKET CONDITION DETECTOR');
  console.log(`market_state: ${overallState}`);
  console.log(`stable_pool_count: ${poolStates.filter(item => item.market_state === 'STABLE').length}`);
  console.log(`output_json: ${OUTPUT_JSON}`);
}

main();
