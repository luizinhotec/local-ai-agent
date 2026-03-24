const fs = require('fs');
const path = require('path');
const {
  STATE_DIR,
  AGENT_STATE_PATH,
  AGENT_STATUS_PATH,
  AGENT_WATCHDOG_PATH,
} = require('./agent-paths.cjs');
const { defaultSkillBuilderState, mergeSkillBuilderState } = require('./skill-builder.cjs');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function defaultAgentState() {
  return {
    lastCycleAt: null,
    lastCycleStatus: 'never',
    lastCycleError: null,
    lastHeartbeatAt: null,
    lastHeartbeatSuccessAt: null,
    consecutiveHeartbeatFailures: 0,
    heartbeatAttempts: 0,
    heartbeatSuccesses: 0,
    heartbeatRetries: 0,
    heartbeatCircuitOpenUntil: null,
    sentMessages: 0,
    failedMessages: 0,
    repliedMessages: 0,
    lastMessageByTarget: {},
    lastReplyAt: null,
    lastReplyTargets: [],
    replyHistory: [],
    replyTemplateStats: {},
    replyAnalytics: {
      total: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
      achievementsDetected: [],
    },
    outboundQueue: [],
    unreadCount: 0,
    inboxMessages: [],
    lastMessagingRunAt: null,
    messageWindow: [],
    recentMessageHashes: [],
    identityStatus: {
      implemented: false,
      ready: false,
      status: 'not_checked',
    },
    progressionStatus: {
      implemented: false,
      status: 'not_checked',
    },
    lastIdentityCheckAt: null,
    missingIdentitySteps: [],
    completedIdentitySteps: [],
    btcL1ReadinessStatus: {
      implemented: false,
      status: 'not_checked',
    },
    lastBtcL1ReadinessCheckAt: null,
    btcL1KnownBlockers: [],
    btcL1ToUsdcxStatus: {
      implemented: false,
      status: 'not_checked',
    },
    lastBtcL1ToUsdcxCheckAt: null,
    lastBtcL1ToUsdcxAttemptAt: null,
    lastBtcL1ToUsdcxSuccessAt: null,
    btcL1ToUsdcxRouteSuggested: null,
    btcL1ToUsdcxRouteUsed: null,
    btcL1ToUsdcxAttempts: 0,
    btcL1ToUsdcxSuccesses: 0,
    btcL1ToUsdcxFailures: 0,
    btcL1ToUsdcxLastPlan: null,
    btcL1ToUsdcxKnownBlockers: [],
    walletStatus: {
      implemented: false,
      ready: false,
      status: 'not_checked',
    },
    walletChecks: 0,
    walletActionsAttempted: 0,
    walletActionsSucceeded: 0,
    walletActionsFailed: 0,
    lastWalletCheckAt: null,
    lastWalletActionAt: null,
    lastWalletActionTxId: null,
    lastWalletActionOutcome: 'never',
    walletKnownBlockers: [],
    walletLastPlan: null,
    defiStatus: {
      implemented: false,
      ready: false,
      status: 'not_checked',
    },
    blsmStatus: {
      implemented: false,
      status: 'not_checked',
    },
    defiLastPair: null,
    defiAttempts: 0,
    defiSucceeded: 0,
    defiFailed: 0,
    consecutiveDefiFailures: 0,
    lastDefiCheckAt: null,
    lastBlsmCheckAt: null,
    lastDefiAttemptAt: null,
    lastDefiSuccessAt: null,
    lastDefiLiveAttemptAt: null,
    lastDefiLiveSuccessAt: null,
    lastDefiLiveTxId: null,
    lastDefiLiveOutcome: 'never',
    defiKnownBlockers: [],
    defiLastPlan: null,
    defiLastQuoteSummary: null,
    routeEvaluatorStatus: {
      implemented: false,
      status: 'not_checked',
    },
    watchGateEligible: false,
    watchGateReason: null,
    watchGateScore: 0,
    lastChampionshipWatchGate: null,
    lastShadowExecution: null,
    edgeScore: 0,
    executionQualityScore: 0,
    autoArmStatus: 'idle',
    autoArmNonce: null,
    autoArmArmedAt: null,
    autoArmExpiresAt: null,
    autoArmConsumedAt: null,
    autoArmManualCommand: null,
    autoArmAmountSats: null,
    autoArmPair: null,
    autoArmExecutionOutcome: null,
    autoArmExecutionTxId: null,
    remoteExecPilotConsumedAt: null,
    remoteExecPilotExecutionCount: 0,
    remoteExecPilotLastOutcome: null,
    remoteExecPilotLastTxId: null,
    lastTelegramExecCommandAt: null,
    lastTelegramExecCommandText: null,
    lastTelegramExecDecision: null,
    lastTelegramUpdateId: null,
    lastRouteEvaluationAt: null,
    lastRecommendedAction: null,
    lastRecommendedReason: null,
    lastRecommendationConfidence: 0,
    routeEvaluatorDecisionContext: null,
    routeEvaluatorHistory: [],
    blsm: {
      implemented: false,
      lastRunAt: null,
      lastMode: null,
      lastPositionKey: null,
      lastRecommendedAction: null,
      lastReasonCode: null,
      lastReport: null,
      positions: {},
    },
    skillBuilder: defaultSkillBuilderState(),
    autoLive: {
      executionsToday: 0,
      executionsLastHour: 0,
      spendSatsToday: 0,
      lastAutoExecutedSkillId: null,
      lastAutoExecutedAt: null,
      lastAutoBlockedReason: null,
      policyVersion: 'auto_live_policy_v1',
      executionHistory: [],
    },
    bountyExecution: {
      preparedCandidates: [],
      candidateExecutionHistory: {},
      preparedCandidate: null,
      lastPreparedCandidateId: null,
      lastPreparedCandidateSource: null,
      lastEvaluationAt: null,
      lastStatus: 'never',
      lastReason: null,
      lastBlockedReason: null,
      lastManualCommand: null,
      lastDryRunAt: null,
      lastDryRunResult: null,
      lastLiveAttemptAt: null,
      lastLiveResult: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureClass: null,
      retryAfter: null,
      lastExecutedActionType: null,
      lastExecutedCandidateId: null,
      lastExecutionMode: null,
      liveRouteImplemented: false,
      liveRouteName: null,
      cooldownUntil: null,
      breakerOpenUntil: null,
      consecutiveFailures: 0,
      approvalRequired: true,
      autoExecutable: false,
      finalScore: 0,
      scoreBreakdown: {},
      penaltyBreakdown: {},
    },
    lastNextActionSuggestion: null,
    lastNextActionCommand: null,
    lastNextActionAt: null,
    lastStandardLoopRunAt: null,
    lastStandardLoopAction: null,
    lastStandardLoopAuthorizedAction: null,
    lastStandardLoopProposedCommand: null,
    lastStandardLoopExecutedCommand: null,
    lastStandardLoopBlockReason: null,
    lastStandardLoopDecision: null,
    standardLoopCycles: 0,
    standardLoopAutoActionsCount: 0,
    skills: {
      heartbeat: {
        enabled: true,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastSkipReason: null,
        lastOutcome: 'never',
        lastAttemptMode: null,
        lastStatusCode: null,
        errorCount: 0,
      },
      messaging: {
        enabled: false,
        policyMode: 'disabled',
        activePolicy: 'disabled',
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastSkipReason: null,
        lastOutcome: 'never',
        lastAttemptMode: null,
        lastActionType: null,
        lastActionResult: null,
        lastPaymentTxId: null,
        lastStatusCode: null,
        errorCount: 0,
      },
      identity: {
        enabled: false,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastSkipReason: null,
        lastOutcome: 'never',
        lastAttemptMode: null,
        lastStatusCode: null,
        errorCount: 0,
      },
      btcL1ToUsdcx: {
        enabled: false,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastSkipReason: null,
        lastOutcome: 'never',
        lastAttemptMode: null,
        lastStatusCode: null,
        errorCount: 0,
      },
      walletActions: {
        enabled: false,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastSkipReason: null,
        lastOutcome: 'never',
        lastAttemptMode: null,
        lastStatusCode: null,
        errorCount: 0,
      },
      defiSimple: {
        enabled: false,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastSkipReason: null,
        lastOutcome: 'never',
        lastAttemptMode: null,
        lastStatusCode: null,
        errorCount: 0,
      },
      blsm: {
        enabled: true,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastSkipReason: null,
        lastOutcome: 'never',
        lastAttemptMode: null,
        lastStatusCode: null,
        errorCount: 0,
      },
      routeEvaluator: {
        enabled: true,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastSkipReason: null,
        lastOutcome: 'never',
        lastAttemptMode: null,
        lastStatusCode: null,
        errorCount: 0,
      },
      bountyExecute: {
        enabled: true,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastSkipReason: null,
        lastOutcome: 'never',
        lastAttemptMode: null,
        lastStatusCode: null,
        errorCount: 0,
      },
    },
    loop: {
      iteration: 0,
      startedAt: null,
      lastProgressAt: null,
      lastCompletedAt: null,
      lastLockRefreshAt: null,
      stale: false,
    },
  };
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readAgentState() {
  const current = readJson(AGENT_STATE_PATH, null);
  if (!current) {
    return defaultAgentState();
  }
  const defaults = defaultAgentState();
  return {
    ...defaults,
    ...current,
    identityStatus: { ...defaults.identityStatus, ...(current.identityStatus || {}) },
    progressionStatus: { ...defaults.progressionStatus, ...(current.progressionStatus || {}) },
    btcL1ReadinessStatus: { ...defaults.btcL1ReadinessStatus, ...(current.btcL1ReadinessStatus || {}) },
    btcL1ToUsdcxStatus: { ...defaults.btcL1ToUsdcxStatus, ...(current.btcL1ToUsdcxStatus || {}) },
    walletStatus: { ...defaults.walletStatus, ...(current.walletStatus || {}) },
    defiStatus: { ...defaults.defiStatus, ...(current.defiStatus || {}) },
    blsmStatus: { ...defaults.blsmStatus, ...(current.blsmStatus || {}) },
    routeEvaluatorStatus: { ...defaults.routeEvaluatorStatus, ...(current.routeEvaluatorStatus || {}) },
    blsm: {
      ...defaults.blsm,
      ...(current.blsm || {}),
      positions: {
        ...defaults.blsm.positions,
        ...((current.blsm || {}).positions || {}),
      },
    },
    skillBuilder: mergeSkillBuilderState(current.skillBuilder),
    autoLive: { ...defaults.autoLive, ...(current.autoLive || {}) },
    bountyExecution: { ...defaults.bountyExecution, ...(current.bountyExecution || {}) },
    skills: {
      ...defaults.skills,
      ...(current.skills || {}),
      heartbeat: {
        ...defaults.skills.heartbeat,
        ...((current.skills || {}).heartbeat || {}),
      },
      messaging: {
        ...defaults.skills.messaging,
        ...((current.skills || {}).messaging || {}),
      },
      identity: {
        ...defaults.skills.identity,
        ...((current.skills || {}).identity || {}),
      },
      btcL1ToUsdcx: {
        ...defaults.skills.btcL1ToUsdcx,
        ...((current.skills || {}).btcL1ToUsdcx || {}),
      },
      walletActions: {
        ...defaults.skills.walletActions,
        ...((current.skills || {}).walletActions || {}),
      },
      defiSimple: {
        ...defaults.skills.defiSimple,
        ...((current.skills || {}).defiSimple || {}),
      },
      blsm: {
        ...defaults.skills.blsm,
        ...((current.skills || {}).blsm || {}),
      },
      routeEvaluator: {
        ...defaults.skills.routeEvaluator,
        ...((current.skills || {}).routeEvaluator || {}),
      },
      bountyExecute: {
        ...defaults.skills.bountyExecute,
        ...((current.skills || {}).bountyExecute || {}),
      },
    },
    loop: { ...defaults.loop, ...(current.loop || {}) },
  };
}

function writeAgentState(state) {
  writeJson(AGENT_STATE_PATH, state);
}

function updateAgentState(mutator) {
  const current = readAgentState();
  const next = mutator({ ...current });
  writeAgentState(next);
  return next;
}

function writeAgentStatus(status) {
  writeJson(AGENT_STATUS_PATH, status);
}

function readAgentStatus() {
  return readJson(AGENT_STATUS_PATH, null);
}

function writeWatchdog(status) {
  writeJson(AGENT_WATCHDOG_PATH, status);
}

function readWatchdog() {
  return readJson(AGENT_WATCHDOG_PATH, null);
}

module.exports = {
  STATE_DIR,
  ensureDir,
  defaultAgentState,
  readAgentState,
  writeAgentState,
  updateAgentState,
  writeAgentStatus,
  readAgentStatus,
  writeWatchdog,
  readWatchdog,
};
