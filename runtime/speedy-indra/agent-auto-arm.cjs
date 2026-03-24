const { spawnSync } = require('child_process');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { sendTelegramAlert, buildTelegramMessage } = require('./lib/telegram-alert.cjs');
const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { readAgentState, updateAgentState } = require('./lib/agent-state.cjs');
const {
  evaluateGateFromPayload,
  createArmedState,
  buildRemoteExecutionCommand,
} = require('./lib/telegram-exec-guard.cjs');

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg === '--once') {
      flags.once = true;
      continue;
    }
    if (arg === '--simulate-ready') {
      flags.simulateReady = true;
      continue;
    }
    if (arg === '--mock-telegram') {
      flags.mockTelegram = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      flags[key] = rest.length > 0 ? rest.join('=') : true;
    }
  }
  return flags;
}

function simulateReadySnapshot(amountSats) {
  const execution = buildRemoteExecutionCommand({
    pair: 'sbtc-usdcx',
    amountSats,
  });
  return {
    status: execution.ok ? 'READY_TO_FIRE' : 'OBSERVING',
    pair: 'sbtc-usdcx',
    amountSats,
    decision: 'PASS',
    decisionReason: 'edge_above_threshold',
    estimatedFeeSats: 120,
    priceImpactBps: -18,
    championshipGateEligible: true,
    championshipGateBlockReason: null,
    liveAllowed: execution.ok ? 'YES' : 'NO',
    quoteFresh: true,
    blockers: [],
    manualCommand: execution.command || null,
    remoteExecutionAllowed: execution.ok,
    remoteExecutionBlockReason: execution.ok ? null : execution.reason,
  };
}

function runDryEvaluation(amountSats) {
  const run = spawnSync(process.execPath, [
    'runtime/speedy-indra/agent-next-action.cjs',
    '--dry-run',
    `--amount-sats=${amountSats}`,
    '--force',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 180000,
  });

  if (run.error) {
    throw run.error;
  }
  if (run.status !== 0) {
    throw new Error(run.stderr || run.stdout || `agent-next-action failed with status ${run.status}`);
  }
  return JSON.parse(run.stdout);
}

async function emitReadyAlert(snapshot, options = {}) {
  process.stdout.write('\u0007');
  const message = buildTelegramMessage(snapshot);
  console.log(message);
  const telegram = await sendTelegramAlert(snapshot, {
    mock: options.mockTelegram,
  });
  appendJsonLog('championship_ready_to_fire_alert', {
    ok: telegram.ok,
    mocked: Boolean(telegram.mocked),
    skipped: Boolean(telegram.skipped),
    status: snapshot.status,
    pair: snapshot.pair,
    amountSats: snapshot.amountSats,
    decision: snapshot.decision,
    decisionReason: snapshot.decisionReason,
    estimatedFeeSats: snapshot.estimatedFeeSats,
    priceImpactBps: snapshot.priceImpactBps,
    manualCommand: snapshot.manualCommand,
    telegramReason: telegram.reason || null,
  });
}

async function emitWatchlistAlert(snapshot, options = {}) {
  process.stdout.write('\u0007');
  const message = buildTelegramMessage(snapshot);
  console.log(message);
  const telegram = await sendTelegramAlert(snapshot, {
    mock: options.mockTelegram,
  });
  appendJsonLog('championship_watchlist_ready_alert', {
    ok: telegram.ok,
    mocked: Boolean(telegram.mocked),
    skipped: Boolean(telegram.skipped),
    status: snapshot.status,
    pair: snapshot.pair,
    amountSats: snapshot.amountSats,
    decision: snapshot.decision,
    decisionReason: snapshot.decisionReason,
    estimatedFeeSats: snapshot.estimatedFeeSats,
    priceImpactBps: snapshot.priceImpactBps,
    watchGateEligible: snapshot.watchGateEligible,
    watchGateReason: snapshot.watchGateReason,
    watchGateScore: snapshot.watchGateScore,
    edgeScore: snapshot.edgeScore,
    executionQualityScore: snapshot.executionQualityScore,
    lastShadowExecution: snapshot.lastShadowExecution || null,
    telegramReason: telegram.reason || null,
  });
}

