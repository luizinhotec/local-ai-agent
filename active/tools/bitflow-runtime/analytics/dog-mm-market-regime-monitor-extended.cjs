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

const LOG_JSON = path.resolve(__dirname, 'dog-mm-market-regime-monitor-extended-log.json');
const ANALYSIS_JSON = path.resolve(__dirname, 'dog-mm-market-regime-extended-analysis.json');

const DEFAULTS = {
  totalCycles: 100,
  intervalMs: 2000,
  minPracticalWindowMs: 10000,
  minEntryFrequency: 0.02,
};

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
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

function average(values, digits = 6) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length === 0) return null;
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(digits));
}

function buildCycleSnapshot(cycleIndex) {
  const candidateState = readJson(CANDIDATE_JSON);
  const marketState = readJson(MARKET_JSON);
  const strategyState = readJson(STRATEGY_JSON);
  const marketPools = Array.isArray(marketState.pools) ? marketState.pools : [];
  const candidates = Array.isArray(strategyState.candidate_pools) ? strategyState.candidate_pools : [];
  const positions = Array.isArray(strategyState.active_positions) ? strategyState.active_positions : [];

  const entryCandidates = candidates.filter(item => item.recommended_action === 'ENTER_LP');
  const exitPositions = positions.filter(item => item.recommended_action === 'EXIT_LP');
  const holdDefensive = positions.filter(item => item.recommended_action !== 'EXIT_LP');

  return {
    timestamp: new Date().toISOString(),
    cycle_index: cycleIndex,
    market_state: marketState.market_state || strategyState.market_state || 'UNKNOWN',
    risk_status: strategyState.risk_status || 'UNKNOWN',
    candidate_pools: candidates.map(item => {
      const marketPool = marketPools.find(pool => pool.pool_id === item.pool_id) || {};
      return {
        pool_id: item.pool_id,
        symbol: item.pool_symbol,
        action: item.recommended_action || 'WATCH',
        avg_price_impact_percent: item.avg_price_impact_percent,
        avg_break_even_gap: item.avg_break_even_gap,
        stability_score: marketPool.stability_score ?? null,
      };
    }),
    active_positions: positions.map(item => ({
      pool_id: item.pool_id,
      symbol: item.pool_symbol,
      action: item.recommended_action === 'EXIT_LP' ? 'EXIT_LP' : 'HOLD_DEFENSIVE',
      estimated_pnl: item.estimated_pnl,
      estimated_il_pct: item.estimated_il_pct,
      risk_flags: item.risk_flags || [],
    })),
    signals: {
      enter_lp_signal_count: entryCandidates.length,
      exit_lp_signal_count: exitPositions.length,
      watch_count: candidates.filter(item => item.recommended_action === 'WATCH').length,
      hold_defensive_count: holdDefensive.length,
    },
  };
}

function buildEntryWindows(cycles, intervalMs) {
  const windows = [];
  const openWindows = new Map();

  for (const cycle of cycles) {
    const currentPoolIds = new Set();
    for (const pool of cycle.candidate_pools || []) {
      currentPoolIds.add(pool.pool_id);
      const qualifies = cycle.market_state === 'STABLE' && pool.action === 'ENTER_LP';
      const existing = openWindows.get(pool.pool_id) || null;

      if (qualifies) {
        if (!existing) {
          openWindows.set(pool.pool_id, {
            window_id: `window-${windows.length + openWindows.size + 1}`,
            pool_id: pool.pool_id,
            symbol: pool.symbol,
            start_timestamp: cycle.timestamp,
            end_timestamp: cycle.timestamp,
            break_even_gaps: [pool.avg_break_even_gap],
            stability_scores: [pool.stability_score],
          });
        } else {
          existing.end_timestamp = cycle.timestamp;
          existing.break_even_gaps.push(pool.avg_break_even_gap);
          existing.stability_scores.push(pool.stability_score);
        }
      } else if (existing) {
        const start = new Date(existing.start_timestamp).getTime();
        const end = new Date(existing.end_timestamp).getTime();
        windows.push({
          window_id: existing.window_id,
          pool_id: existing.pool_id,
          symbol: existing.symbol,
          start_timestamp: existing.start_timestamp,
          end_timestamp: existing.end_timestamp,
          duration_ms: Math.max(intervalMs, end - start + intervalMs),
          min_break_even_gap: Math.min(...existing.break_even_gaps.filter(Number.isFinite)),
          max_break_even_gap: Math.max(...existing.break_even_gaps.filter(Number.isFinite)),
          avg_stability_score: average(existing.stability_scores),
        });
        openWindows.delete(pool.pool_id);
      }
    }

    for (const [poolId, existing] of [...openWindows.entries()]) {
      if (!currentPoolIds.has(poolId)) {
        const start = new Date(existing.start_timestamp).getTime();
        const end = new Date(existing.end_timestamp).getTime();
        windows.push({
          window_id: existing.window_id,
          pool_id: existing.pool_id,
          symbol: existing.symbol,
          start_timestamp: existing.start_timestamp,
          end_timestamp: existing.end_timestamp,
          duration_ms: Math.max(intervalMs, end - start + intervalMs),
          min_break_even_gap: Math.min(...existing.break_even_gaps.filter(Number.isFinite)),
          max_break_even_gap: Math.max(...existing.break_even_gaps.filter(Number.isFinite)),
          avg_stability_score: average(existing.stability_scores),
        });
        openWindows.delete(poolId);
      }
    }
  }

  for (const existing of openWindows.values()) {
    const start = new Date(existing.start_timestamp).getTime();
    const end = new Date(existing.end_timestamp).getTime();
    windows.push({
      window_id: existing.window_id,
      pool_id: existing.pool_id,
      symbol: existing.symbol,
      start_timestamp: existing.start_timestamp,
      end_timestamp: existing.end_timestamp,
      duration_ms: Math.max(intervalMs, end - start + intervalMs),
      min_break_even_gap: Math.min(...existing.break_even_gaps.filter(Number.isFinite)),
      max_break_even_gap: Math.max(...existing.break_even_gaps.filter(Number.isFinite)),
      avg_stability_score: average(existing.stability_scores),
    });
  }

  return windows;
}

