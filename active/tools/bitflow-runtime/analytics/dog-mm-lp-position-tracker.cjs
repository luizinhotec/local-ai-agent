#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const CANDIDATE_JSON = path.resolve(STATE_DIR, 'dog-mm-lp-candidate-pools.json');
const MARKET_JSON = path.resolve(STATE_DIR, 'dog-mm-market-condition.json');
const LP_PLAN_JSON = path.resolve(STATE_DIR, 'bitflow-last-lp-add-plan.json');
const PNL_SUMMARY_JSON = path.resolve(STATE_DIR, 'dog-mm-pnl-summary.json');
const TOXIC_POOLS_JSON = path.resolve(__dirname, 'dog-mm-dlmm-toxic-pools.json');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-lp-strategy-state.json');
const BFF_POOLS_URL = 'https://bff.bitflowapis.finance/api/quotes/v1/pools';

const RISK_LIMITS = {
  maxExposurePerPoolUsd: 25,
  maxTotalExposureUsd: 50,
  maxDrawdownPct: 5,
};

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

async function fetchBffPools() {
  const response = await fetch(BFF_POOLS_URL);
  const json = await response.json();
  return Array.isArray(json?.pools) ? json.pools : [];
}

function computeIlPct(entryPrice, currentPrice) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(currentPrice) || entryPrice <= 0 || currentPrice <= 0) {
    return null;
  }
  const ratio = currentPrice / entryPrice;
  const il = (2 * Math.sqrt(ratio)) / (1 + ratio) - 1;
  return round(il * 100, 6);
}

async function main() {
  const candidates = readJson(CANDIDATE_JSON) || { candidate_pools: [] };
  const market = readJson(MARKET_JSON) || { market_state: 'VOLATILE', pools: [] };
  const lpPlan = readJson(LP_PLAN_JSON);
  const pnl = readJson(PNL_SUMMARY_JSON);
  const toxic = readJson(TOXIC_POOLS_JSON) || { toxic_pools: [] };
  const bffPools = await fetchBffPools();
  const toxicSet = new Set(toxic.toxic_pools || []);
  const stablePools = new Set((market.pools || []).filter(item => item.market_state === 'STABLE').map(item => item.pool_id));

  const candidatePools = (candidates.candidate_pools || []).map(pool => ({
    ...pool,
    market_state: (market.pools || []).find(item => item.pool_id === pool.pool_id)?.market_state || 'VOLATILE',
    recommended_action:
      stablePools.has(pool.pool_id) &&
      (pool.avg_price_impact_percent ?? Infinity) < 4 &&
      (pool.avg_break_even_gap ?? Infinity) < 1
        ? 'ENTER_LP'
        : 'WATCH',
  }));

  const activePositions = [];
  if (lpPlan && pnl && pnl.cycle?.status === 'open') {
    const poolId = lpPlan.poolContract || null;
    const poolMeta = bffPools.find(pool => pool.pool_token === poolId) || null;
    const entryValueUsd = Number(pnl?.deployedInventory?.valueUsdAtEntryMark);
    const currentValueUsd = Number(pnl?.currentInventory?.markedValueUsdNow);
    const grossUsd = Number(pnl?.pnl?.grossUsd);
    const drawdownPct =
      Number.isFinite(entryValueUsd) && entryValueUsd > 0 && Number.isFinite(grossUsd)
        ? round((-grossUsd / entryValueUsd) * 100)
        : null;
    const entryPrice = Number(pnl?.market?.entrySbtcUsd);
    const currentPrice = Number(pnl?.market?.btcUsdNow);
    const estimatedIlPct = computeIlPct(entryPrice, currentPrice);
    const estimatedIlUsd =
      Number.isFinite(estimatedIlPct) && Number.isFinite(entryValueUsd)
        ? round((estimatedIlPct / 100) * entryValueUsd)
        : null;

    const isToxic = toxicSet.has(poolId);
    const marketState = (market.pools || []).find(item => item.pool_id === poolId)?.market_state || 'VOLATILE';
    const riskFlags = [];
    if (isToxic) riskFlags.push('TOXIC_POOL');
    if (Number.isFinite(currentValueUsd) && currentValueUsd > RISK_LIMITS.maxExposurePerPoolUsd) riskFlags.push('EXPOSURE_PER_POOL_EXCEEDED');
    if (Number.isFinite(drawdownPct) && drawdownPct > RISK_LIMITS.maxDrawdownPct) riskFlags.push('MAX_DRAWDOWN_EXCEEDED');
    if (marketState === 'VOLATILE') riskFlags.push('MARKET_VOLATILE');

    activePositions.push({
      pool_id: poolId,
      pool_symbol: poolMeta?.pool_symbol || null,
      entry_price: Number.isFinite(entryPrice) ? entryPrice : null,
      current_price: Number.isFinite(currentPrice) ? currentPrice : null,
      estimated_pnl: Number.isFinite(grossUsd) ? grossUsd : null,
      estimated_il: estimatedIlUsd,
      estimated_il_pct: estimatedIlPct,
      exposure_usd: Number.isFinite(currentValueUsd) ? currentValueUsd : null,
      market_state: marketState,
      risk_flags: riskFlags,
      recommended_action: riskFlags.length > 0 ? 'EXIT_LP' : 'HOLD_LP',
    });
  }

  const totalExposure = round(
    activePositions.reduce((sum, position) => sum + (Number.isFinite(position.exposure_usd) ? position.exposure_usd : 0), 0)
  );
  const overallRiskFlags = [];
  if (Number.isFinite(totalExposure) && totalExposure > RISK_LIMITS.maxTotalExposureUsd) {
    overallRiskFlags.push('TOTAL_EXPOSURE_EXCEEDED');
  }
  if (activePositions.some(position => position.recommended_action === 'EXIT_LP')) {
    overallRiskFlags.push('ACTIVE_POSITION_REQUIRES_EXIT');
  }

  const output = {
    generated_at: new Date().toISOString(),
    risk_limits: RISK_LIMITS,
    active_positions: activePositions,
    candidate_pools: candidatePools,
    market_state: market.market_state || 'VOLATILE',
    total_exposure: totalExposure,
    risk_status: overallRiskFlags.length > 0 ? 'EXIT_OR_HOLD_DEFENSIVE' : 'CONTROLLED',
    risk_flags: overallRiskFlags,
  };

  writeJson(OUTPUT_JSON, output);

  console.log('DOG-MM LP POSITION TRACKER');
  console.log(`active_position_count: ${activePositions.length}`);
  console.log(`candidate_pool_count: ${candidatePools.length}`);
  console.log(`market_state: ${output.market_state}`);
  console.log(`total_exposure: ${output.total_exposure}`);
  console.log(`risk_status: ${output.risk_status}`);
  console.log(`output_json: ${OUTPUT_JSON}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