function persistArmament(snapshot, timeoutSec) {
  const currentState = readAgentState();
  if (
    currentState.remoteExecPilotConsumedAt &&
    currentState.remoteExecPilotExecutionCount >= 1
  ) {
    appendJsonLog('championship_auto_arm_not_armed', {
      status: snapshot.status,
      pair: snapshot.pair,
      amountSats: snapshot.amountSats,
      reason: 'remote_exec_pilot_already_consumed',
    });
    return {
      armed: false,
      reason: 'remote_exec_pilot_already_consumed',
    };
  }
  if (currentState.autoArmStatus === 'armed') {
    const expiresAtMs = Date.parse(currentState.autoArmExpiresAt || '');
    if (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()) {
      appendJsonLog('championship_auto_arm_skipped_existing_active', {
        autoArmStatus: currentState.autoArmStatus,
        autoArmNonce: currentState.autoArmNonce,
        autoArmExpiresAt: currentState.autoArmExpiresAt,
      });
      return {
        armed: false,
        reason: 'existing_active_armament',
      };
    }
  }

  const armState = createArmedState(snapshot, new Date(), timeoutSec);
  updateAgentState(current => {
    current.autoArmStatus = armState.autoArmStatus;
    current.autoArmNonce = armState.autoArmNonce;
    current.autoArmArmedAt = armState.autoArmArmedAt;
    current.autoArmExpiresAt = armState.autoArmExpiresAt;
    current.autoArmConsumedAt = armState.autoArmConsumedAt;
    current.autoArmManualCommand = armState.autoArmManualCommand;
    current.autoArmAmountSats = armState.autoArmAmountSats;
    current.autoArmPair = armState.autoArmPair;
    current.autoArmExecutionOutcome = armState.autoArmExecutionOutcome;
    current.autoArmExecutionTxId = armState.autoArmExecutionTxId;
    return current;
  });

  appendJsonLog('championship_auto_arm_armed', {
    autoArmStatus: armState.autoArmStatus,
    autoArmNonce: armState.autoArmNonce,
    autoArmArmedAt: armState.autoArmArmedAt,
    autoArmExpiresAt: armState.autoArmExpiresAt,
    autoArmPair: armState.autoArmPair,
    autoArmAmountSats: armState.autoArmAmountSats,
    autoArmManualCommand: armState.autoArmManualCommand,
  });

  return {
    armed: true,
    armState,
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const config = loadAgentConfig();
  const amountSats = Number(flags['amount-sats'] || 3000);
  const intervalSeconds = Math.max(30, Math.min(60, Number(flags['interval-seconds'] || 45)));
  const once = parseBoolean(flags.once, false);
  const simulateReady = parseBoolean(flags.simulateReady, false);
  const mockTelegram = parseBoolean(flags.mockTelegram, false);
  const timeoutSec = Math.max(15, Number(config.telegram?.execTimeoutSec || 60));

  appendJsonLog('championship_auto_arm_started', {
    amountSats,
    intervalSeconds,
    once,
    simulateReady,
    mockTelegram,
  });

  let lastWatchlistAlertKey = null;

  while (true) {
    let snapshot;
    try {
      snapshot = simulateReady
        ? simulateReadySnapshot(amountSats)
        : evaluateGateFromPayload(runDryEvaluation(amountSats));
    } catch (error) {
      appendJsonLog('championship_auto_arm_iteration_failed', {
        ok: false,
        amountSats,
        error: error.message,
      });
      console.log('STATUS: OBSERVING');
      console.log('DECISION: SKIP');
      console.log('BLOCK_REASON: observer_error');
      console.log('LIVE_ALLOWED: NO');
      if (once) break;
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
      continue;
    }

    appendJsonLog('championship_auto_arm_iteration', {
      amountSats,
      status: snapshot.status,
      decision: snapshot.decision,
      decisionReason: snapshot.decisionReason,
      watchGateEligible: snapshot.watchGateEligible,
      watchGateReason: snapshot.watchGateReason,
      watchGateScore: snapshot.watchGateScore,
      edgeScore: snapshot.edgeScore,
      executionQualityScore: snapshot.executionQualityScore,
      championshipGateEligible: snapshot.championshipGateEligible,
      championshipGateBlockReason: snapshot.championshipGateBlockReason,
      estimatedFeeSats: snapshot.estimatedFeeSats,
      priceImpactBps: snapshot.priceImpactBps,
      liveAllowed: snapshot.liveAllowed,
    });

    console.log(`STATUS: ${snapshot.status}`);
    console.log(`DECISION: ${snapshot.decision}`);
    console.log(`BLOCK_REASON: ${snapshot.championshipGateBlockReason || 'none'}`);
    console.log(`LIVE_ALLOWED: ${snapshot.liveAllowed}`);

    if (snapshot.status === 'WATCHLIST_READY') {
      const watchKey = [
        snapshot.status,
        snapshot.pair,
        snapshot.amountSats,
        snapshot.estimatedFeeSats,
        snapshot.priceImpactBps,
        snapshot.decision,
        snapshot.decisionReason,
        snapshot.watchGateReason,
        snapshot.watchGateScore,
        snapshot.edgeScore,
        snapshot.executionQualityScore,
      ].join('|');
      if (watchKey !== lastWatchlistAlertKey) {
        await emitWatchlistAlert(snapshot, { mockTelegram });
        lastWatchlistAlertKey = watchKey;
      }
      if (once) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 12 * 1000));
      continue;
    }

    if (snapshot.status === 'READY_TO_FIRE') {
      if (!snapshot.remoteExecutionAllowed || !snapshot.manualCommand) {
        appendJsonLog('championship_auto_arm_not_armed', {
          status: snapshot.status,
          pair: snapshot.pair,
          amountSats: snapshot.amountSats,
          reason: snapshot.remoteExecutionBlockReason || 'manual_command_unavailable',
        });
        console.log('REMOTE_EXEC: BLOCKED');
        console.log(`REMOTE_EXEC_REASON: ${snapshot.remoteExecutionBlockReason || 'manual_command_unavailable'}`);
        break;
      }

      const armed = persistArmament(snapshot, timeoutSec);
      if (!armed.armed) {
        console.log('REMOTE_EXEC: SKIPPED');
        console.log(`REMOTE_EXEC_REASON: ${armed.reason}`);
        break;
      }

      await emitReadyAlert({
        ...snapshot,
        autoArmNonce: armed.armState.autoArmNonce,
        autoArmArmedAt: armed.armState.autoArmArmedAt,
        autoArmExpiresAt: armed.armState.autoArmExpiresAt,
      }, { mockTelegram });
      break;
    }

    lastWatchlistAlertKey = null;

    if (once) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
  }
}

main().catch(error => {
  appendJsonLog('championship_auto_arm_failed', {
    ok: false,
    error: error.message,
  });
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