function buildAnalysis(cycles, intervalMs, thresholds) {
  const windows = buildEntryWindows(cycles, intervalMs);
  const totalCycles = cycles.length;
  const stableCycles = cycles.filter(item => item.market_state === 'STABLE').length;
  const volatileCycles = cycles.filter(item => item.market_state === 'VOLATILE').length;
  const enterCount = cycles.reduce((sum, item) => sum + (item.signals?.enter_lp_signal_count || 0), 0);
  const exitCount = cycles.reduce((sum, item) => sum + (item.signals?.exit_lp_signal_count || 0), 0);
  const watchCount = cycles.reduce((sum, item) => sum + (item.signals?.watch_count || 0), 0);
  const holdCount = cycles.reduce((sum, item) => sum + (item.signals?.hold_defensive_count || 0), 0);

  const bestByGap = [...windows]
    .filter(item => Number.isFinite(item.min_break_even_gap))
    .sort((left, right) => left.min_break_even_gap - right.min_break_even_gap)[0] || null;
  const bestByStability = [...windows]
    .filter(item => Number.isFinite(item.avg_stability_score))
    .sort((left, right) => (right.avg_stability_score ?? -Infinity) - (left.avg_stability_score ?? -Infinity))[0] || null;

  const entryFrequency = totalCycles > 0 ? windows.length / totalCycles : 0;
  const stableRatio = totalCycles > 0 ? stableCycles / totalCycles : 0;

  let conclusion = 'NO_ENTRY_WINDOWS_AFTER_EXTENDED_MONITORING';
  if (
    windows.length > 0 &&
    (average(windows.map(item => item.duration_ms)) < thresholds.minPracticalWindowMs || entryFrequency < thresholds.minEntryFrequency)
  ) {
    conclusion = 'ENTRY_WINDOWS_TOO_RARE_OR_TOO_SHORT';
  } else if (windows.length > 0) {
    conclusion = 'LP_STRATEGY_HAS_REAL_OPERATIONAL_WINDOWS';
  }

  return {
    summary: {
      total_cycles: totalCycles,
      stable_cycles: stableCycles,
      volatile_cycles: volatileCycles,
      stable_ratio: Number(stableRatio.toFixed(6)),
    },
    signals: {
      enter_lp_signal_count: enterCount,
      exit_lp_signal_count: exitCount,
      watch_count: watchCount,
      hold_defensive_count: holdCount,
    },
    windows: {
      total_entry_windows: windows.length,
      avg_window_duration_ms: average(windows.map(item => item.duration_ms)),
      max_window_duration_ms: windows.length > 0 ? Math.max(...windows.map(item => item.duration_ms)) : 0,
      entry_frequency: Number(entryFrequency.toFixed(6)),
      unique_pools_with_entry: [...new Set(windows.map(item => item.pool_id))],
      best_window_by_gap: bestByGap,
      best_window_by_stability: bestByStability,
    },
    entry_windows: windows,
    conclusion,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const totalCycles = Number(args['total-cycles'] || DEFAULTS.totalCycles);
  const intervalMs = Number(args['interval-ms'] || DEFAULTS.intervalMs);
  if (!Number.isFinite(totalCycles) || totalCycles <= 0) throw new Error('Invalid --total-cycles');
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error('Invalid --interval-ms');

  const logPayload = {
    generated_at: new Date().toISOString(),
    total_cycles_requested: totalCycles,
    interval_ms: intervalMs,
    cycles: [],
  };

  for (let index = 0; index < totalCycles; index += 1) {
    runScript(CANDIDATE_SELECTOR);
    runScript(MARKET_DETECTOR);
    runScript(POSITION_TRACKER);
    logPayload.cycles.push(buildCycleSnapshot(index + 1));
    writeJson(LOG_JSON, logPayload);
    if (index < totalCycles - 1 && intervalMs > 0) sleep(intervalMs);
  }

  const analysis = buildAnalysis(logPayload.cycles, intervalMs, {
    minPracticalWindowMs: DEFAULTS.minPracticalWindowMs,
    minEntryFrequency: DEFAULTS.minEntryFrequency,
  });

  writeJson(ANALYSIS_JSON, {
    generated_at: new Date().toISOString(),
    ...analysis,
  });

  console.log('DOG-MM MARKET REGIME MONITOR EXTENDED');
  console.log(`total_cycles: ${analysis.summary.total_cycles}`);
  console.log(`stable_cycles: ${analysis.summary.stable_cycles}`);
  console.log(`enter_lp_signal_count: ${analysis.signals.enter_lp_signal_count}`);
  console.log(`total_entry_windows: ${analysis.windows.total_entry_windows}`);
  console.log(`entry_frequency: ${analysis.windows.entry_frequency}`);
  console.log(`conclusion: ${analysis.conclusion}`);
  console.log(`log_json: ${LOG_JSON}`);
  console.log(`analysis_json: ${ANALYSIS_JSON}`);
}

main();
