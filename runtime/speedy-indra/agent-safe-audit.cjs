#!/usr/bin/env node

const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { readAgentState, readAgentStatus, readWatchdog } = require('./lib/agent-state.cjs');

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (['signature', 'walletPassword', 'mnemonic', 'wif', 'hex'].includes(key)) {
      sanitized[key] = item ? '[REDACTED]' : item;
      continue;
    }
    sanitized[key] = sanitizeValue(item);
  }
  return sanitized;
}

function main() {
  const config = loadAgentConfig();
  const state = readAgentState();
  const status = readAgentStatus();
  const watchdog = readWatchdog();

  const payload = {
    ok: true,
    audit: 'speedy-indra-safe-mode',
    checkedAt: new Date().toISOString(),
    flags: {
      enableMessaging: config.featureFlags.messaging,
      safeRepliesOnly: config.messaging.safeRepliesOnly,
      fullOutboundEnabled: config.messaging.fullOutboundEnabled,
      requireApprovalForDefiLive: config.defiSimple.requireApprovalForLive,
      requireApprovalForWalletLive: config.walletActions.requireApprovalForLive,
    },
    messaging: {
      enabled: state.skills.messaging.enabled,
      policyMode: state.skills.messaging.policyMode,
      activePolicy: state.skills.messaging.activePolicy,
      lastOutcome: state.skills.messaging.lastOutcome,
      lastSkipReason: state.skills.messaging.lastSkipReason,
      lastActionType: state.skills.messaging.lastActionType,
      lastActionResult: state.skills.messaging.lastActionResult,
      unreadCount: state.unreadCount,
      repliedMessages: state.repliedMessages,
    },
    routeEvaluator: {
      lastRecommendedAction: state.lastRecommendedAction,
      lastRecommendedReason: state.lastRecommendedReason,
      lastRecommendationConfidence: state.lastRecommendationConfidence,
    },
    nextAction: {
      suggestion: sanitizeValue(state.lastNextActionSuggestion),
      command: state.lastNextActionCommand,
    },
    standardLoop: {
      lastRunAt: state.lastStandardLoopRunAt,
      lastAction: state.lastStandardLoopAction,
      lastAuthorizedAction: state.lastStandardLoopAuthorizedAction,
      lastProposedCommand: state.lastStandardLoopProposedCommand,
      lastExecutedCommand: state.lastStandardLoopExecutedCommand,
      lastBlockReason: state.lastStandardLoopBlockReason,
      cycles: state.standardLoopCycles,
      autoActions: state.standardLoopAutoActionsCount,
    },
    recentBlockers: {
      messaging: state.skills.messaging.lastSkipReason,
      standardLoop: state.lastStandardLoopBlockReason,
      wallet: (state.walletKnownBlockers || []).slice(-5),
      defi: (state.defiKnownBlockers || []).slice(-5),
      router: (state.btcL1ToUsdcxKnownBlockers || []).slice(-5),
    },
    status: sanitizeValue(status),
    watchdog: sanitizeValue(watchdog),
    safeModeBaselineReady:
      config.featureFlags.messaging &&
      config.messaging.safeRepliesOnly &&
      !config.messaging.fullOutboundEnabled &&
      state.skills.messaging.policyMode === 'safe_replies_only',
  };

  console.log(JSON.stringify(payload, null, 2));
}

main();
