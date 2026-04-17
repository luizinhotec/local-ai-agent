#!/usr/bin/env node

const fs = require('fs');
const { spawnSync } = require('child_process');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { readAgentState, updateAgentState } = require('./lib/agent-state.cjs');
const { TELEGRAM_EXEC_LOCK_PATH } = require('./lib/agent-paths.cjs');
const {
  parseBoolean,
  parseExecCommand,
  isArmExpired,
  wasMessageSentAfterArm,
  buildExecTelegramReply,
  buildRemoteExecutionCommand,
} = require('./lib/telegram-exec-guard.cjs');

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg === '--once') {
      flags.once = true;
      continue;
    }
    if (arg === '--mock-telegram') {
      flags.mockTelegram = true;
      continue;
    }
    if (arg === '--dry-run-exec') {
      flags.dryRunExec = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      flags[key] = rest.length > 0 ? rest.join('=') : true;
    }
  }
  return flags;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function stringifyId(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function updateDecisionState(fields) {
  return updateAgentState(current => {
    Object.assign(current, fields);
    return current;
  });
}

function isExecutionLocked() {
  return fs.existsSync(TELEGRAM_EXEC_LOCK_PATH);
}

function acquireExecutionLock() {
  if (isExecutionLocked()) {
    return false;
  }
  fs.writeFileSync(TELEGRAM_EXEC_LOCK_PATH, JSON.stringify({
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  }, null, 2));
  return true;
}

function releaseExecutionLock() {
  if (isExecutionLocked()) {
    fs.unlinkSync(TELEGRAM_EXEC_LOCK_PATH);
  }
}

function expireArmIfNeeded() {
  const current = readAgentState();
  if (current.autoArmStatus !== 'armed' || !isArmExpired(current)) {
    return current;
  }

  const next = updateAgentState(state => {
    state.autoArmStatus = 'expired';
    state.autoArmConsumedAt = new Date().toISOString();
    state.autoArmExecutionOutcome = 'expired';
    state.lastTelegramExecDecision = 'expired';
    return state;
  });

  appendJsonLog('championship_auto_arm_expired', {
    autoArmNonce: current.autoArmNonce,
    autoArmArmedAt: current.autoArmArmedAt,
    autoArmExpiresAt: current.autoArmExpiresAt,
  });

  return next;
}

async function sendTelegramMessage(text, options = {}) {
  const config = loadAgentConfig();
  const botToken = config.telegram?.botToken || '';
  const chatId = options.chatId || config.telegram?.chatId || '';

  if (options.mock) {
    return {
      ok: true,
      mocked: true,
      text,
    };
  }

  if (!botToken || !chatId) {
    return {
      ok: false,
      skipped: true,
      reason: 'telegram_config_missing',
      text,
    };
  }

  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: options.replyToMessageId || undefined,
    }),
  });
  const body = await response.json().catch(() => null);
  return {
    ok: Boolean(response.ok && body?.ok),
    responseStatus: response.status,
    body,
    text,
  };
}

async function fetchTelegramUpdates(flags, state) {
  const config = loadAgentConfig();
  const authorizedChatId = stringifyId(config.telegram?.chatId);
  const authorizedUserId = stringifyId(config.telegram?.authorizedUserId);
  const lastUpdateId = Number(state.lastTelegramUpdateId || 0);

  if (flags['simulate-message']) {
    return {
      ok: true,
      updates: [
        {
          update_id: lastUpdateId + 1,
          message: {
            message_id: 1,
            date: Math.floor(Date.now() / 1000),
            text: String(flags['simulate-message']),
            chat: {
              id: flags['simulate-chat-id'] || authorizedChatId,
            },
            from: {
              id: flags['simulate-from-id'] || authorizedUserId || authorizedChatId,
            },
          },
        },
      ],
    };
  }

  const botToken = config.telegram?.botToken || '';
  if (!botToken) {
    return {
      ok: false,
      reason: 'telegram_config_missing',
      updates: [],
    };
  }

  const params = new URLSearchParams();
  params.set('timeout', '0');
  params.set('allowed_updates', JSON.stringify(['message']));
  if (lastUpdateId > 0) {
    params.set('offset', String(lastUpdateId + 1));
  }

  const endpoint = `https://api.telegram.org/bot${botToken}/getUpdates?${params.toString()}`;
  const response = await fetch(endpoint);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    return {
      ok: false,
      reason: body?.description || `telegram_http_${response.status}`,
      updates: [],
    };
  }

  return {
    ok: true,
    updates: Array.isArray(body.result) ? body.result : [],
  };
}

