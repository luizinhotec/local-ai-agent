#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const EVENT_LOG_PATH = path.join(__dirname, '..', 'state', 'deribit-events.jsonl');
const REPORT_PATH = path.join(__dirname, '..', 'state', 'deribit-reentry-gate-session-report.json');
const LOOP_PATH = path.join(__dirname, 'deribit-bot-loop.cjs');

function parseArgs(argv) {
  const options = {
    durationMs: 300000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--duration-ms') {
      options.durationMs = Number(argv[index + 1] || 0);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Deribit reentry gate session

Usage:
  node workspace/deribit/runtime/deribit-reentry-gate-session.cjs --duration-ms 300000
`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
    throw new Error('duration-ms must be a positive number');
  }

  return options;
}

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    return {};
  }

  return fs
    .readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(line => !line.trim().startsWith('#'))
    .reduce((acc, line) => {
      const parts = line.split('=');
      const key = parts.shift();
      if (!key) {
        return acc;
      }
      const rawValue = parts.join('=').trim();
      const cleanedValue = rawValue.replace(/^['"]|['"]$/g, '');
      acc[key.trim()] = cleanedValue;
      return acc;
    }, {});
}

function readEvents() {
  if (!fs.existsSync(EVENT_LOG_PATH)) {
    return [];
  }
  return fs
    .readFileSync(EVENT_LOG_PATH, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function isEntryAction(action) {
  return action === 'buy' || action === 'sell';
}

function buildSummary(events, startedAt, endedAt, childExit) {
  const botCycles = events.filter(event => event.type === 'bot_cycle');
  const sameDirectionBlockedEvents = events.filter(event => event.type === 'same_direction_reentry_blocked');
  const entryAttemptCycles = botCycles.filter(event => isEntryAction(event.summary?.action));
  const flatCycles = botCycles.filter(event => event.summary?.snapshotContext?.positionDirection === 'flat');
  const activeRoundTrueCycles = botCycles.filter(event => event.summary?.activeRound?.hasActiveRound === true);
  const highlightedCycles = botCycles
    .filter(event => {
      const blockers = event.summary?.blockers || [];
      return isEntryAction(event.summary?.action) || blockers.includes('same_direction_reentry_blocked');
    })
    .map(event => ({
      recordedAt: event.recordedAt,
      cycleId: event.summary?.cycleId || null,
      action: event.summary?.action || null,
      blockers: event.summary?.blockers || [],
      activeRound: event.summary?.activeRound || null,
      snapshotContext: event.summary?.snapshotContext || null,
    }));

  return {
    startedAt,
    endedAt,
    durationMs:
      Number.isFinite(new Date(startedAt).getTime()) && Number.isFinite(new Date(endedAt).getTime())
        ? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime())
        : null,
    childExit,
    cyclesObserved: botCycles.length,
    entryAttempts: entryAttemptCycles.length,
    sameDirectionReentryBlockedCount: sameDirectionBlockedEvents.length,
    flatCyclesCount: flatCycles.length,
    activeRoundTrueCount: activeRoundTrueCycles.length,
    sameDirectionBlockedEvents: sameDirectionBlockedEvents.map(event => ({
      recordedAt: event.recordedAt,
      cycleId: event.cycleId || null,
      attemptedDirection: event.attemptedDirection || null,
      activeRound: event.activeRound || null,
      snapshotContext: event.snapshotContext || null,
    })),
    highlightedCycles,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envFile = loadEnvFile();
  const childEnv = {
    ...process.env,
    ...envFile,
    DERIBIT_ENVIRONMENT: process.env.DERIBIT_ENVIRONMENT || envFile.DERIBIT_ENVIRONMENT || 'testnet',
    DERIBIT_CURRENCY: process.env.DERIBIT_CURRENCY || envFile.DERIBIT_CURRENCY || 'BTC',
    DERIBIT_INSTRUMENT: process.env.DERIBIT_INSTRUMENT || envFile.DERIBIT_INSTRUMENT || 'BTC-PERPETUAL',
  };

  if (!childEnv.DERIBIT_CLIENT_ID || !childEnv.DERIBIT_CLIENT_SECRET) {
    throw new Error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
  }

  const initialEvents = readEvents();
  const initialCount = initialEvents.length;
  const startedAt = new Date().toISOString();

  const child = spawn(process.execPath, [LOOP_PATH], {
    cwd: ROOT_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', chunk => {
    process.stdout.write(chunk);
  });
  child.stderr.on('data', chunk => {
    process.stderr.write(chunk);
  });

  let childExit = { code: null, signal: null };
  const waitForExit = new Promise(resolve => {
    child.on('exit', (code, signal) => {
      childExit = { code, signal };
      resolve();
    });
  });

  await new Promise(resolve => setTimeout(resolve, options.durationMs));
  if (!child.killed) {
    child.kill('SIGTERM');
  }
  await Promise.race([
    waitForExit,
    new Promise(resolve => setTimeout(resolve, 5000)),
  ]);

  if (!child.killed) {
    child.kill('SIGKILL');
  }

  const endedAt = new Date().toISOString();
  const finalEvents = readEvents().slice(initialCount);
  const summary = buildSummary(finalEvents, startedAt, endedAt, childExit);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2));

  console.log(`session_started_at: ${summary.startedAt}`);
  console.log(`session_ended_at: ${summary.endedAt}`);
  console.log(`cycles_observed: ${summary.cyclesObserved}`);
  console.log(`entry_attempts: ${summary.entryAttempts}`);
  console.log(`same_direction_reentry_blocked_count: ${summary.sameDirectionReentryBlockedCount}`);
  console.log(`flat_cycles_count: ${summary.flatCyclesCount}`);
  console.log(`active_round_true_count: ${summary.activeRoundTrueCount}`);
  console.log(`report_path: ${REPORT_PATH}`);
}

main().catch(error => {
  console.error(`[deribit-reentry-gate-session] ${error.message}`);
  process.exit(1);
});
