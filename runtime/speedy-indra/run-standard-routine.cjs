#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const MONITOR_SCRIPT = path.join(ROOT_DIR, 'runtime', 'speedy-indra', 'agent-monitor.cjs');
const LOOP_SCRIPT = path.join(ROOT_DIR, 'runtime', 'speedy-indra', 'agent-standard-loop.cjs');

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseArgs(argv) {
  const parsed = {
    smoke: false,
    quietBreaker: false,
    cooldownSeconds: 300,
    tail: 30,
    intervalSeconds: 60,
    amountSats: 3000,
    autoSafeActions: true,
    dryRun: true,
  };

  for (const arg of argv) {
    if (arg === '--smoke') parsed.smoke = true;
    if (arg === '--quiet-breaker') parsed.quietBreaker = true;
    if (arg === '--live-loop') parsed.dryRun = false;
    if (!arg.startsWith('--') || arg === '--smoke' || arg === '--quiet-breaker' || arg === '--live-loop') {
      continue;
    }
    const [key, ...rest] = arg.slice(2).split('=');
    const value = rest.join('=');
    if (key === 'cooldown-seconds') parsed.cooldownSeconds = Number(value || 300);
    if (key === 'tail') parsed.tail = Number(value || 30);
    if (key === 'interval-seconds') parsed.intervalSeconds = Number(value || 60);
    if (key === 'amount-sats') parsed.amountSats = Number(value || 3000);
    if (key === 'auto-safe-actions') parsed.autoSafeActions = parseBoolean(value, true);
    if (key === 'dry-run') parsed.dryRun = parseBoolean(value, true);
  }

  if (parsed.smoke) {
    parsed.dryRun = true;
  }

  return parsed;
}

function prefixStream(stream, prefix) {
  let buffer = '';
  stream.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line) continue;
      console.log(`[${prefix}] ${line}`);
    }
  });
  stream.on('end', () => {
    if (buffer.trim()) {
      console.log(`[${prefix}] ${buffer.trim()}`);
    }
  });
}

function spawnManaged(name, scriptPath, args) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    windowsHide: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  prefixStream(child.stdout, name);
  prefixStream(child.stderr, `${name}:ERR`);
  return child;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const children = new Set();
  let shuttingDown = false;

  const shutdown = (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      try {
        child.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
      } catch {
        // no-op
      }
    }
    setTimeout(() => process.exit(exitCode), 250).unref?.();
  };

  process.on('SIGINT', () => shutdown('SIGINT', 130));
  process.on('SIGTERM', () => shutdown('SIGTERM', 143));

  const monitorArgs = [
    `--cooldown-seconds=${options.cooldownSeconds}`,
    `--tail=${options.tail}`,
  ];
  if (options.quietBreaker) {
    monitorArgs.push('--quiet-breaker');
  }
  if (options.smoke) {
    monitorArgs.push('--once');
  }

  const loopArgs = [
    `--interval-seconds=${options.intervalSeconds}`,
    `--amount-sats=${options.amountSats}`,
    `--auto-safe-actions=${String(options.autoSafeActions).toLowerCase()}`,
  ];
  if (options.smoke) {
    loopArgs.push('--once');
  }
  if (options.dryRun) {
    loopArgs.push('--dry-run');
  }

  console.log(JSON.stringify({
    ok: true,
    launcher: 'run-standard-routine',
    mode: options.smoke ? 'smoke' : 'standard',
    dryRun: options.dryRun,
    quietBreaker: options.quietBreaker,
    mainRoutine: 'agent-standard-loop.cjs',
    monitor: 'agent-monitor.cjs',
    mainRoutineArgs: loopArgs,
    monitorArgs,
  }, null, 2));

  const monitor = spawnManaged('MONITOR', MONITOR_SCRIPT, monitorArgs);
  const loop = spawnManaged('LOOP', LOOP_SCRIPT, loopArgs);
  children.add(monitor);
  children.add(loop);

  monitor.on('close', code => {
    children.delete(monitor);
    if (!options.smoke && !shuttingDown && code && code !== 0) {
      console.log(`[ROUTINE] monitor terminou com codigo ${code}, rotina principal continua`);
    }
  });

  loop.on('close', code => {
    children.delete(loop);
    if (!shuttingDown) {
      if (monitor.exitCode === null) {
        try {
          monitor.kill('SIGTERM');
        } catch {
          // no-op
        }
      }
      process.exit(code ?? 1);
    }
  });
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
