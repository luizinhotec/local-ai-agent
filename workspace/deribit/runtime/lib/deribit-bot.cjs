const fs = require('fs');
const path = require('path');
const { evaluateRisk } = require('./deribit-risk.cjs');
const { decideAction } = require('./deribit-strategy.cjs');
const { buildOrderIntent, validateExecutionPreflight } = require('./deribit-execution.cjs');
const {
  appendEvent,
  writeBotState,
  readBotState,
  writeBotMetrics,
  readBotMetrics,
  readLatestExecutionAudit,
} = require('./deribit-state-store.cjs');

const DEFAULT_BOT_CONFIG = {
  loopIntervalMs: 15000,
  cooldownMs: 30000,
  entryCooldownMs: 30000,
  exitCooldownMs: 15000,
  takeProfitExitCooldownMs: 10000,
  breakEvenExitCooldownMs: 15000,
  lossTimeoutExitCooldownMs: 30000,
  stopLossExitCooldownMs: 45000,
  managedExitCooldownMs: 20000,
  maxActiveOpenOrders: 1,
  maxDirectionalPositionUsd: 200,
  reentryCooldownMs: 120000,
  postExitReentryCooldownMs: 90000,
  postTakeProfitReentryCooldownMs: 30000,
  postBreakEvenReentryCooldownMs: 60000,
  postLossTimeoutReentryCooldownMs: 120000,
  postStopLossReentryCooldownMs: 180000,
  maxOpenOrderAgeMs: 20000,
  cancelReplaceCooldownMs: 15000,
  cancelReplaceWindowMs: 300000,
  maxCancelReplacePerWindow: 3,
  postCancelEntryCooldownMs: 30000,
  pauseEntriesWhenReduceOrderPending: true,
  reduceOrderPendingPauseMs: 120000,
  losingPnlThresholdBtc: -0.0000001,
  winningPnlThresholdBtc: 0.0000001,
  maxConsecutiveLosingExits: 3,
  losingStreakPauseMs: 180000,
  cumulativeLossPauseBtc: 0.000001,
  cumulativeLossPauseMs: 300000,
  autoCalibrateEnabled: true,
  autoCalibrateMinClosedRounds: 30,
  autoCalibrateMinNewClosedRounds: 10,
  autoCalibrateMinIntervalMs: 300000,
  blockNewEntriesWhenPositionOpen: true,
  maintenanceMode: false,
  cancelBeforeNewEntry: false,
  execute: false,
};

function loadBotConfig() {
  const configPath = path.join(__dirname, '..', '..', 'config', 'deribit.bot.json');
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_BOT_CONFIG };
  }

  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    ...DEFAULT_BOT_CONFIG,
    ...fileConfig,
  };
}

function getInitialBotState() {
  return {
    lastCycleAt: null,
    activeCycleId: null,
    activeCycleStartedAt: null,
    lastCycleId: null,
    lastCycleStartedAt: null,
    lastCycleFinishedAt: null,
    lastCycleDurationMs: null,
    lastCycleSkippedBecauseRunning: false,
    skippedBecauseRunningCount: 0,
    lastCycleStatus: 'none',
    lastCycleError: null,
    lastExecutionAt: null,
    lastAction: 'none',
    lastExecutionMode: 'none',
    lastEntryAt: null,
    lastEntryDirection: 'none',
    lastExitAt: null,
    lastReduceAt: null,
    lastReduceReason: 'none',
    lastPositionPnlBtc: null,
    lastCancelAt: null,
    cancelReplaceCountWindow: 0,
    cancelReplaceWindowStartAt: null,
    consecutiveLosingExits: 0,
    consecutiveWinningExits: 0,
    pauseEntriesUntil: null,
    globalPauseUntil: null,
    lastIntentFingerprint: null,
    lastIntentCycleId: null,
    lastIntentAt: null,
    lastOrderLabel: null,
    lastReconciledAt: null,
    lastReconciledTradeSeq: 0,
    lastDivergenceDetected: false,
    lastDivergenceType: [],
    unexpectedPositionOpen: false,
    partialFillDetected: false,
    cycleCount: 0,
  };
}

