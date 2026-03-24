#!/usr/bin/env node

const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { acquireLock } = require('./lib/agent-lock.cjs');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const {
  readAgentState,
  updateAgentState,
  writeAgentStatus,
  writeWatchdog,
} = require('./lib/agent-state.cjs');
const { sleep } = require('./lib/agent-runtime.cjs');
const { runHeartbeatSkill } = require('./skills/skill-heartbeat.cjs');
const { runMessagingSkill } = require('./skill-messaging.cjs');
const { runIdentitySkill } = require('./skill-identity.cjs');
const { runWalletActionsSkill } = require('./skill-wallet-actions.cjs');
const { runDefiSimpleSkill } = require('./skill-defi-simple.cjs');

function parseArgs(argv) {
  const parsed = {
    once: argv.includes('--once'),
    force: argv.includes('--force'),
  };
  if (argv.includes('--dry-run')) {
    parsed.dryRun = true;
  }
  if (argv.includes('--live')) {
    parsed.dryRun = false;
  }
  return parsed;
}

async function runOneCycle(options, config) {
  const cycleStartedAt = new Date().toISOString();
  const before = updateAgentState(current => {
    current.loop.iteration += 1;
    current.loop.startedAt = current.loop.startedAt || cycleStartedAt;
    current.loop.lastProgressAt = cycleStartedAt;
    current.lastCycleAt = cycleStartedAt;
    current.lastCycleStatus = 'running';
    current.lastCycleError = null;
    return current;
  });

  writeWatchdog({
    status: 'running',
    updatedAt: cycleStartedAt,
    iteration: before.loop.iteration,
    staleAfterSec: config.heartbeat.watchdogStaleSec,
  });

  appendJsonLog('agent_cycle_started', {
    iteration: before.loop.iteration,
    once: options.once,
    dryRun: options.dryRun,
    force: options.force,
  });

  try {
    const heartbeatResult = await runHeartbeatSkill({
      dryRun: options.dryRun,
      force: options.force,
    });
    const messagingResult = config.featureFlags.messaging
      ? await runMessagingSkill({
          dryRun: options.dryRun,
          force: options.force,
          replyPending: config.messaging.autoReplyEnabled,
        })
      : {
          ok: true,
          skipped: true,
          reason: 'feature_disabled',
          state: readAgentState(),
        };
    const identityResult = config.featureFlags.identity
      ? await runIdentitySkill({
          dryRun: options.dryRun,
        })
      : {
          ok: true,
          skipped: true,
          reason: 'feature_disabled',
          state: readAgentState(),
        };
    const walletResult = config.featureFlags.walletActions && config.walletActions.autoCheckEnabled
      ? await runWalletActionsSkill({
          dryRun: options.dryRun,
        })
      : {
          ok: true,
          skipped: true,
          reason: 'feature_disabled',
          state: readAgentState(),
        };
    const defiResult = config.featureFlags.defiSimple && config.defiSimple.autoCheckEnabled
      ? await runDefiSimpleSkill({
          dryRun: options.dryRun,
        })
      : {
          ok: true,
          skipped: true,
          reason: 'feature_disabled',
          state: readAgentState(),
        };
    const heartbeatOk = heartbeatResult.ok || heartbeatResult.skipped;
    const messagingOk = messagingResult.ok || messagingResult.skipped;
    const identityOk = identityResult.ok || identityResult.skipped;
    const walletOk = walletResult.ok || walletResult.skipped;
    const defiOk = defiResult.ok || defiResult.skipped;
    const cycleOk = heartbeatOk && messagingOk && identityOk && walletOk && defiOk;
    const cycleStatus =
      heartbeatResult.skipped && messagingResult.skipped && identityResult.skipped && walletResult.skipped && defiResult.skipped
        ? 'skipped'
        : cycleOk
        ? 'completed'
        : 'failed';

    const after = updateAgentState(current => {
      current.lastCycleStatus = cycleStatus;
      current.lastCycleError = cycleOk
        ? null
        : messagingResult.error ||
          defiResult.error ||
          walletResult.error ||
          identityResult.error ||
          heartbeatResult.result?.parsed?.error ||
          'agent_cycle_failed';
      current.loop.lastCompletedAt = new Date().toISOString();
      current.loop.lastProgressAt = current.loop.lastCompletedAt;
      return current;
    });

    writeAgentStatus({
      checkedAt: new Date().toISOString(),
      loop: {
        iteration: after.loop.iteration,
        lastCycleStatus: after.lastCycleStatus,
      },
      heartbeat: heartbeatResult.state?.heartbeat || null,
      messaging: messagingResult.state?.skills?.messaging || null,
      identity: identityResult.state?.skills?.identity || null,
      wallet: walletResult.state?.skills?.walletActions || null,
      defi: defiResult.state?.skills?.defiSimple || null,
    });
    writeWatchdog({
      status: cycleStatus,
      updatedAt: new Date().toISOString(),
      iteration: after.loop.iteration,
      staleAfterSec: config.heartbeat.watchdogStaleSec,
    });
    appendJsonLog(cycleOk ? 'agent_cycle_completed' : 'agent_cycle_failed', {
      iteration: after.loop.iteration,
      ok: cycleOk,
      skipped: Boolean(heartbeatResult.skipped),
      resultSummary: {
        dryRun: heartbeatResult.dryRun,
        statusOnly: heartbeatResult.statusOnly,
        reason: heartbeatResult.reason || null,
        messagingReason: messagingResult.reason || null,
        identityReason: identityResult.reason || null,
        walletReason: walletResult.reason || null,
        defiReason: defiResult.reason || null,
      },
    });
    return {
      ok: cycleOk,
      heartbeat: heartbeatResult,
      messaging: messagingResult,
      identity: identityResult,
      wallet: walletResult,
      defi: defiResult,
    };
  } catch (error) {
    const failed = updateAgentState(current => {
      current.lastCycleStatus = 'failed';
      current.lastCycleError = error.message;
      current.loop.lastCompletedAt = new Date().toISOString();
      current.loop.lastProgressAt = current.loop.lastCompletedAt;
      return current;
    });
    writeWatchdog({
      status: 'failed',
      updatedAt: new Date().toISOString(),
      iteration: failed.loop.iteration,
      error: error.message,
      staleAfterSec: config.heartbeat.watchdogStaleSec,
    });
    appendJsonLog('agent_cycle_failed', {
      iteration: failed.loop.iteration,
      error: error.message,
    });
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = loadAgentConfig();
  const lock = acquireLock({
    staleAfterMs: config.heartbeat.watchdogStaleSec * 1000,
    processName: 'speedy-indra-loop',
  });

  appendJsonLog('agent_loop_started', {
    once: options.once,
    dryRun: options.dryRun,
    force: options.force,
    lockId: lock.metadata.lockId,
  });

  const releaseLock = () => {
    try {
      lock.release();
    } catch {
      // no-op during shutdown
    }
  };

  process.on('SIGINT', () => {
    appendJsonLog('agent_loop_stopped', { signal: 'SIGINT' });
    releaseLock();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    appendJsonLog('agent_loop_stopped', { signal: 'SIGTERM' });
    releaseLock();
    process.exit(0);
  });

  try {
    do {
      const cycleResult = await runOneCycle(options, config);
      lock.refresh();
      updateAgentState(current => {
        current.loop.lastLockRefreshAt = new Date().toISOString();
        return current;
      });
      if (options.once) {
        console.log(JSON.stringify(cycleResult, null, 2));
      }
      if (options.once) {
        break;
      }
      await sleep(config.heartbeat.loopSleepSec * 1000);
    } while (true);
  } finally {
    appendJsonLog('agent_loop_exited', {
      once: options.once,
      finalState: readAgentState().lastCycleStatus,
    });
    releaseLock();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
