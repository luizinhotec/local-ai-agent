#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const CANDIDATE_SELECTOR = path.resolve(__dirname, 'dog-mm-lp-candidate-selector.cjs');
const MARKET_DETECTOR = path.resolve(__dirname, 'dog-mm-market-condition-detector.cjs');
const POSITION_TRACKER = path.resolve(__dirname, 'dog-mm-lp-position-tracker.cjs');

const CANDIDATE_JSON = path.resolve(STATE_DIR, 'dog-mm-lp-candidate-pools.json');
const MARKET_JSON = path.resolve(STATE_DIR, 'dog-mm-market-condition.json');
const STRATEGY_JSON = path.resolve(STATE_DIR, 'dog-mm-lp-strategy-state.json');
const OUTPUT_JSON = path.resolve(__dirname, 'dog-mm-market-regime-monitor-log.json');

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runScript(filePath) {
  const result = spawnSync(process.execPath, [filePath], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env },
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Failed running ${path.basename(filePath)}: ${result.stderr || result.stdout}`.trim());
  }
}

function buildCycleSnapshot(cycleIndex) {
  const candidateState = readJson(CANDIDATE_JSON);
  const marketState = readJson(MARKET_JSON);
  const strategyState = readJson(STRATEGY_JSON);
  const candidates = Array.isArray(strategyState.candidate_pools) ? strategyState.candidate_pools : [];
  const positions = Array.isArray(strategyState.active_positions) ? strategyState.active_positions : [];

  const entryCandidates = candidates.filter(item => item.recommended_action === 'ENTER_LP');
  const exitPositions = positions.filter(item => item.recommended_action === 'EXIT_LP');
  const holdDefensive = positions.filter(item => item.recommended_action !== 'EXIT_LP');

  return {
    cycle: cycleIndex,
    timestamp: new Date().toISOString(),
    market_state: marketState.market_state || strategyState.market_state || 'UNKNOWN',
    candidate_pools_count: candidateState.candidate_pool_count || candidates.length,
    active_position_count: positions.length,
    entry_signal: entryCandidates.length > 0,
    exit_signal: exitPositions.length > 0,
    risk_status: strategyState.risk_status || 'UNKNOWN',
    enter_lp_signal_count: entryCandidates.length,
    exit_lp_signal_count: exitPositions.length,
    watch_count: candidates.filter(item => item.recommended_action === 'WATCH').length,
    hold_defensive_count: holdDefensive.length,
    candidate_pools: candidates.map(item => ({
      pool_id: item.pool_id,
      symbol: item.pool_symbol,
      market_state: item.market_state,
      avg_price_impact_percent: item.avg_price_impact_percent,
      avg_break_even_gap: item.avg_break_even_gap,
      action: item.recommended_action || 'WATCH',
    })),
    active_positions: positions.map(item => ({
      pool_id: item.pool_id,
      symbol: item.pool_symbol,
      market_state: item.market_state,
      estimated_pnl: item.estimated_pnl,
      estimated_il_pct: item.estimated_il_pct,
      action: item.recommended_action === 'EXIT_LP' ? 'EXIT_LP' : 'HOLD_DEFENSIVE',
      risk_flags: item.risk_flags || [],
    })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cycles = Number(args.cycles || 4);
  const intervalMs = Number(args['interval-ms'] || 2000);
  if (!Number.isFinite(cycles) || cycles <= 0) throw new Error('Invalid --cycles');
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error('Invalid --interval-ms');

  const snapshots = [];
  for (let index = 0; index < cycles; index += 1) {
    runScript(CANDIDATE_SELECTOR);
    runScript(MARKET_DETECTOR);
    runScript(POSITION_TRACKER);
    snapshots.push(buildCycleSnapshot(index + 1));
    if (index < cycles - 1 && intervalMs > 0) sleep(intervalMs);
  }

  const output = {
    generated_at: new Date().toISOString(),
    cycles_requested: cycles,
    interval_ms: intervalMs,
    cycles: snapshots,
  };

  writeJson(OUTPUT_JSON, output);

  console.log('DOG-MM MARKET REGIME MONITOR');
  console.log(`cycles_recorded: ${snapshots.length}`);
  console.log(`stable_cycles: ${snapshots.filter(item => item.market_state === 'STABLE').length}`);
  console.log(`enter_lp_signal_count: ${snapshots.reduce((sum, item) => sum + item.enter_lp_signal_count, 0)}`);
  console.log(`exit_lp_signal_count: ${snapshots.reduce((sum, item) => sum + item.exit_lp_signal_count, 0)}`);
  console.log(`output_json: ${OUTPUT_JSON}`);
}

main();
