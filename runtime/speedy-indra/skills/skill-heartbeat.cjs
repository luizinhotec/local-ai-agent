const { loadAgentConfig } = require('../lib/agent-config.cjs');
const { appendJsonLog } = require('../lib/agent-logger.cjs');
const {
  readAgentState,
  updateAgentState,
  writeAgentStatus,
  writeWatchdog,
} = require('../lib/agent-state.cjs');
const {
  sleep,
  ensureHelper,
  runHeartbeatCli,
  loadActiveOpsSummary,
  sanitizeHeartbeatResult,
} = require('../lib/agent-runtime.cjs');

function buildHeartbeatArgs({ dryRun = false, statusOnly = false, force = false } = {}) {
  const args = [];
  if (statusOnly) {
    args.push('--status-only');
  }
  if (dryRun) {
    args.push('--dry-run');
  }
  if (force) {
    args.push('--force');
  }
  return args;
}

function isHeartbeatDue(state, config, force) {
  if (force) {
    return { due: true, reason: 'forced' };
  }
  const lastAttemptMs = state.lastHeartbeatAt ? new Date(state.lastHeartbeatAt).getTime() : 0;
  if (!lastAttemptMs) {
    return { due: true, reason: 'never_ran' };
  }
  const minIntervalMs = config.heartbeat.intervalSec * 1000;
  const ageMs = Date.now() - lastAttemptMs;
  if (ageMs >= minIntervalMs) {
    return { due: true, reason: 'interval_elapsed' };
  }
  return {
    due: false,
    reason: 'cooldown_active',
    waitMs: Math.max(0, minIntervalMs - ageMs),
  };
}

function isCircuitOpen(state) {
  if (!state.heartbeatCircuitOpenUntil) {
    return false;
  }
  return Date.now() < new Date(state.heartbeatCircuitOpenUntil).getTime();
}

function computeBackoffMs(attemptNumber, config) {
  const raw = config.heartbeat.retryBaseDelayMs * (2 ** Math.max(0, attemptNumber - 1));
  return Math.min(raw, config.heartbeat.retryMaxDelayMs);
}

function isSuccessfulHeartbeat(result) {
  return Boolean(result?.parsed?.ok && result?.parsed?.postResult?.status === 200);
}

function isNotReadySkip(result) {
  return Boolean(result?.parsed?.skipped && result?.parsed?.reason === 'heartbeat_not_ready');
}

function isSuccessfulDryRun(result) {
  return Boolean(result?.ok && result?.parsed?.ok);
}

function buildStatusSnapshot(state, extra = {}) {
  return {
    checkedAt: new Date().toISOString(),
    heartbeat: {
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastHeartbeatSuccessAt: state.lastHeartbeatSuccessAt,
      consecutiveHeartbeatFailures: state.consecutiveHeartbeatFailures,
      heartbeatAttempts: state.heartbeatAttempts,
      heartbeatSuccesses: state.heartbeatSuccesses,
      heartbeatRetries: state.heartbeatRetries,
      heartbeatCircuitOpenUntil: state.heartbeatCircuitOpenUntil,
      skill: state.skills.heartbeat,
    },
    ...extra,
  };
}