function buildRevalidationFailureReason(nextActionPayload) {
  const state = nextActionPayload?.state || {};
  const gate = state.lastChampionshipExecutionGate || {};
  const defi = state.routeEvaluatorDecisionContext?.defi || {};
  const blockers = Array.isArray(defi.knownBlockers)
    ? defi.knownBlockers
    : Array.isArray(defi.blockers)
    ? defi.blockers
    : [];

  if (nextActionPayload?.championshipGateEligible !== true) {
    return nextActionPayload?.championshipGateBlockReason || 'championship_gate_not_green';
  }
  if (String(gate.decision || '').toUpperCase() !== 'PASS') {
    return `decision_${String(gate.decision || 'unknown').toLowerCase()}`;
  }
  if (blockers.length > 0) {
    return blockers[0];
  }
  if (gate.quoteFresh !== true) {
    return 'quote_stale';
  }
  return 'revalidation_unknown_failure';
}

function revalidateArmament(amountSats) {
  const run = spawnSync(process.execPath, [
    'runtime/speedy-indra/agent-next-action.cjs',
    '--dry-run',
    '--force',
    `--amount-sats=${amountSats}`,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  });

  if (run.error) {
    return {
      ok: false,
      reason: run.error.message,
    };
  }

  if (run.status !== 0) {
    return {
      ok: false,
      reason: run.stderr || run.stdout || `agent-next-action_failed_${run.status}`,
    };
  }

  const payload = JSON.parse(run.stdout);
  const state = payload?.state || {};
  const gate = state.lastChampionshipExecutionGate || {};
  const defi = state.routeEvaluatorDecisionContext?.defi || {};
  const blockers = Array.isArray(defi.knownBlockers)
    ? defi.knownBlockers
    : Array.isArray(defi.blockers)
    ? defi.blockers
    : [];

  const eligible =
    payload.championshipGateEligible === true &&
    String(gate.decision || '').toUpperCase() === 'PASS' &&
    blockers.length === 0 &&
    !blockers.includes('circuit_breaker_open') &&
    gate.quoteFresh === true;

  return {
    ok: eligible,
    payload,
    blockers,
    reason: eligible ? null : buildRevalidationFailureReason(payload),
  };
}

function getRevalidationResult(amountSats, flags) {
  if (parseBoolean(flags['mock-revalidation-pass'], false)) {
    return {
      ok: true,
      payload: {
        mock: true,
      },
      blockers: [],
      reason: null,
    };
  }

  if (flags['mock-revalidation-fail']) {
    return {
      ok: false,
      payload: {
        mock: true,
      },
      blockers: [String(flags['mock-revalidation-fail'])],
      reason: String(flags['mock-revalidation-fail']),
    };
  }

  return revalidateArmament(amountSats);
}

function executeArmedCommand(state, flags, config) {
  const command = buildRemoteExecutionCommand({
    pair: state.autoArmPair,
    amountSats: state.autoArmAmountSats,
  });

  if (!command.ok || command.command !== state.autoArmManualCommand) {
    return {
      ok: false,
      status: 'failed',
      reason: 'armed_command_mismatch',
    };
  }

  if (!config.telegram?.remoteExecPilotEnabled) {
    return {
      ok: true,
      status: 'simulated',
      txid: null,
      payload: {
        ok: true,
        simulated: true,
        reason: 'remote_exec_pilot_disabled',
        command: command.command,
      },
    };
  }

  if (parseBoolean(flags.dryRunExec, false)) {
    return {
      ok: true,
      status: 'simulated',
      txid: null,
      payload: {
        ok: true,
        simulated: true,
        command: command.command,
      },
    };
  }

  const run = spawnSync(getNpmCommand(), command.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 240000,
    windowsHide: true,
  });

  if (run.error) {
    return {
      ok: false,
      status: 'failed',
      reason: run.error.message,
    };
  }

  let payload = null;
  try {
    payload = run.stdout.trim() ? JSON.parse(run.stdout) : null;
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      reason: `execution_output_parse_failed:${error.message}`,
    };
  }

  if (run.status !== 0 || payload?.ok !== true) {
    return {
      ok: false,
      status: 'failed',
      reason: payload?.execution?.reason || payload?.error || `execution_failed_${run.status}`,
      payload,
    };
  }

  return {
    ok: Boolean(payload?.execution?.executed),
    status: payload?.execution?.status || 'failed',
    reason: payload?.execution?.reason || null,
    txid: payload?.execution?.txid || null,
    payload,
  };
}

