#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const MONITOR_JSON = path.resolve(__dirname, 'dog-mm-market-regime-monitor-log.json');
const OUTPUT_JSON = path.resolve(__dirname, 'dog-mm-entry-window-analysis.json');
const MIN_PRACTICAL_WINDOW_CYCLES = 2;
const BREAK_EVEN_PRACTICAL_THRESHOLD = 1;

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

function groupEventsByPool(cycles) {
  const events = [];
  for (const cycle of cycles) {
    for (const pool of cycle.candidate_pools || []) {
      events.push({
        timestamp: cycle.timestamp,
        pool_id: pool.pool_id,
        symbol: pool.symbol,
        market_state: cycle.market_state,
        avg_price_impact_percent: pool.avg_price_impact_percent,
        avg_break_even_gap: pool.avg_break_even_gap,
        stability_score: null,
        action: pool.action || 'WATCH',
      });
    }
    for (const position of cycle.active_positions || []) {
      events.push({
        timestamp: cycle.timestamp,
        pool_id: position.pool_id,
        symbol: position.symbol,
        market_state: cycle.market_state,
        avg_price_impact_percent: null,
        avg_break_even_gap: null,
        stability_score: null,
        action: position.action || 'HOLD_DEFENSIVE',
      });
    }
  }

  const grouped = new Map();
  for (const event of events) {
    const key = `${event.pool_id}|${event.action}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }
  return { events, grouped };
}

function buildWindows(cycles) {
  const windows = [];
  const byPool = new Map();

  for (const cycle of cycles) {
    for (const pool of cycle.candidate_pools || []) {
      const current = byPool.get(pool.pool_id) || null;
      const qualifies = cycle.market_state === 'STABLE' && pool.action === 'ENTER_LP';

      if (qualifies) {
        if (!current) {
          byPool.set(pool.pool_id, {
            pool_id: pool.pool_id,
            symbol: pool.symbol,
            window_start: cycle.timestamp,
            window_end: cycle.timestamp,
            duration_cycles: 1,
            break_even_gaps: [pool.avg_break_even_gap],
            stability_scores: [],
          });
        } else {
          current.window_end = cycle.timestamp;
          current.duration_cycles += 1;
          current.break_even_gaps.push(pool.avg_break_even_gap);
        }
      } else if (current) {
        windows.push({
          ...current,
          window_duration: current.duration_cycles,
          min_break_even_gap_durante_janela: Math.min(...current.break_even_gaps.filter(Number.isFinite)),
          max_break_even_gap_durante_janela: Math.max(...current.break_even_gaps.filter(Number.isFinite)),
          avg_stability_score: average(current.stability_scores),
        });
        byPool.delete(pool.pool_id);
      }
    }
  }

  for (const current of byPool.values()) {
    windows.push({
      ...current,
      window_duration: current.duration_cycles,
      min_break_even_gap_durante_janela: Math.min(...current.break_even_gaps.filter(Number.isFinite)),
      max_break_even_gap_durante_janela: Math.max(...current.break_even_gaps.filter(Number.isFinite)),
      avg_stability_score: average(current.stability_scores),
    });
  }

  return windows;
}

function main() {
  const monitor = readJson(MONITOR_JSON);
  const cycles = Array.isArray(monitor.cycles) ? monitor.cycles : [];
  const windows = buildWindows(cycles);
  const { events } = groupEventsByPool(cycles);

  const summary = {
    total_cycles: cycles.length,
    stable_cycles: cycles.filter(item => item.market_state === 'STABLE').length,
    volatile_cycles: cycles.filter(item => item.market_state === 'VOLATILE').length,
    enter_lp_signal_count: cycles.reduce((sum, item) => sum + (item.enter_lp_signal_count || 0), 0),
    exit_lp_signal_count: cycles.reduce((sum, item) => sum + (item.exit_lp_signal_count || 0), 0),
    watch_count: cycles.reduce((sum, item) => sum + (item.watch_count || 0), 0),
    hold_defensive_count: cycles.reduce((sum, item) => sum + (item.hold_defensive_count || 0), 0),
  };

  const usableWindows = windows.filter(window => window.window_duration >= MIN_PRACTICAL_WINDOW_CYCLES);
  const bestByBreakEven = [...windows]
    .filter(window => Number.isFinite(window.min_break_even_gap_durante_janela))
    .sort((left, right) => left.min_break_even_gap_durante_janela - right.min_break_even_gap_durante_janela)[0] || null;
  const bestByStability = [...windows]
    .filter(window => Number.isFinite(window.avg_stability_score))
    .sort((left, right) => (right.avg_stability_score ?? -Infinity) - (left.avg_stability_score ?? -Infinity))[0] || null;

  let conclusion = 'NO_REAL_ENTRY_WINDOWS_OBSERVED';
  if (windows.length > 0 && usableWindows.length === 0) {
    conclusion = 'ENTRY_WINDOWS_EXIST_BUT_ARE_IMPRACTICAL';
  } else if (
    usableWindows.length > 0 &&
    bestByBreakEven &&
    Number.isFinite(bestByBreakEven.min_break_even_gap_durante_janela) &&
    bestByBreakEven.min_break_even_gap_durante_janela <= BREAK_EVEN_PRACTICAL_THRESHOLD
  ) {
    conclusion = 'LP_ENTRY_WINDOWS_OBSERVED';
  }

  const output = {
    generated_at: new Date().toISOString(),
    summary,
    windows: {
      total_entry_windows: windows.length,
      avg_window_duration: average(windows.map(item => item.window_duration)),
      max_window_duration: windows.length > 0 ? Math.max(...windows.map(item => item.window_duration)) : 0,
      pools_that_generated_entry: [...new Set(windows.map(item => item.pool_id))],
      best_window_by_break_even_gap: bestByBreakEven,
      best_window_by_stability_score: bestByStability,
    },
    cycle_events: events,
    entry_windows: windows,
    conclusion,
  };

  writeJson(OUTPUT_JSON, output);

  console.log('DOG-MM ENTRY WINDOW COLLECTOR');
  console.log(`total_cycles: ${summary.total_cycles}`);
  console.log(`total_entry_windows: ${output.windows.total_entry_windows}`);
  console.log(`enter_lp_signal_count: ${summary.enter_lp_signal_count}`);
  console.log(`conclusion: ${conclusion}`);
  console.log(`output_json: ${OUTPUT_JSON}`);
}

main();
