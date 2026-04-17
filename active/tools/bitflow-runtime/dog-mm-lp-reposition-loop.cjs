#!/usr/bin/env node
'use strict';

// Monitoring loop: checks the LP position every 30 minutes.
// If the position is out of range (status=dry_run), it triggers a
// reposition with --broadcast.
//
// Logs: active/state/dog-mm/lp-reposition-loop.log
// PID:  active/state/dog-mm/lp-reposition.pid

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const processExecPath = process.execPath;
const { loadRuntimeEnv } = require('./runtime-env.cjs');

const STATE_DIR = path.resolve(__dirname, '..', '..', 'state', 'dog-mm');
const LOG_FILE = path.resolve(STATE_DIR, 'lp-reposition-loop.log');
const PID_FILE = path.resolve(STATE_DIR, 'lp-reposition.pid');
const TELEGRAM_STATE_FILE = path.resolve(STATE_DIR, 'lp-reposition-telegram-state.json');
const REPOSITION_SCRIPT = path.resolve(__dirname, 'dog-mm-bitflow-lp-reposition.cjs');
const LIVE_PNL_SCRIPT = path.resolve(__dirname, 'dog-mm-lp-live-pnl.cjs');
const INTERVAL_MS = 30 * 60 * 1000;

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const HEARTBEAT_MINUTES = envNumber('DOG_MM_TELEGRAM_HEARTBEAT_MINUTES', 120);
const ERROR_COOLDOWN_MS = envNumber('DOG_MM_TELEGRAM_ERROR_COOLDOWN_MINUTES', 30) * 60 * 1000;
const PROFIT_TARGET_USD = envNumber('DOG_MM_TELEGRAM_PROFIT_TARGET_USD', 0.5);

function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  } catch (_) {}
}

function loadTelegramState() {
  return readJson(TELEGRAM_STATE_FILE, {
    lastHeartbeatSentAt: null,
    lastErrorKey: null,
    lastErrorSentAt: null,
    lastPnlZone: null,
  });
}

function saveTelegramState(state) {
  writeJson(TELEGRAM_STATE_FILE, state);
}

function checkStaleOrConflict() {
  if (!fs.existsSync(PID_FILE)) return;
  const existing = fs.readFileSync(PID_FILE, 'utf8').trim();
  try {
    process.kill(Number(existing), 0);
    console.error(`Another instance is already running (PID ${existing}). Exiting.`);
    process.exit(1);
  } catch (_) {
    logLine(`Stale PID (${existing}) found. Overwriting.`);
  }
}

function writePid() {
  fs.writeFileSync(PID_FILE, String(process.pid));
}

function removePid() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch (_) {}
}

function getTelegramConfig() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  };
}

