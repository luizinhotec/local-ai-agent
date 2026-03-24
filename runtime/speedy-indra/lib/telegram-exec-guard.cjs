const { randomBytes } = require('crypto');

const EXEC_TIMEOUT_SEC = 60;
const NONCE_LENGTH = 6;
const EXEC_COMMAND_PATTERN = /^EXEC ([A-Z0-9]+)$/;

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function generateNonce(length = NONCE_LENGTH) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let nonce = '';
  for (let index = 0; index < length; index += 1) {
    nonce += alphabet[bytes[index] % alphabet.length];
  }
  return nonce;
}

function parseExecCommand(text) {
  const normalized = String(text || '').trim();
  const match = EXEC_COMMAND_PATTERN.exec(normalized);
  if (!match) {
    return {
      ok: false,
      text: normalized,
      reason: normalized.toUpperCase().startsWith('EXEC') ? 'invalid_format' : 'ignored',
      nonce: null,
    };
  }
  return {
    ok: true,
    text: normalized,
    nonce: match[1],
  };
}

function buildRemoteExecutionCommand(snapshot) {
  const pair = String(snapshot.pair || 'sbtc-usdcx').trim().toLowerCase();
  const amountSats = Number(snapshot.amountSats || 0);

  if (pair !== 'sbtc-usdcx') {
    return {
      ok: false,
      reason: 'pair_not_supported_for_remote_exec',
      pair,
      amountSats,
    };
  }

  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    return {
      ok: false,
      reason: 'invalid_amount_for_remote_exec',
      pair,
      amountSats,
    };
  }

  if (amountSats > 2000) {
    return {
      ok: false,
      reason: 'amount_above_remote_exec_safe_limit',
      pair,
      amountSats,
    };
  }

  const args = [
    'run',
    'agent:defi:sbtc-usdcx',
    '--',
    '--live',
    '--approve-live',
    `--amount-sats=${amountSats}`,
    '--feature-override-test-v2',
  ];

  return {
    ok: true,
    pair,
    amountSats,
    command: `npm ${args.join(' ')}`,
    args,
  };
}

function evaluateGateFromPayload(payload) {
  const state = payload?.state || {};
  const watchGate = state.lastChampionshipWatchGate || {};
  const gate = state.lastChampionshipExecutionGate || {};
  const defi = state.routeEvaluatorDecisionContext?.defi || {};
  const blockers = Array.isArray(defi.knownBlockers)
    ? defi.knownBlockers
    : Array.isArray(defi.blockers)
    ? defi.blockers
    : Array.isArray(payload?.blockers)
    ? payload.blockers
    : [];
  const decision = String(gate.decision || defi.decision || 'SKIP').toUpperCase();
  const gateEligible = Boolean(payload?.championshipGateEligible);
  const watchGateEligible = Boolean(state.watchGateEligible ?? watchGate.watchGateEligible);
  const ready =
    gateEligible &&
    decision === 'PASS' &&
    blockers.length === 0 &&
    gate.quoteFresh === true;

  const execution = buildRemoteExecutionCommand({
    pair: 'sbtc-usdcx',
    amountSats: Number(payload?.amountSats || 3000),
  });

  return {
    status: ready && execution.ok ? 'READY_TO_FIRE' : watchGateEligible ? 'WATCHLIST_READY' : 'OBSERVING',
    pair: 'sbtc-usdcx',
    amountSats: Number(payload?.amountSats || 3000),
    decision,
    decisionReason: gate.decisionReason || defi.decisionReason || null,
    estimatedFeeSats: gate.estimatedFeeSats ?? defi.estimatedFeeSats ?? null,
    priceImpactBps: gate.priceImpactBps ?? defi.priceImpactBps ?? null,
    watchGateEligible,
    watchGateReason: state.watchGateReason || watchGate.watchGateReason || watchGate.reason || null,
    watchGateScore: Number(state.watchGateScore ?? watchGate.watchGateScore ?? watchGate.score ?? 0),
    edgeScore: Number(state.edgeScore ?? defi.edgeScore ?? 0),
    executionQualityScore: Number(state.executionQualityScore ?? defi.executionQualityScore ?? 0),
    lastShadowExecution: state.lastShadowExecution || defi.shadowExecution || null,
    championshipGateEligible: gateEligible,
    championshipGateBlockReason: payload?.championshipGateBlockReason || null,
    liveAllowed: ready && execution.ok ? 'YES' : 'NO',
    quoteFresh: gate.quoteFresh === true,
    blockers,
    manualCommand: ready && execution.ok ? execution.command : null,
    remoteExecutionAllowed: ready && execution.ok,
    remoteExecutionBlockReason: ready
      ? execution.ok
        ? null
        : execution.reason
      : watchGateEligible
      ? 'watch_gate_only'
      : execution.reason,
  };
}

function createArmedState(snapshot, now = new Date(), timeoutSec = EXEC_TIMEOUT_SEC) {
  const armedAtIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + timeoutSec * 1000).toISOString();
  return {
    autoArmStatus: 'armed',
    autoArmNonce: generateNonce(),
    autoArmArmedAt: armedAtIso,
    autoArmExpiresAt: expiresAtIso,
    autoArmConsumedAt: null,
    autoArmManualCommand: snapshot.manualCommand || null,
    autoArmAmountSats: Number(snapshot.amountSats || 0),
    autoArmPair: snapshot.pair || 'sbtc-usdcx',
    autoArmExecutionOutcome: null,
    autoArmExecutionTxId: null,
  };
}

function isArmExpired(state, now = new Date()) {
  const expiresAtMs = Date.parse(state?.autoArmExpiresAt || '');
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  return expiresAtMs <= now.getTime();
}

function wasMessageSentAfterArm(messageDateSec, armedAtIso) {
  const armedAtMs = Date.parse(armedAtIso || '');
  if (!Number.isFinite(armedAtMs)) {
    return false;
  }
  const armedAtFloorMs = Math.floor(armedAtMs / 1000) * 1000;
  return Number(messageDateSec || 0) * 1000 >= armedAtFloorMs;
}

function buildExecTelegramReply(status, detail) {
  return detail ? `${status} ${detail}` : status;
}

module.exports = {
  EXEC_TIMEOUT_SEC,
  parseBoolean,
  generateNonce,
  parseExecCommand,
  buildRemoteExecutionCommand,
  evaluateGateFromPayload,
  createArmedState,
  isArmExpired,
  wasMessageSentAfterArm,
  buildExecTelegramReply,
};