function getInitialBotMetrics() {
  return {
    startedAt: new Date().toISOString(),
    updatedAt: null,
    cycleCount: 0,
    skippedBecauseRunningCount: 0,
    entryExecutions: 0,
    exitExecutions: 0,
    cancelExecutions: 0,
    dryRunCycles: 0,
    blockedCycles: 0,
    lastEquityBtc: null,
    baselineEquityBtc: null,
    equityDeltaBtc: null,
    estimatedRealizedPnlBtc: 0,
    lastCyclePnlBtc: null,
    lastReconciledTradeSeq: 0,
    lastRealizedPnlBtc: 0,
    cumulativeRealizedPnlBtc: 0,
    lastFeesBtc: 0,
    cumulativeFeesBtc: 0,
    lastAvgFillPrice: null,
    lastFilledAmount: 0,
  };
}

function isEntryAction(action) {
  return action === 'buy' || action === 'sell';
}

function isExitAction(action) {
  return action === 'reduce';
}

function getLastTimestampMs(value) {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function shouldRespectEntryCooldown(botState, botConfig, decisionAction) {
  if (!isEntryAction(decisionAction)) {
    return false;
  }
  const lastEntryAt = getLastTimestampMs(botState?.lastEntryAt || botState?.lastExecutionAt);
  if (!lastEntryAt) {
    return false;
  }
  return Date.now() - lastEntryAt < botConfig.entryCooldownMs;
}

function shouldRespectExitCooldown(botState, botConfig, decisionAction) {
  if (!isExitAction(decisionAction)) {
    return false;
  }
  const lastExitAt = getLastTimestampMs(botState?.lastExitAt || botState?.lastReduceAt);
  if (!lastExitAt) {
    return false;
  }
  return Date.now() - lastExitAt < getExitCooldownMs(botState, botConfig);
}

function shouldRespectReentryCooldown(botState, botConfig, decisionAction) {
  if (!botState?.lastEntryAt || !botState?.lastEntryDirection) {
    return false;
  }
  if (decisionAction !== botState.lastEntryDirection) {
    return false;
  }
  const lastEntryAt = new Date(botState.lastEntryAt).getTime();
  return Date.now() - lastEntryAt < botConfig.reentryCooldownMs;
}

function shouldRespectPostExitReentryCooldown(botState, botConfig, decisionAction) {
  if (!isEntryAction(decisionAction)) {
    return false;
  }
  const lastExitAt = getLastTimestampMs(botState?.lastExitAt);
  if (!lastExitAt) {
    return false;
  }
  return Date.now() - lastExitAt < getPostExitReentryCooldownMs(botState, botConfig);
}

function shouldRespectPostCancelEntryCooldown(botState, botConfig, decisionAction) {
  if (!isEntryAction(decisionAction)) {
    return false;
  }
  const lastCancelAt = getLastTimestampMs(botState?.lastCancelAt);
  if (!lastCancelAt) {
    return false;
  }
  return Date.now() - lastCancelAt < botConfig.postCancelEntryCooldownMs;
}

function shouldPauseEntriesAfterLossStreak(botState, decisionAction) {
  if (!isEntryAction(decisionAction)) {
    return false;
  }
  const pauseEntriesUntil = getLastTimestampMs(botState?.pauseEntriesUntil);
  if (!pauseEntriesUntil) {
    return false;
  }
  return Date.now() < pauseEntriesUntil;
}

function shouldPauseEntriesGlobally(botState, decisionAction) {
  if (!isEntryAction(decisionAction)) {
    return false;
  }
  const globalPauseUntil = getLastTimestampMs(botState?.globalPauseUntil);
  if (!globalPauseUntil) {
    return false;
  }
  return Date.now() < globalPauseUntil;
}

function getReducePendingAgeMs(openOrders) {
  const reduceOrders = (openOrders || []).filter(order => order.reduce_only);
  if (reduceOrders.length === 0) {
    return 0;
  }
  const oldestCreation = Math.min(...reduceOrders.map(order => Number(order.creation_timestamp || 0)).filter(Boolean));
  if (!oldestCreation) {
    return 0;
  }
  return Date.now() - oldestCreation;
}

function getExitCooldownMs(botState, botConfig) {
  switch (botState?.lastReduceReason) {
    case 'take-profit':
      return botConfig.takeProfitExitCooldownMs;
    case 'break-even-exit':
      return botConfig.breakEvenExitCooldownMs;
    case 'loss-timeout':
      return botConfig.lossTimeoutExitCooldownMs;
    case 'stop-loss':
      return botConfig.stopLossExitCooldownMs;
    case 'managed-exit':
      return botConfig.managedExitCooldownMs;
    default:
      return botConfig.exitCooldownMs;
  }
}

function getPostExitReentryCooldownMs(botState, botConfig) {
  switch (botState?.lastReduceReason) {
    case 'take-profit':
      return botConfig.postTakeProfitReentryCooldownMs;
    case 'break-even-exit':
      return botConfig.postBreakEvenReentryCooldownMs;
    case 'loss-timeout':
      return botConfig.postLossTimeoutReentryCooldownMs;
    case 'stop-loss':
      return botConfig.postStopLossReentryCooldownMs;
    default:
      return botConfig.postExitReentryCooldownMs;
  }
}

function getCancelWindowState(botState, botConfig, nowMs) {
  const windowStartMs = getLastTimestampMs(botState?.cancelReplaceWindowStartAt);
  const activeWindow =
    windowStartMs && nowMs - windowStartMs < botConfig.cancelReplaceWindowMs;
  return {
    count: activeWindow ? Number(botState?.cancelReplaceCountWindow || 0) : 0,
    windowStartAt: activeWindow ? botState.cancelReplaceWindowStartAt : null,
  };
}

function classifyExitResult(cycleSummary, botConfig) {
  const pnl = Number(cycleSummary?.positionPnlBtc);
  if (Number.isFinite(pnl)) {
    if (pnl <= botConfig.losingPnlThresholdBtc) {
      return 'loss';
    }
    if (pnl >= botConfig.winningPnlThresholdBtc) {
      return 'win';
    }
  }
  if (cycleSummary?.executionMode === 'stop-loss' || cycleSummary?.executionMode === 'loss-timeout') {
    return 'loss';
  }
  if (cycleSummary?.executionMode === 'take-profit' || cycleSummary?.executionMode === 'managed-exit') {
    return 'win';
  }
  return 'flat';
}

function buildActiveRoundContext(snapshot, openOrders, botState) {
  const positionDirection = snapshot?.positionDirection || 'flat';
  const positionSizeUsd = Math.abs(Number(snapshot?.positionSizeUsd || 0));
  const reduceOpenOrders = (openOrders || []).filter(order => order.reduce_only);
  const entryOpenOrders = (openOrders || []).filter(order => !order.reduce_only);
  const latestExecutionAudit = readLatestExecutionAudit();
  const auditDirection = latestExecutionAudit?.direction || null;
  const auditStatus = latestExecutionAudit?.status || null;
  const auditLifecycleHint = latestExecutionAudit?.lifecycleHint || null;
  const auditActive =
    auditLifecycleHint === 'entry' &&
    ['intent_created', 'sent', 'accepted', 'open', 'partially_filled'].includes(auditStatus);

  const hasPosition = positionDirection !== 'flat' && positionSizeUsd > 0;
  const hasReducePending = reduceOpenOrders.length > 0;
  const hasEntryPending = entryOpenOrders.length > 0;
  const hasActiveRound = hasPosition || hasReducePending || hasEntryPending || auditActive;
  const activeDirection =
    hasPosition
      ? positionDirection
      : (entryOpenOrders[0]?.direction || auditDirection || botState?.lastEntryDirection || 'none');

  return {
    hasActiveRound,
    activeDirection,
    hasPosition,
    hasReducePending,
    hasEntryPending,
    positionSizeUsd,
    latestExecutionAudit: latestExecutionAudit
      ? {
          status: auditStatus,
          direction: auditDirection,
          lifecycleHint: auditLifecycleHint,
          intendedAmount: latestExecutionAudit.intendedAmount || null,
          orderLabel: latestExecutionAudit.orderLabel || null,
        }
      : null,
  };
}

function createCyclePlan(
  snapshot,
  openOrders,
  riskConfig,
  strategyConfig,
  executionConfig,
  botConfig,
  options = {}
) {
  const botState = readBotState() || getInitialBotState();
  const riskResult = evaluateRisk(snapshot, riskConfig);
  const decision = decideAction(snapshot, riskResult, strategyConfig, { botState });
  const preflight = validateExecutionPreflight(
    snapshot,
    riskResult,
    decision,
    executionConfig,
    {}
  );
  const orderIntent = buildOrderIntent(snapshot, decision, strategyConfig, executionConfig, {
    cycleId: options.cycleId,
  });
  const activeOpenOrders = Number(snapshot.openOrderCount || 0);
  const reduceOpenOrders = (openOrders || []).filter(order => order.reduce_only);
  const entryOpenOrders = (openOrders || []).filter(order => !order.reduce_only);
  const activeReduceOrderCount = reduceOpenOrders.length;
  const activeEntryOrderCount = entryOpenOrders.length;
  const directionalPositionUsd = Math.abs(Number(snapshot.positionSizeUsd || 0));
  const hasOpenPosition = directionalPositionUsd > 0;
  const activeRound = buildActiveRoundContext(snapshot, openOrders, botState);
  const blockers = [];
  const managementActions = [];

  if (botConfig.maintenanceMode) {
    blockers.push('maintenance mode enabled');
  }

  if (shouldRespectEntryCooldown(botState, botConfig, decision.action)) {
    blockers.push('entry cooldown active');
  }

  if (shouldRespectExitCooldown(botState, botConfig, decision.action)) {
    blockers.push('exit cooldown active');
  }

  if (shouldRespectReentryCooldown(botState, botConfig, decision.action)) {
    blockers.push('same-side reentry cooldown active');
  }

  if (shouldRespectPostExitReentryCooldown(botState, botConfig, decision.action)) {
    blockers.push('post-exit reentry cooldown active');
  }

  if (shouldRespectPostCancelEntryCooldown(botState, botConfig, decision.action)) {
    blockers.push('post-cancel entry cooldown active');
  }

  if (shouldPauseEntriesAfterLossStreak(botState, decision.action)) {
    blockers.push('entry pause after losing streak active');
  }

  if (shouldPauseEntriesGlobally(botState, decision.action)) {
    blockers.push('global entry pause active');
  }

  const reducePendingAgeMs = getReducePendingAgeMs(openOrders);
  if (
    botConfig.pauseEntriesWhenReduceOrderPending &&
    isEntryAction(decision.action) &&
    activeReduceOrderCount > 0
  ) {
    blockers.push('entry paused while reduce order is pending');
  }

  if (activeEntryOrderCount >= botConfig.maxActiveOpenOrders) {
    blockers.push('max active open orders reached');
  }

  if (isExitAction(decision.action) && activeReduceOrderCount > 0) {
    blockers.push('reduce order already pending');
  }

  if (
    (decision.action === 'buy' || decision.action === 'sell') &&
    directionalPositionUsd >= botConfig.maxDirectionalPositionUsd
  ) {
    blockers.push('max directional position reached');
  }

  if (
    botConfig.blockNewEntriesWhenPositionOpen &&
    hasOpenPosition &&
    (decision.action === 'buy' || decision.action === 'sell')
  ) {
    blockers.push('new entry blocked while position is open');
  }

  if (
    isEntryAction(decision.action) &&
    activeRound.hasActiveRound &&
    activeRound.activeDirection === decision.action
  ) {
    blockers.push('same_direction_reentry_blocked');
  }

  if (!preflight.ok) {
    blockers.push(...preflight.errors);
  }

  if (activeOpenOrders > 0 && botConfig.maxOpenOrderAgeMs > 0) {
    managementActions.push('review_open_orders');
  }

  return {
    cycleId: options.cycleId || null,
    riskResult,
    decision,
    orderIntent,
    botState,
    blockers,
    managementActions,
    reducePendingAgeMs,
    activeReduceOrderCount,
    activeEntryOrderCount,
    activeRound,
    canExecute: blockers.length === 0 && orderIntent.kind === 'order',
  };
}

function markCycleStarted(botState, cycleRuntime) {
  const nextState = {
    ...botState,
    lastCycleAt: cycleRuntime.startedAt,
    activeCycleId: cycleRuntime.cycleId,
    activeCycleStartedAt: cycleRuntime.startedAt,
    lastCycleId: cycleRuntime.cycleId,
    lastCycleStartedAt: cycleRuntime.startedAt,
    lastCycleFinishedAt: null,
    lastCycleDurationMs: null,
    lastCycleSkippedBecauseRunning: false,
    lastCycleStatus: 'running',
    lastCycleError: null,
  };
  writeBotState(nextState);
  return nextState;
}

function markCycleSkipped(botState, cycleRuntime) {
  const nextState = {
    ...botState,
    lastCycleAt: cycleRuntime.startedAt,
    lastCycleId: cycleRuntime.cycleId,
    lastCycleStartedAt: cycleRuntime.startedAt,
    lastCycleFinishedAt: cycleRuntime.finishedAt,
    lastCycleDurationMs: cycleRuntime.durationMs,
    lastCycleSkippedBecauseRunning: true,
    skippedBecauseRunningCount: Number(botState?.skippedBecauseRunningCount || 0) + 1,
    lastCycleStatus: 'skipped',
    lastCycleError: null,
  };
  writeBotState(nextState);
  return nextState;
}

function persistBotCycle(
  botState,
  cycleSummary,
  executed,
  botConfig = DEFAULT_BOT_CONFIG,
  cycleRuntime = {}
) {
  const action = cycleSummary?.action || 'none';
  const executionMode = cycleSummary?.executionMode || 'none';
  const direction = cycleSummary?.direction || 'none';
  const now = cycleRuntime.finishedAt || new Date().toISOString();
  const nowMs = Date.now();
  const entryAction = isEntryAction(action);
  const exitAction = isExitAction(action);
  const cancelAction = action === 'cancel_stale_orders';
  const cancelWindowState = getCancelWindowState(botState, botConfig, nowMs);
  let consecutiveLosingExits = Number(botState.consecutiveLosingExits || 0);
  let consecutiveWinningExits = Number(botState.consecutiveWinningExits || 0);
  let pauseEntriesUntil = botState.pauseEntriesUntil || null;
  let globalPauseUntil = botState.globalPauseUntil || null;

  if (executed && exitAction) {
    const exitResult = classifyExitResult(cycleSummary, botConfig);
    if (exitResult === 'loss') {
      consecutiveLosingExits += 1;
      consecutiveWinningExits = 0;
      if (consecutiveLosingExits >= botConfig.maxConsecutiveLosingExits) {
        pauseEntriesUntil = new Date(nowMs + botConfig.losingStreakPauseMs).toISOString();
      }
    } else if (exitResult === 'win') {
      consecutiveLosingExits = 0;
      consecutiveWinningExits += 1;
      pauseEntriesUntil = null;
    } else {
      consecutiveWinningExits = 0;
    }
  }

  if (executed && entryAction) {
    pauseEntriesUntil = botState.pauseEntriesUntil || null;
  }

  if (executed && typeof cycleSummary?.equityDeltaBtc === 'number') {
    if (cycleSummary.equityDeltaBtc <= -Math.abs(botConfig.cumulativeLossPauseBtc)) {
      globalPauseUntil = new Date(nowMs + botConfig.cumulativeLossPauseMs).toISOString();
    }
  }

  const nextState = {
    lastCycleAt: now,
    activeCycleId: null,
    activeCycleStartedAt: null,
    lastCycleId: cycleRuntime.cycleId || botState.lastCycleId || null,
    lastCycleStartedAt: cycleRuntime.startedAt || botState.lastCycleStartedAt || botState.lastCycleAt || now,
    lastCycleFinishedAt: now,
    lastCycleDurationMs:
      typeof cycleRuntime.durationMs === 'number'
        ? cycleRuntime.durationMs
        : botState.lastCycleDurationMs ?? null,
    lastCycleSkippedBecauseRunning: Boolean(cycleRuntime.skippedBecauseRunning),
    lastCycleStatus: cycleRuntime.status || (executed ? 'completed' : 'completed'),
    lastCycleError: cycleRuntime.errorMessage || null,
    lastExecutionAt: executed ? now : botState.lastExecutionAt || null,
    lastAction: action,
    lastExecutionMode: executed ? executionMode : botState.lastExecutionMode || 'none',
    lastEntryAt: executed && entryAction ? now : botState.lastEntryAt || null,
    lastEntryDirection: executed && entryAction ? direction : botState.lastEntryDirection || 'none',
    lastExitAt: executed && exitAction ? now : botState.lastExitAt || null,
    lastReduceAt: executed && exitAction ? now : botState.lastReduceAt || null,
    lastReduceReason: executed && exitAction ? executionMode : botState.lastReduceReason || 'none',
    lastPositionPnlBtc:
      executed && typeof cycleSummary?.positionPnlBtc === 'number'
        ? cycleSummary.positionPnlBtc
        : botState.lastPositionPnlBtc ?? null,
    lastCancelAt: executed && cancelAction ? now : botState.lastCancelAt || null,
    cancelReplaceCountWindow:
      executed && cancelAction
        ? cancelWindowState.count + 1
        : cancelWindowState.count,
    cancelReplaceWindowStartAt:
      executed && cancelAction
        ? cancelWindowState.windowStartAt || now
        : cancelWindowState.windowStartAt,
    consecutiveLosingExits,
    consecutiveWinningExits,
    pauseEntriesUntil,
    globalPauseUntil,
    lastIntentFingerprint:
      cycleSummary?.orderIntentFingerprint || botState.lastIntentFingerprint || null,
    lastIntentCycleId:
      cycleSummary?.orderIntentFingerprint
        ? cycleRuntime.cycleId || botState.lastIntentCycleId || null
        : botState.lastIntentCycleId || null,
    lastIntentAt:
      cycleSummary?.orderIntentFingerprint ? now : botState.lastIntentAt || null,
    lastOrderLabel:
      cycleSummary?.orderLabel || botState.lastOrderLabel || null,
    lastReconciledAt:
      cycleSummary?.reconciledAt || botState.lastReconciledAt || null,
    lastReconciledTradeSeq:
      typeof cycleSummary?.lastReconciledTradeSeq === 'number'
        ? cycleSummary.lastReconciledTradeSeq
        : Number(botState.lastReconciledTradeSeq || 0),
    lastDivergenceDetected:
      typeof cycleSummary?.divergenceDetected === 'boolean'
        ? cycleSummary.divergenceDetected
        : Boolean(botState.lastDivergenceDetected),
    lastDivergenceType:
      Array.isArray(cycleSummary?.divergenceType)
        ? cycleSummary.divergenceType
        : botState.lastDivergenceType || [],
    unexpectedPositionOpen:
      typeof cycleSummary?.unexpectedPositionOpen === 'boolean'
        ? cycleSummary.unexpectedPositionOpen
        : Boolean(botState.unexpectedPositionOpen),
    partialFillDetected:
      typeof cycleSummary?.partialFillDetected === 'boolean'
        ? cycleSummary.partialFillDetected
        : Boolean(botState.partialFillDetected),
    cycleCount: Number(botState.cycleCount || 0) + 1,
  };
  writeBotState(nextState);
  return nextState;
}

function persistBotMetrics(snapshot, cycleSummary, executed, blockers = [], cycleRuntime = {}) {
  const previous = readBotMetrics() || getInitialBotMetrics();
  const isEntry = isEntryAction(cycleSummary?.action);
  const isExit = isExitAction(cycleSummary?.action);
  const isCancel = cycleSummary?.action === 'cancel_stale_orders';
  const baselineEquityBtc =
    typeof previous.baselineEquityBtc === 'number'
      ? previous.baselineEquityBtc
      : Number(snapshot?.accountEquity ?? 0);
  const currentEquityBtc =
    typeof snapshot?.accountEquity === 'number' ? Number(snapshot.accountEquity) : previous.lastEquityBtc;
  const lastEquityBtc =
    typeof previous.lastEquityBtc === 'number' ? previous.lastEquityBtc : currentEquityBtc;
  const lastCyclePnlBtc =
    typeof currentEquityBtc === 'number' && typeof lastEquityBtc === 'number'
      ? Number((currentEquityBtc - lastEquityBtc).toFixed(8))
      : null;
  const estimatedRealizedPnlBtc =
    Number(previous.estimatedRealizedPnlBtc || 0) +
    (executed && isExit && typeof cycleSummary?.positionPnlBtc === 'number'
      ? Number(cycleSummary.positionPnlBtc)
      : 0);
  const equityDeltaBtc =
    typeof currentEquityBtc === 'number'
      ? Number((currentEquityBtc - baselineEquityBtc).toFixed(8))
      : previous.equityDeltaBtc;
  const lastReconciledTradeSeq =
    typeof cycleSummary?.lastReconciledTradeSeq === 'number'
      ? cycleSummary.lastReconciledTradeSeq
      : Number(previous.lastReconciledTradeSeq || 0);
  const lastRealizedPnlBtc =
    typeof cycleSummary?.realizedPnlBtc === 'number'
      ? Number(cycleSummary.realizedPnlBtc.toFixed(8))
      : Number(previous.lastRealizedPnlBtc || 0);
  const lastFeesBtc =
    typeof cycleSummary?.feesBtc === 'number'
      ? Number(cycleSummary.feesBtc.toFixed(8))
      : Number(previous.lastFeesBtc || 0);
  const lastAvgFillPrice =
    typeof cycleSummary?.avgFillPrice === 'number'
      ? cycleSummary.avgFillPrice
      : previous.lastAvgFillPrice ?? null;
  const lastFilledAmount =
    typeof cycleSummary?.filledAmount === 'number'
      ? cycleSummary.filledAmount
      : Number(previous.lastFilledAmount || 0);
  const cumulativeRealizedPnlBtc =
    Number(previous.cumulativeRealizedPnlBtc || 0) +
    (typeof cycleSummary?.realizedPnlBtc === 'number' ? Number(cycleSummary.realizedPnlBtc) : 0);
  const cumulativeFeesBtc =
    Number(previous.cumulativeFeesBtc || 0) +
    (typeof cycleSummary?.feesBtc === 'number' ? Number(cycleSummary.feesBtc) : 0);
  const nextMetrics = {
    startedAt: previous.startedAt,
    updatedAt: cycleRuntime.finishedAt || new Date().toISOString(),
    cycleCount: Number(previous.cycleCount || 0) + 1,
    skippedBecauseRunningCount:
      Number(previous.skippedBecauseRunningCount || 0) +
      (cycleRuntime.skippedBecauseRunning ? 1 : 0),
    entryExecutions: Number(previous.entryExecutions || 0) + (executed && isEntry ? 1 : 0),
    exitExecutions: Number(previous.exitExecutions || 0) + (executed && isExit ? 1 : 0),
    cancelExecutions: Number(previous.cancelExecutions || 0) + (executed && isCancel ? 1 : 0),
    dryRunCycles: Number(previous.dryRunCycles || 0) + (!executed && blockers.length === 0 ? 1 : 0),
    blockedCycles: Number(previous.blockedCycles || 0) + (blockers.length > 0 ? 1 : 0),
    lastEquityBtc: currentEquityBtc,
    baselineEquityBtc,
    equityDeltaBtc,
    estimatedRealizedPnlBtc: Number(estimatedRealizedPnlBtc.toFixed(8)),
    lastCyclePnlBtc,
    lastReconciledTradeSeq,
    lastRealizedPnlBtc,
    cumulativeRealizedPnlBtc: Number(cumulativeRealizedPnlBtc.toFixed(8)),
    lastFeesBtc,
    cumulativeFeesBtc: Number(cumulativeFeesBtc.toFixed(8)),
    lastAvgFillPrice,
    lastFilledAmount,
  };
  writeBotMetrics(nextMetrics);
  return nextMetrics;
}

function logBotCycle(summary) {
  appendEvent({
    recordedAt: new Date().toISOString(),
    type: 'bot_cycle',
    summary,
  });
}

module.exports = {
  DEFAULT_BOT_CONFIG,
  loadBotConfig,
  getInitialBotState,
  markCycleStarted,
  markCycleSkipped,
  createCyclePlan,
  persistBotCycle,
  persistBotMetrics,
  logBotCycle,
  getCancelWindowState,
};