async function processExecCommand(update, flags) {
  const message = update.message || {};
  const config = loadAgentConfig();
  const state = expireArmIfNeeded();
  const parsed = parseExecCommand(message.text || '');
  const chatId = stringifyId(message.chat?.id);
  const fromId = stringifyId(message.from?.id);
  const authorizedChatId = stringifyId(config.telegram?.chatId);
  const authorizedUserId = stringifyId(config.telegram?.authorizedUserId);

  if (parsed.reason === 'ignored') {
    return false;
  }

  const baseDecision = {
    lastTelegramExecCommandAt: new Date().toISOString(),
    lastTelegramExecCommandText: parsed.text,
  };

  appendJsonLog('championship_telegram_exec_command_received', {
    updateId: update.update_id,
    chatId,
    fromId,
    text: parsed.text,
    nonce: parsed.nonce,
  });

  if (chatId !== authorizedChatId) {
    appendJsonLog('championship_telegram_exec_rejected_unauthorized_origin', {
      reason: 'chat_not_authorized',
      chatId,
      authorizedChatId,
      fromId,
    });
    updateDecisionState({
      ...baseDecision,
      lastTelegramExecDecision: 'rejected_chat_not_authorized',
      lastTelegramUpdateId: update.update_id,
    });
    return true;
  }

  if (authorizedUserId && fromId !== authorizedUserId) {
    appendJsonLog('championship_telegram_exec_rejected_unauthorized_origin', {
      reason: 'user_not_authorized',
      chatId,
      authorizedChatId,
      fromId,
      authorizedUserId,
    });
    updateDecisionState({
      ...baseDecision,
      lastTelegramExecDecision: 'rejected_user_not_authorized',
      lastTelegramUpdateId: update.update_id,
    });
    return true;
  }

  if (!parsed.ok) {
    appendJsonLog('championship_telegram_exec_rejected_invalid_format', {
      text: parsed.text,
      reason: parsed.reason,
    });
    updateDecisionState({
      ...baseDecision,
      lastTelegramExecDecision: parsed.reason,
      lastTelegramUpdateId: update.update_id,
    });
    await sendTelegramMessage(buildExecTelegramReply('EXEC_REJECTED', 'invalid_format'), {
      mock: parseBoolean(flags.mockTelegram, false),
      chatId,
      replyToMessageId: message.message_id,
    });
    return true;
  }

  if (!state.autoArmNonce || !state.autoArmArmedAt || state.autoArmStatus === 'idle') {
    appendJsonLog('championship_telegram_exec_rejected_not_armed', {
      text: parsed.text,
      nonce: parsed.nonce,
    });
    updateDecisionState({
      ...baseDecision,
      lastTelegramExecDecision: 'rejected_not_armed',
      lastTelegramUpdateId: update.update_id,
    });
    await sendTelegramMessage(buildExecTelegramReply('EXEC_REJECTED', 'not_armed'), {
      mock: parseBoolean(flags.mockTelegram, false),
      chatId,
      replyToMessageId: message.message_id,
    });
    return true;
  }

  if (state.autoArmStatus === 'expired' || isArmExpired(state)) {
    updateDecisionState({
      ...baseDecision,
      autoArmStatus: 'expired',
      autoArmConsumedAt: state.autoArmConsumedAt || new Date().toISOString(),
      autoArmExecutionOutcome: 'expired',
      lastTelegramExecDecision: 'expired',
      lastTelegramUpdateId: update.update_id,
    });
    appendJsonLog('championship_telegram_exec_rejected_expired', {
      autoArmNonce: state.autoArmNonce,
      receivedNonce: parsed.nonce,
    });
    await sendTelegramMessage('EXEC_EXPIRED', {
      mock: parseBoolean(flags.mockTelegram, false),
      chatId,
      replyToMessageId: message.message_id,
    });
    return true;
  }

  if (state.autoArmStatus === 'consumed' || state.autoArmStatus === 'fired') {
    appendJsonLog('championship_telegram_exec_rejected_already_consumed', {
      autoArmNonce: state.autoArmNonce,
      autoArmStatus: state.autoArmStatus,
      receivedNonce: parsed.nonce,
    });
    updateDecisionState({
      ...baseDecision,
      lastTelegramExecDecision: 'already_consumed',
      lastTelegramUpdateId: update.update_id,
    });
    await sendTelegramMessage('EXEC_ALREADY_CONSUMED', {
      mock: parseBoolean(flags.mockTelegram, false),
      chatId,
      replyToMessageId: message.message_id,
    });
    return true;
  }

  if (!wasMessageSentAfterArm(message.date, state.autoArmArmedAt)) {
    updateDecisionState({
      ...baseDecision,
      lastTelegramExecDecision: 'rejected_message_before_armament',
      lastTelegramUpdateId: update.update_id,
    });
    await sendTelegramMessage(buildExecTelegramReply('EXEC_REJECTED', 'message_before_armament'), {
      mock: parseBoolean(flags.mockTelegram, false),
      chatId,
      replyToMessageId: message.message_id,
    });
    return true;
  }

  if (parsed.nonce !== state.autoArmNonce) {
    updateDecisionState({
      ...baseDecision,
      lastTelegramExecDecision: 'invalid_nonce',
      lastTelegramUpdateId: update.update_id,
    });
    appendJsonLog('championship_telegram_exec_rejected_invalid_nonce', {
      autoArmNonce: state.autoArmNonce,
      receivedNonce: parsed.nonce,
    });
    await sendTelegramMessage(buildExecTelegramReply('EXEC_REJECTED', 'invalid_nonce'), {
      mock: parseBoolean(flags.mockTelegram, false),
      chatId,
      replyToMessageId: message.message_id,
    });
    return true;
  }

  if (
    state.remoteExecPilotConsumedAt &&
    Number(state.remoteExecPilotExecutionCount || 0) >= 1
  ) {
    appendJsonLog('championship_telegram_exec_rejected_pilot_already_consumed', {
      autoArmNonce: state.autoArmNonce,
      remoteExecPilotConsumedAt: state.remoteExecPilotConsumedAt,
      remoteExecPilotExecutionCount: state.remoteExecPilotExecutionCount,
    });
    updateDecisionState({
      ...baseDecision,
      lastTelegramExecDecision: 'pilot_already_consumed',
      lastTelegramUpdateId: update.update_id,
    });
    await sendTelegramMessage(buildExecTelegramReply('EXEC_REJECTED', 'pilot_already_consumed'), {
      mock: parseBoolean(flags.mockTelegram, false),
      chatId,
      replyToMessageId: message.message_id,
    });
    return true;
  }

  const revalidation = getRevalidationResult(Number(state.autoArmAmountSats || 0), flags);
  if (!revalidation.ok) {
    updateDecisionState({
      ...baseDecision,
      autoArmStatus: 'consumed',
      autoArmConsumedAt: new Date().toISOString(),
      autoArmExecutionOutcome: `revalidation_failed:${revalidation.reason}`,
      lastTelegramExecDecision: 'revalidation_failed',
      lastTelegramUpdateId: update.update_id,
    });
    appendJsonLog('championship_telegram_exec_rejected_revalidation_failed', {
      autoArmNonce: state.autoArmNonce,
      reason: revalidation.reason,
      blockers: revalidation.blockers || [],
    });
    await sendTelegramMessage(buildExecTelegramReply('EXEC_REVALIDATION_FAILED', revalidation.reason), {
      mock: parseBoolean(flags.mockTelegram, false),
      chatId,
      replyToMessageId: message.message_id,
    });
    return true;
  }

  if (!acquireExecutionLock()) {
    appendJsonLog('championship_telegram_exec_locked', {
      autoArmNonce: state.autoArmNonce,
      lockPath: TELEGRAM_EXEC_LOCK_PATH,
    });
    updateDecisionState({
      ...baseDecision,
      lastTelegramExecDecision: 'locked',
      lastTelegramUpdateId: update.update_id,
    });
    await sendTelegramMessage(buildExecTelegramReply('EXEC_REJECTED', 'locked'), {
      mock: parseBoolean(flags.mockTelegram, false),
      chatId,
      replyToMessageId: message.message_id,
    });
    return true;
  }

  await sendTelegramMessage('EXEC_ACCEPTED', {
    mock: parseBoolean(flags.mockTelegram, false),
    chatId,
    replyToMessageId: message.message_id,
  });

  appendJsonLog('championship_telegram_exec_started', {
    autoArmNonce: state.autoArmNonce,
    amountSats: state.autoArmAmountSats,
    pair: state.autoArmPair,
    dryRunExec: parseBoolean(flags.dryRunExec, false),
    remoteExecPilotEnabled: Boolean(config.telegram?.remoteExecPilotEnabled),
  });

  let execution;
  try {
    execution = executeArmedCommand(state, flags, config);
  } finally {
    releaseExecutionLock();
  }
  if (!execution.ok) {
    if (execution.reason === 'armed_command_mismatch') {
      appendJsonLog('championship_telegram_exec_rejected_command_mismatch', {
        autoArmNonce: state.autoArmNonce,
        autoArmManualCommand: state.autoArmManualCommand,
      });
    }
    updateDecisionState({
      ...baseDecision,
      autoArmStatus: 'consumed',
      autoArmConsumedAt: new Date().toISOString(),
      autoArmExecutionOutcome: `execution_failed:${execution.reason}`,
      remoteExecPilotConsumedAt: config.telegram?.remoteExecPilotEnabled
        ? new Date().toISOString()
        : state.remoteExecPilotConsumedAt,
      remoteExecPilotExecutionCount: config.telegram?.remoteExecPilotEnabled
        ? 1
        : Number(state.remoteExecPilotExecutionCount || 0),
      remoteExecPilotLastOutcome: `execution_failed:${execution.reason}`,
      remoteExecPilotLastTxId: execution.txid || null,
      lastTelegramExecDecision: 'execution_failed',
      lastTelegramUpdateId: update.update_id,
    });
    appendJsonLog('championship_telegram_exec_failed', {
      autoArmNonce: state.autoArmNonce,
      reason: execution.reason,
    });
    await sendTelegramMessage(buildExecTelegramReply('EXEC_REJECTED', `execution_failed:${execution.reason}`), {
      mock: parseBoolean(flags.mockTelegram, false),
      chatId,
      replyToMessageId: message.message_id,
    });
    return true;
  }

  updateDecisionState({
    ...baseDecision,
    autoArmStatus: 'fired',
    autoArmConsumedAt: new Date().toISOString(),
    autoArmExecutionOutcome: execution.status,
    autoArmExecutionTxId: execution.txid || null,
    remoteExecPilotConsumedAt:
      config.telegram?.remoteExecPilotEnabled && execution.status !== 'simulated'
        ? new Date().toISOString()
        : state.remoteExecPilotConsumedAt,
    remoteExecPilotExecutionCount:
      config.telegram?.remoteExecPilotEnabled && execution.status !== 'simulated'
        ? 1
        : Number(state.remoteExecPilotExecutionCount || 0),
    remoteExecPilotLastOutcome: execution.status,
    remoteExecPilotLastTxId: execution.txid || null,
    lastTelegramExecDecision: 'accepted_and_fired',
    lastTelegramUpdateId: update.update_id,
  });

  appendJsonLog('championship_telegram_exec_completed', {
    autoArmNonce: state.autoArmNonce,
    status: execution.status,
    txid: execution.txid || null,
    simulated: parseBoolean(flags.dryRunExec, false),
  });

  await sendTelegramMessage(buildExecTelegramReply('EXEC_ACCEPTED', execution.txid ? `txid:${execution.txid}` : execution.status), {
    mock: parseBoolean(flags.mockTelegram, false),
    chatId,
    replyToMessageId: message.message_id,
  });
  return true;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const config = loadAgentConfig();
  const once = parseBoolean(flags.once, false);
  const pollIntervalMs = Math.max(
    1000,
    Number(flags['poll-interval-ms'] || 0) || Number(config.telegram?.execPollingIntervalSec || 5) * 1000,
  );

  appendJsonLog('championship_telegram_exec_listener_started', {
    once,
    pollIntervalMs,
    mockTelegram: parseBoolean(flags.mockTelegram, false),
    dryRunExec: parseBoolean(flags.dryRunExec, false),
  });

  while (true) {
    const state = expireArmIfNeeded();
    const result = await fetchTelegramUpdates(flags, state);
    if (!result.ok) {
      appendJsonLog('championship_telegram_exec_listener_poll_failed', {
        reason: result.reason,
      });
      if (once) {
        break;
      }
      await sleep(pollIntervalMs);
      continue;
    }

    let handled = false;
    for (const update of result.updates) {
      const processed = await processExecCommand(update, flags);
      updateDecisionState({
        lastTelegramUpdateId: update.update_id,
      });
      handled = handled || processed;
    }

    if (once) {
      break;
    }

    if (!handled) {
      await sleep(pollIntervalMs);
    }
  }
}

main().catch(error => {
  appendJsonLog('championship_telegram_exec_failed', {
    ok: false,
    reason: error.message,
  });
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
