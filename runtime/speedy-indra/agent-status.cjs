#!/usr/bin/env node

const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { readAgentState, readAgentStatus, readWatchdog } = require('./lib/agent-state.cjs');
const { readLock } = require('./lib/agent-lock.cjs');
const { readTail } = require('./lib/agent-logger.cjs');
const { loadActiveOpsSummary } = require('./lib/agent-runtime.cjs');

function main() {
  const config = loadAgentConfig();
  const state = readAgentState();
  const status = readAgentStatus();
  const watchdog = readWatchdog();
  const lock = readLock();
  const activeOpsSummary = loadActiveOpsSummary();
  const watchdogUpdatedAtMs = watchdog?.updatedAt ? new Date(watchdog.updatedAt).getTime() : 0;
  const watchdogStale =
    watchdogUpdatedAtMs > 0 &&
    Date.now() - watchdogUpdatedAtMs > config.heartbeat.watchdogStaleSec * 1000;

  const payload = {
    checkedAt: new Date().toISOString(),
    featureFlags: config.featureFlags,
    state,
    status,
    watchdog: {
      ...watchdog,
      stale: watchdogStale,
    },
    lock,
    activeOpsSummary: activeOpsSummary
      ? {
          updatedAtUtc: activeOpsSummary.updatedAtUtc,
          latestHeartbeatSuccess: activeOpsSummary.latestHeartbeatSuccess,
          heartbeatDiagnostics: activeOpsSummary.heartbeatDiagnostics,
        }
      : null,
    recentLogs: readTail(10),
  };

  console.log(JSON.stringify(payload, null, 2));
}

main();
