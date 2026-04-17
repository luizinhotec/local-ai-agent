'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadOrionConfig, ROOT } = require('./orion-config.cjs');

// ── helpers ──────────────────────────────────────────────────────────────────

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function readLastLines(filePath, n) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split(/\r?\n/);
    return lines.slice(-n);
  } catch (_) {
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
  } catch (_) {
    return null;
  }
}

function mtimeOf(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch (_) {
    return null;
  }
}

// ── Speedy-Indra ─────────────────────────────────────────────────────────────

function readSpeedyIndraState() {
  try {
    const scriptPath = path.join(ROOT, 'runtime', 'speedy-indra', 'agent-status.cjs');
    if (!fs.existsSync(scriptPath)) {
      return { bot: 'speedy-indra', error: 'agent-status.cjs not found' };
    }

    const stdout = execSync(
      `node "${scriptPath}"`,
      { cwd: ROOT, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const payload = JSON.parse(stdout.trim());

    // Flatten the fields most relevant for health assessment
    const ops = payload.operationalSummary || {};
    const loop = ops.loop || {};
    const watchdog = payload.watchdog || {};

    return {
      bot: 'speedy-indra',
      checkedAt: payload.checkedAt || null,
      loopRunning: ops.loopRunning || false,
      watchdogStale: ops.watchdogStale || false,
      watchdogUpdatedAt: watchdog.updatedAt || null,
      lastCycleAt: payload.state?.lastCycleAt || null,
      lastCycleStatus: payload.state?.lastCycleStatus || null,
      lastHeartbeatAt: payload.state?.lastHeartbeatAt || null,
      lastHeartbeatSuccessAt: payload.state?.lastHeartbeatSuccessAt || null,
      consecutiveHeartbeatFailures: payload.state?.consecutiveHeartbeatFailures || 0,
      loopCycles: loop.cycles || 0,
      loopLastAction: loop.lastAction || null,
      supervisorLine: ops.supervisorLine || null,
      nextAction: ops.nextAction?.recommendedAction || null,
    };
  } catch (err) {
    return { bot: 'speedy-indra', error: err.message };
  }
}

// ── Deribit ───────────────────────────────────────────────────────────────────

function readDeribitState() {
  try {
    const cfg = loadOrionConfig();
    const dir = path.join(ROOT, cfg.paths.deribitState);

    const botState = readJsonSafe(path.join(dir, 'deribit-bot-state.json'));
    const metrics  = readJsonSafe(path.join(dir, 'deribit-bot-metrics.json'));
    const latest   = readJsonSafe(path.join(dir, 'deribit-latest.json'));

    if (!botState && !metrics) {
      return { bot: 'deribit', error: 'state files not found' };
    }

    return {
      bot: 'deribit',
      lastCycleAt: botState?.lastCycleAt || null,
      lastCycleStatus: botState?.lastCycleStatus || null,
      lastCycleError: botState?.lastCycleError || null,
      lastAction: botState?.lastAction || null,
      cycleCount: botState?.cycleCount || metrics?.cycleCount || 0,
      environment: latest?.environment || 'unknown',
      positionSizeUsd: latest?.positionSizeUsd ?? null,
      positionDirection: latest?.positionDirection || 'unknown',
      positionFloatingPnl: latest?.positionFloatingPnl ?? null,
      openOrderCount: latest?.openOrderCount ?? null,
      accountEquity: latest?.accountEquity ?? null,
      metricsStartedAt: metrics?.startedAt || null,
      metricsUpdatedAt: metrics?.updatedAt || null,
      entryExecutions: metrics?.entryExecutions ?? 0,
      exitExecutions: metrics?.exitExecutions ?? 0,
      cumulativeRealizedPnlBtc: metrics?.cumulativeRealizedPnlBtc ?? 0,
    };
  } catch (err) {
    return { bot: 'deribit', error: err.message };
  }
}

// ── DOG-MM ────────────────────────────────────────────────────────────────────

function readDogMmState() {
  try {
    const cfg = loadOrionConfig();
    const dir     = path.join(ROOT, cfg.paths.dogmmState);
    const logsDir = path.join(ROOT, cfg.paths.logsDir);
    const lpRepositionPath = path.join(dir, 'bitflow-last-lp-reposition.json');

    // Primary state file — try hodlmm first (future), fall back to setup-status
    const hodlmmPath  = path.join(dir, 'dog-mm-hodlmm-status.json');
    const setupPath   = path.join(dir, 'dog-mm-setup-status.json');
    const setupStatus = readJsonSafe(hodlmmPath) || readJsonSafe(setupPath);
    const lpReposition = readJsonSafe(lpRepositionPath);

    // Latest market-snapshot or auto-dryrun file
    const latestActivityFile = findLatestFile(
      dir,
      /^(market-snapshot|auto-dryrun)-[\dTZ-]+\.json$/
    );
    const latestActivity = latestActivityFile ? readJsonSafe(latestActivityFile) : null;
    const lastActivityAt = latestActivityFile ? mtimeOf(latestActivityFile) : null;

    // Last 20 lines of monitor log
    const logLines = readLastLines(path.join(logsDir, 'dog-mm-monitor.log'), 20);

    if (!setupStatus) {
      return {
        bot: 'dog-mm',
        error: 'setup-status file not found',
        lastLogLines: logLines,
      };
    }

    const lpStatus = lpReposition?.status || null;
    const dlpBalanceRaw = lpReposition?.dlpBalance ?? null;
    const dlpBalance = dlpBalanceRaw !== null ? Number(dlpBalanceRaw) : null;
    const lpHealthy = lpStatus === 'in_range' || lpStatus === 'dry_run';
    const lpHasPosition = Number.isFinite(dlpBalance) ? dlpBalance > 0 : false;
    const lpGeneratedAt = lpReposition?.generatedAtUtc || null;

    return {
      bot: 'dog-mm',
      stage: setupStatus.stage || 'unknown',
      funded: setupStatus.wallet?.funded || false,
      stxAddress: setupStatus.wallet?.stxAddress || null,
      btcAddress: setupStatus.wallet?.btcAddress || null,
      lastActivityAt,
      lastActivityFile: latestActivityFile ? path.basename(latestActivityFile) : null,
      marketFavorable: latestActivity?.favorable ?? null,
      marketReason: latestActivity?.reason || null,
      firstCycleExecuted: setupStatus.phase0?.firstCycleExecuted || false,
      selectedPool: setupStatus.phase0?.selectedPool || null,
      lpStatus,
      lpDlpBalance: dlpBalanceRaw,
      lpHasPosition,
      lpHealthy,
      lpGeneratedAt,
      lastLogLines: logLines,
    };
  } catch (err) {
    return { bot: 'dog-mm', error: err.message };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function readAllBotStates() {
  return {
    speedyIndra: readSpeedyIndraState(),
    deribit: readDeribitState(),
    dogMm: readDogMmState(),
    readAt: new Date().toISOString(),
  };
}

module.exports = { readAllBotStates, readSpeedyIndraState, readDeribitState, readDogMmState };
