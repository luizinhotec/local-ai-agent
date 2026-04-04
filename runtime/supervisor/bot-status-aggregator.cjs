'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOG_STATE_DIR = path.join(ROOT, 'active', 'state', 'dog-mm');
const DERIBIT_STATE_DIR = path.join(ROOT, 'workspace', 'deribit', 'state');

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readLastLines(filePath, n) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split(/\r?\n/);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

function findLatestFile(dir, pattern) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => pattern.test(f))
      .sort()
      .reverse();
    return files.length > 0 ? path.join(dir, files[0]) : null;
  } catch {
    return null;
  }
}

function getDogMmStatus() {
  const setup = readJsonSafe(path.join(DOG_STATE_DIR, 'dog-mm-setup-status.json'));

  // Latest activity file: market-snapshot-* or auto-dryrun-*
  const latestFile = findLatestFile(DOG_STATE_DIR, /^(market-snapshot|auto-dryrun)-[\dTZ-]+\.json$/);
  const latestSnapshot = latestFile ? readJsonSafe(latestFile) : null;

  const stage = setup?.stage || 'unknown';
  const funded = setup?.wallet?.funded || false;

  let lastActivity = null;
  if (latestFile) {
    try {
      lastActivity = fs.statSync(latestFile).mtime.toISOString();
    } catch {}
  }

  const minutesSinceActivity = lastActivity
    ? (Date.now() - new Date(lastActivity).getTime()) / 60000
    : null;

  let status = 'ok';
  if (!funded) status = 'warn';
  if (funded && minutesSinceActivity !== null && minutesSinceActivity > 120) {
    status = 'critical';
  }

  const marketFavorable = latestSnapshot?.favorable ?? null;

  return {
    status,
    stage,
    funded,
    last_activity: lastActivity,
    minutes_since_activity: minutesSinceActivity !== null ? Math.round(minutesSinceActivity) : null,
    market_favorable: marketFavorable,
    last_snapshot_file: latestFile ? path.basename(latestFile) : null,
  };
}

function getDeribitStatus() {
  const botState = readJsonSafe(path.join(DERIBIT_STATE_DIR, 'deribit-bot-state.json'));
  const latest = readJsonSafe(path.join(DERIBIT_STATE_DIR, 'deribit-latest.json'));
  const metrics = readJsonSafe(path.join(DERIBIT_STATE_DIR, 'deribit-bot-metrics.json'));
  const logLines = readLastLines(path.join(DERIBIT_STATE_DIR, 'deribit-bot-loop.log'), 5);

  const lastCycle = botState?.lastCycleAt || null;
  const minutesSinceCycle = lastCycle
    ? (Date.now() - new Date(lastCycle).getTime()) / 60000
    : null;

  let status = 'ok';
  if (minutesSinceCycle === null) status = 'unknown';
  else if (minutesSinceCycle > 5) status = 'critical';

  return {
    status,
    environment: latest?.environment || 'unknown',
    position_usd: latest?.positionSizeUsd ?? null,
    position_direction: latest?.positionDirection || 'unknown',
    pnl_btc: latest?.positionFloatingPnl ?? null,
    last_cycle: lastCycle,
    minutes_since_cycle: minutesSinceCycle !== null ? Math.round(minutesSinceCycle) : null,
    open_orders: latest?.openOrderCount ?? null,
    cycle_count: metrics?.cycleCount ?? null,
    last_action: botState?.lastAction || null,
    last_log_lines: logLines,
  };
}

async function aggregateStatus() {
  const dog = getDogMmStatus();
  const deribit = getDeribitStatus();

  const alerts = [];
  if (dog.status === 'critical') {
    alerts.push(`DOG MM: wallet funded mas sem atividade há ${dog.minutes_since_activity}min`);
  }
  if (deribit.status === 'critical') {
    alerts.push(`Deribit: loop parado há ${deribit.minutes_since_cycle}min`);
  }

  let overall = 'ok';
  if (alerts.length > 0) overall = 'critical';
  else if (dog.status === 'warn' || deribit.status === 'warn' || deribit.status === 'unknown') overall = 'warn';

  return {
    timestamp: new Date().toISOString(),
    overall,
    bots: {
      dog_mm: dog,
      deribit,
    },
    alerts,
  };
}

module.exports = { aggregateStatus };

if (require.main === module) {
  aggregateStatus().then(s => {
    console.log(JSON.stringify(s, null, 2));
  }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