async function runHeartbeatSkill(options = {}) {
  const config = loadAgentConfig();
  const state = readAgentState();
  const dryRun = options.dryRun ?? config.safety.dryRunDefault;
  const statusOnly = Boolean(options.statusOnly);
  const force = Boolean(options.force);

  if (!config.featureFlags.heartbeat) {
    const outcome = {
      ok: false,
      skipped: true,
      reason: 'feature_flag_disabled',
      skill: 'heartbeat',
    };
    appendJsonLog('heartbeat_skipped', outcome);
    return outcome;
  }

  if (!statusOnly && isCircuitOpen(state) && !force) {
    const outcome = {
      ok: false,
      skipped: true,
      reason: 'circuit_open',
      circuitOpenUntil: state.heartbeatCircuitOpenUntil,
    };
    appendJsonLog('heartbeat_skipped', outcome);
    writeAgentStatus(buildStatusSnapshot(state, { lastHeartbeatRun: outcome }));
    return outcome;
  }

  if (!statusOnly) {
    const due = isHeartbeatDue(state, config, force);
    if (!due.due) {
      const outcome = {
        ok: false,
        skipped: true,
        reason: due.reason,
        waitMs: due.waitMs,
      };
      appendJsonLog('heartbeat_skipped', outcome);
      updateAgentState(current => {
        current.skills.heartbeat.lastSkipReason = outcome.reason;
        current.skills.heartbeat.lastOutcome = 'skipped';
        return current;
      });
      writeAgentStatus(buildStatusSnapshot(readAgentState(), { lastHeartbeatRun: outcome }));
      return outcome;
    }
  }

  const helperResult = ensureHelper(config);
  appendJsonLog('helper_ensure', {
    skill: 'heartbeat',
    ok: helperResult.ok,
    status: helperResult.status ?? null,
    skipped: helperResult.skipped ?? false,
  });

  updateAgentState(current => {
    current.lastHeartbeatAt = new Date().toISOString();
    current.heartbeatAttempts += statusOnly ? 0 : 1;
    current.skills.heartbeat.lastRunAt = current.lastHeartbeatAt;
    current.skills.heartbeat.lastAttemptMode = statusOnly ? 'status-only' : (dryRun ? 'dry-run' : 'live');
    current.skills.heartbeat.lastSkipReason = null;
    current.lastCycleAt = new Date().toISOString();
    current.loop.lastProgressAt = new Date().toISOString();
    return current;
  });

  const maxAttempts = statusOnly ? 1 : Math.max(1, config.heartbeat.retryMaxAttempts);
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    writeWatchdog({
      skill: 'heartbeat',
      status: 'running',
      attempt,
      maxAttempts,
      updatedAt: new Date().toISOString(),
      staleAfterSec: config.heartbeat.watchdogStaleSec,
    });

    const result = runHeartbeatCli(buildHeartbeatArgs({ dryRun, statusOnly, force }));
    lastResult = result;
    const sanitizedResult = sanitizeHeartbeatResult(result);
    const parsed = sanitizedResult.parsed || {};

    appendJsonLog('heartbeat_attempt', {
      skill: 'heartbeat',
      attempt,
      maxAttempts,
      dryRun,
      statusOnly,
      processStatus: sanitizedResult.status,
      ok: sanitizedResult.ok,
      parsed,
    });

    if (
      (statusOnly && sanitizedResult.ok) ||
      (dryRun && isSuccessfulDryRun(result)) ||
      isSuccessfulHeartbeat(result) ||
      isNotReadySkip(result)
    ) {
      break;
    }

    if (attempt < maxAttempts) {
      const delayMs = computeBackoffMs(attempt, config);
      updateAgentState(current => {
        current.heartbeatRetries += 1;
        return current;
      });
      appendJsonLog('heartbeat_retry_scheduled', {
        skill: 'heartbeat',
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  const activeOpsSummary = loadActiveOpsSummary();
  const nextState = updateAgentState(current => {
    const nowIso = new Date().toISOString();
    current.lastCycleAt = nowIso;
    current.loop.lastProgressAt = nowIso;
    current.loop.lastCompletedAt = nowIso;
    current.lastCycleStatus = 'completed';
    current.lastCycleError = null;

    if (statusOnly) {
      current.skills.heartbeat.lastOutcome = lastResult?.ok ? 'status_only' : 'failed';
      return current;
    }

    if (dryRun) {
      if (isSuccessfulDryRun(lastResult)) {
        current.skills.heartbeat.lastOutcome = 'dry_run';
        current.skills.heartbeat.lastStatusCode = lastResult?.parsed?.statusResult?.status ?? null;
        current.consecutiveHeartbeatFailures = 0;
        current.heartbeatCircuitOpenUntil = null;
      } else {
        current.consecutiveHeartbeatFailures += 1;
        current.skills.heartbeat.errorCount += 1;
        current.skills.heartbeat.lastFailureAt = nowIso;
        current.skills.heartbeat.lastOutcome = 'failed';
      }
      return current;
    }

    if (isSuccessfulHeartbeat(lastResult)) {
      current.lastHeartbeatSuccessAt =
        lastResult.parsed.timestampIso ||
        lastResult.parsed.statusResult?.body?.orientation?.lastActiveAt ||
        nowIso;
      current.consecutiveHeartbeatFailures = 0;
      current.heartbeatSuccesses += 1;
      current.heartbeatCircuitOpenUntil = null;
      current.skills.heartbeat.lastSuccessAt = current.lastHeartbeatSuccessAt;
      current.skills.heartbeat.lastOutcome = 'success';
      current.skills.heartbeat.lastStatusCode = 200;
    } else {
      current.consecutiveHeartbeatFailures += 1;
      current.skills.heartbeat.errorCount += 1;
      current.skills.heartbeat.lastFailureAt = nowIso;
      current.skills.heartbeat.lastOutcome = isNotReadySkip(lastResult) ? 'skipped' : 'failed';
      current.skills.heartbeat.lastStatusCode =
        lastResult?.parsed?.postResult?.status ||
        lastResult?.parsed?.statusResult?.status ||
        lastResult?.status ||
        null;
      if (current.consecutiveHeartbeatFailures >= config.heartbeat.circuitBreakerFailures) {
        current.heartbeatCircuitOpenUntil = new Date(
          Date.now() + config.heartbeat.circuitBreakerCooldownSec * 1000
        ).toISOString();
      }
    }

    return current;
  });

  const outcome = {
    ok:
      (statusOnly && Boolean(lastResult?.ok)) ||
      (dryRun && isSuccessfulDryRun(lastResult)) ||
      isSuccessfulHeartbeat(lastResult) ||
      isNotReadySkip(lastResult),
    dryRun,
    statusOnly,
    forced: force,
    result: sanitizeHeartbeatResult(lastResult),
    activeOpsSummary: activeOpsSummary
      ? {
          updatedAtUtc: activeOpsSummary.updatedAtUtc,
          latestHeartbeatSuccess: activeOpsSummary.latestHeartbeatSuccess,
          heartbeatDiagnostics: activeOpsSummary.heartbeatDiagnostics,
        }
      : null,
    state: buildStatusSnapshot(nextState),
  };

  writeWatchdog({
    skill: 'heartbeat',
    status: outcome.ok ? 'ok' : 'failed',
    updatedAt: new Date().toISOString(),
    staleAfterSec: config.heartbeat.watchdogStaleSec,
  });
  writeAgentStatus(buildStatusSnapshot(nextState, { lastHeartbeatRun: outcome }));

  appendJsonLog(outcome.ok ? 'heartbeat_skill_completed' : 'heartbeat_skill_failed', {
    skill: 'heartbeat',
    dryRun,
    statusOnly,
    forced: force,
    ok: outcome.ok,
    consecutiveHeartbeatFailures: nextState.consecutiveHeartbeatFailures,
    circuitOpenUntil: nextState.heartbeatCircuitOpenUntil,
  });

  return outcome;
}

module.exports = {
  runHeartbeatSkill,
};