async function sendTelegram(text) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) return { skipped: true, reason: 'missing_credentials' };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`telegram_http_${response.status}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function notifyHeartbeat(force = false) {
  if (HEARTBEAT_MINUTES <= 0 && !force) return;

  const state = loadTelegramState();
  const now = Date.now();
  const lastAt = state.lastHeartbeatSentAt ? Date.parse(state.lastHeartbeatSentAt) : NaN;
  const due =
    force ||
    !Number.isFinite(lastAt) ||
    (now - lastAt) >= HEARTBEAT_MINUTES * 60 * 1000;

  if (!due) return;

  try {
    await sendTelegram(
      `DOG MM LP heartbeat\nstatus=online\npid=${process.pid}\ninterval_minutes=${Math.round(INTERVAL_MS / 60000)}`
    );
    state.lastHeartbeatSentAt = new Date(now).toISOString();
    saveTelegramState(state);
  } catch (error) {
    logLine(`Telegram heartbeat error: ${error.message}`);
  }
}

async function notifyError(errorKey, message) {
  const state = loadTelegramState();
  const now = Date.now();
  const lastAt = state.lastErrorSentAt ? Date.parse(state.lastErrorSentAt) : NaN;
  const inCooldown =
    state.lastErrorKey === errorKey &&
    Number.isFinite(lastAt) &&
    (now - lastAt) < ERROR_COOLDOWN_MS;

  if (inCooldown) return;

  try {
    await sendTelegram(`DOG MM LP ALERT\n${message}`);
    state.lastErrorKey = errorKey;
    state.lastErrorSentAt = new Date(now).toISOString();
    saveTelegramState(state);
  } catch (error) {
    logLine(`Telegram error alert failed: ${error.message}`);
  }
}

async function notifyRepositioned(result) {
  try {
    await sendTelegram(
      `DOG MM LP repositioned\nstatus=repositioned\nactive_bin_start=${result.activeBinAtStart ?? 'n/a'}\nactive_bin_readd=${result.activeBinAtReAdd ?? 'n/a'}\nentry_bin=${result.entryBin ?? 'n/a'}\nremove_txid=${result.remove?.txid ?? 'n/a'}\nadd_txid=${result.add?.txid ?? 'n/a'}`
    );
  } catch (error) {
    logLine(`Telegram reposition alert failed: ${error.message}`);
  }
}

function getPnlZone(netUsd) {
  if (!Number.isFinite(netUsd)) return null;
  if (netUsd >= PROFIT_TARGET_USD) return 'profit';
  if (netUsd >= 0) return 'breakeven';
  return 'underwater';
}

async function notifyPnlZoneChange(pnlSummary) {
  const netUsd = Number(pnlSummary?.pnl?.netUsd);
  const grossUsd = Number(pnlSummary?.pnl?.grossUsd);
  const liveValueUsd = Number(pnlSummary?.live?.totalValueUsd);
  const costUsd = Number(pnlSummary?.costBasis?.totalUsd);
  const earnedUsd = Number(pnlSummary?.live?.earnedUsd);
  const zone = getPnlZone(netUsd);
  if (!zone) return;

  const state = loadTelegramState();
  if (state.lastPnlZone === zone) return;

  let title = null;
  if (zone === 'breakeven') title = 'DOG MM LP break-even';
  if (zone === 'profit') title = 'DOG MM LP em lucro';

  if (!title) {
    state.lastPnlZone = zone;
    saveTelegramState(state);
    return;
  }

  try {
    await sendTelegram(
      `${title}\nnet_usd=${netUsd.toFixed(2)}\ngross_usd=${grossUsd.toFixed(2)}\nvalue_usd=${liveValueUsd.toFixed(2)}\ncost_usd=${costUsd.toFixed(2)}\nearned_usd=${earnedUsd.toFixed(2)}`
    );
    state.lastPnlZone = zone;
    saveTelegramState(state);
  } catch (error) {
    logLine(`Telegram PnL alert failed: ${error.message}`);
  }
}

function runReposition(extraArgs = []) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(processExecPath, [REPOSITION_SCRIPT, '--json-only', ...extraArgs], {
      env: process.env,
      windowsHide: true,
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRepositionWithRetry(extraArgs = [], maxRetries = 3, retryDelayMs = 15000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await runReposition(extraArgs);
    if (result.code === 0) return result;
    if (attempt < maxRetries) {
      logLine(`Attempt ${attempt}/${maxRetries} failed (code=${result.code}). Retrying in ${retryDelayMs / 1000}s...`);
      await delay(retryDelayMs);
    } else {
      return result;
    }
  }
}

function runLivePnl() {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(processExecPath, [LIVE_PNL_SCRIPT], {
      env: process.env,
      windowsHide: true,
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function checkPnlAlerts() {
  const { code, stdout, stderr } = await runLivePnl();
  if (code !== 0) {
    logLine(`PnL check failed: code=${code} stderr=${stderr.trim().slice(0, 200)}`);
    return;
  }

  let pnlSummary;
  try {
    pnlSummary = JSON.parse(stdout.trim());
  } catch (_) {
    logLine(`PnL check returned invalid JSON. stdout=${stdout.slice(0, 200)}`);
    return;
  }

  const netUsd = Number(pnlSummary?.pnl?.netUsd);
  const zone = getPnlZone(netUsd);
  if (zone) {
    logLine(`pnl_net_usd=${Number.isFinite(netUsd) ? netUsd.toFixed(2) : 'n/a'} | pnl_zone=${zone}`);
  }
  await notifyPnlZoneChange(pnlSummary);
}

async function check() {
  logLine('--- Checking LP position...');

  const { code, stdout, stderr } = await runRepositionWithRetry();

  if (code !== 0) {
    const message = `ERROR: script exited with code ${code} (after retries). stderr=${stderr.trim().slice(0, 300)}`;
    logLine(message);
    await notifyError(`check_exit_${code}_${stderr.trim().slice(0, 120)}`, message);
    return;
  }

  let result;
  try {
    result = JSON.parse(stdout.trim());
  } catch (_) {
    const message = `ERROR: invalid JSON on stdout. stdout=${stdout.slice(0, 200)}`;
    logLine(message);
    await notifyError('invalid_json_stdout', message);
    return;
  }

  const { status, activeBinId, activeBinAtStart, entryBin, dlpBalance, dlpRemoved } = result;
  const bin = activeBinId ?? activeBinAtStart ?? 'n/a';
  const dlp = dlpBalance ?? dlpRemoved ?? 'n/a';
  logLine(`status=${status} | activeBin=${bin} | entryBin=${entryBin ?? 'n/a'} | dlp=${dlp}`);

  if (status === 'no_position') {
    logLine('No active LP position. Nothing to do.');
    await checkPnlAlerts();
    await notifyHeartbeat();
    return;
  }

  if (status === 'in_range') {
    logLine('Position in range. Nothing to do.');
    await checkPnlAlerts();
    await notifyHeartbeat();
    return;
  }

  if (status === 'dry_run') {
    logLine('OUT-OF-RANGE detected. Repositioning with --broadcast...');

    const bcast = await runRepositionWithRetry(['--broadcast']);

    if (bcast.code !== 0) {
      const message = `ERROR on broadcast: code ${bcast.code} (after retries). stderr=${bcast.stderr.trim().slice(0, 300)}`;
      logLine(message);
      await notifyError(`broadcast_exit_${bcast.code}_${bcast.stderr.trim().slice(0, 120)}`, message);
      return;
    }

    let bcastResult;
    try {
      bcastResult = JSON.parse(bcast.stdout.trim());
    } catch (_) {
      const message = 'ERROR: invalid JSON on broadcast response.';
      logLine(message);
      await notifyError('invalid_json_broadcast', message);
      return;
    }

    if (bcastResult.status === 'repositioned') {
      logLine(`Reposition OK. remove=${bcastResult.remove?.txid} | add=${bcastResult.add?.txid}`);
      await notifyRepositioned(bcastResult);
      await checkPnlAlerts();
    } else {
      const message = `Unexpected status after broadcast: ${bcastResult.status}`;
      logLine(message);
      await notifyError(`unexpected_broadcast_status_${bcastResult.status}`, message);
    }
    return;
  }

  {
    const message = `Unexpected status: ${status}`;
    logLine(message);
    await notifyError(`unexpected_status_${status}`, message);
  }
}

process.on('SIGTERM', () => {
  logLine('SIGTERM received. Shutting down.');
  removePid();
  process.exit(0);
});

process.on('SIGINT', () => {
  logLine('SIGINT received. Shutting down.');
  removePid();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  logLine(`Uncaught error: ${error.message}`);
  await notifyError(`uncaught_${error.message}`, `Uncaught error in reposition loop: ${error.message}`);
});

loadRuntimeEnv();
fs.mkdirSync(STATE_DIR, { recursive: true });
checkStaleOrConflict();
writePid();

logLine(`DOG-MM LP Reposition Loop started (PID=${process.pid}). Interval=30min.`);
notifyHeartbeat(true).catch((error) => logLine(`Initial heartbeat error: ${error.message}`));

check().catch((error) => logLine(`Error on initial check: ${error.message}`));

setInterval(() => {
  check().catch((error) => logLine(`Error on check: ${error.message}`));
}, INTERVAL_MS);
