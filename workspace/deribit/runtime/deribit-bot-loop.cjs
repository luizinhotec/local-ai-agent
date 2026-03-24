#!/usr/bin/env node

const { connectWithRetry } = require('./lib/deribit-client.cjs');
const { fetchAndPersistPrivateSnapshot } = require('./lib/deribit-private-snapshot.cjs');
const { reconcileWithExchange } = require('./lib/deribit-reconcile.cjs');
const {
  summarizeOrder,
  summarizeTrades,
  lifecycleStatusFromOrderState,
  transitionExecutionAudit,
  inferAuditFromExchange,
  readOrCreateExecutionAudit,
} = require('./lib/deribit-execution-audit.cjs');
const { loadRiskConfig } = require('./lib/deribit-risk.cjs');
const { loadStrategyConfig } = require('./lib/deribit-strategy.cjs');
const { loadExecutionConfig } = require('./lib/deribit-execution.cjs');
const {
  loadBotConfig,
  getInitialBotState,
  markCycleStarted,
  markCycleSkipped,
  createCyclePlan,
  persistBotCycle,
  persistBotMetrics,
  logBotCycle,
  getCancelWindowState,
} = require('./lib/deribit-bot.cjs');
const { appendEvent, readBotState, readLatestExecutionAudit } = require('./lib/deribit-state-store.cjs');
const { loadCalibrationState } = require('./lib/deribit-calibration.cjs');
const {
  acquireProcessLock,
  DEFAULT_STALE_LOCK_MS,
} = require('./lib/deribit-process-lock.cjs');

function getStaleOrders(openOrders, maxOpenOrderAgeMs) {
  const now = Date.now();
  return (openOrders || []).filter(order => {
    const createdAt = Number(order.creation_timestamp || 0);
    if (!createdAt) {
      return false;
    }
    return now - createdAt > maxOpenOrderAgeMs;
  });
}

function readConfig() {
  return {
    environment: process.env.DERIBIT_ENVIRONMENT || 'testnet',
    currency: process.env.DERIBIT_CURRENCY || 'BTC',
    instrument: process.env.DERIBIT_INSTRUMENT || 'BTC-PERPETUAL',
    clientId: process.env.DERIBIT_CLIENT_ID || '',
    clientSecret: process.env.DERIBIT_CLIENT_SECRET || '',
  };
}

function parseArgs(argv) {
  const flags = {
    once: false,
    execute: false,
  };
  for (const arg of argv) {
    if (arg === '--once') {
      flags.once = true;
      continue;
    }
    if (arg === '--execute') {
      flags.execute = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Deribit bot loop

Usage:
  node workspace/deribit/runtime/deribit-bot-loop.cjs --once
  node workspace/deribit/runtime/deribit-bot-loop.cjs
  node workspace/deribit/runtime/deribit-bot-loop.cjs --execute
`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return flags;
}

async function sendOrder(environment, clientId, clientSecret, orderIntent) {
  const client = await connectWithRetry({ environment });
  try {
    await client.authenticate(clientId, clientSecret);
    const params = {
      instrument_name: orderIntent.instrumentName,
      amount: orderIntent.amount,
      type: orderIntent.type,
      price: orderIntent.price,
      label: orderIntent.label,
      post_only: orderIntent.postOnly,
      reduce_only: orderIntent.reduceOnly,
      time_in_force: orderIntent.timeInForce,
    };
    return orderIntent.direction === 'buy'
      ? await client.buy(params)
      : await client.sell(params);
  } finally {
    client.close();
  }
}

async function cancelOrders(environment, clientId, clientSecret, orders) {
  const client = await connectWithRetry({ environment });
  try {
    await client.authenticate(clientId, clientSecret);
    for (const order of orders) {
      await client.cancel(order.order_id);
      appendEvent({
        recordedAt: new Date().toISOString(),
        type: 'bot_cancel_stale_order',
        orderId: order.order_id,
        label: order.label || '',
      });
    }
  } finally {
    client.close();
  }
}

async function replaceReduceOrder(config, snapshot, orderIntent) {
  const client = await connectWithRetry({ environment: config.environment });
  try {
    await client.authenticate(config.clientId, config.clientSecret);
    const params = {
      instrument_name: orderIntent.instrumentName,
      amount: orderIntent.amount,
      type: orderIntent.type,
      price: orderIntent.price,
      label: orderIntent.label,
      post_only: orderIntent.postOnly,
      reduce_only: orderIntent.reduceOnly,
      time_in_force: orderIntent.timeInForce,
    };
    return orderIntent.direction === 'buy'
      ? await client.buy(params)
      : await client.sell(params);
  } finally {
    client.close();
  }
}

function generateCycleId() {
  return `cycle-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)}`;
}

function createCycleRuntime(cycleId = generateCycleId()) {
  return {
    cycleId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    skippedBecauseRunning: false,
    status: 'running',
    errorMessage: null,
  };
}

function finalizeCycleRuntime(cycleRuntime, updates = {}) {
  const finishedAt = updates.finishedAt || new Date().toISOString();
  const startedAtMs = new Date(cycleRuntime.startedAt).getTime();
  const finishedAtMs = new Date(finishedAt).getTime();
  cycleRuntime.finishedAt = finishedAt;
  cycleRuntime.durationMs =
    Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
      ? Math.max(0, finishedAtMs - startedAtMs)
      : null;
  cycleRuntime.skippedBecauseRunning = Boolean(updates.skippedBecauseRunning);
  cycleRuntime.status = updates.status || cycleRuntime.status || 'completed';
  cycleRuntime.errorMessage = updates.errorMessage || null;
  return cycleRuntime;
}

function isSameIntentWithinCycleWindow(botState, orderIntent, cycleRuntime) {
  if (!orderIntent || orderIntent.kind !== 'order' || !orderIntent.intentFingerprint) {
    return false;
  }
  if (!botState?.lastIntentFingerprint || !botState?.lastIntentCycleId) {
    return false;
  }
  return (
    botState.lastIntentFingerprint === orderIntent.intentFingerprint &&
    botState.lastIntentCycleId === cycleRuntime.cycleId
  );
}

function buildSnapshotContext(snapshot) {
  return {
    bestBid: snapshot.bestBid,
    bestAsk: snapshot.bestAsk,
    markPrice: snapshot.markPrice,
    indexPrice: snapshot.indexPrice,
    currentFunding: snapshot.currentFunding,
    accountEquity: snapshot.accountEquity,
    availableFunds: snapshot.availableFunds,
    positionDirection: snapshot.positionDirection,
    positionSizeUsd: snapshot.positionSizeUsd,
    positionPnlBtc: snapshot.positionPnl,
    directionalEdgeUsd:
      typeof snapshot.markPrice === 'number' && typeof snapshot.indexPrice === 'number'
        ? Number((snapshot.markPrice - snapshot.indexPrice).toFixed(4))
        : null,
  };
}

async function maybeAutoCalibrate(config, snapshot, botConfig) {
  if (!botConfig.autoCalibrateEnabled) {
    return;
  }
  if (snapshot.positionDirection !== 'flat' || Number(snapshot.openOrderCount || 0) > 0) {
    return;
  }
  const calibrationState = loadCalibrationState();
  const lastAppliedAt = calibrationState?.lastAppliedAt ? new Date(calibrationState.lastAppliedAt).getTime() : 0;
  if (lastAppliedAt && Date.now() - lastAppliedAt < botConfig.autoCalibrateMinIntervalMs) {
    return;
  }
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, [require('path').join(__dirname, 'deribit-auto-calibrate-strategy.cjs')], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status === 0 && result.stdout && result.stdout.includes('applied_patch:')) {
    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'strategy_calibration_checked',
      applied: true,
      output: result.stdout.trim(),
    });
  }
}

async function runCycle(config, runtimeFlags, cycleRuntime) {
  const riskConfig = loadRiskConfig();
  const strategyConfig = loadStrategyConfig();
  const executionConfig = loadExecutionConfig();
  const botConfig = loadBotConfig();
  const effectiveExecute = runtimeFlags.execute || botConfig.execute;
  const completeCycle = status =>
    finalizeCycleRuntime(cycleRuntime, {
      status,
    });

  const reconciled = await reconcileWithExchange(config, {
    cycleId: cycleRuntime.cycleId,
    recentTradesCount: 20,
  });
  const { snapshot, openOrders, reconciliation, tradeSummary, recentTrades } = reconciled;
  const cycle = createCyclePlan(
    snapshot,
    openOrders,
    riskConfig,
    strategyConfig,
    executionConfig,
    botConfig,
    { cycleId: cycleRuntime.cycleId }
  );

  console.log(`[${cycleRuntime.startedAt}] bot_cycle ${cycleRuntime.cycleId}`);
  console.log(`position: ${snapshot.positionDirection} ${snapshot.positionSizeUsd} USD`);
  console.log(`open_orders: ${snapshot.openOrderCount}`);
  console.log(`decision: ${cycle.decision.action} (${cycle.decision.executionMode})`);
  console.log(`mode: ${Math.abs(Number(snapshot.positionSizeUsd || 0)) > 0 ? 'position-management' : 'entry'}`);
  if (reconciliation.divergenceDetected) {
    console.log(`reconcile_divergence: ${reconciliation.divergenceType.join(', ')}`);
  }

  const existingExecutionAudit = readLatestExecutionAudit();
  if (existingExecutionAudit) {
    inferAuditFromExchange(existingExecutionAudit, reconciliation, recentTrades);
  }

  const staleOrders = getStaleOrders(openOrders, botConfig.maxOpenOrderAgeMs);
  const staleReduceOrders = staleOrders.filter(order => order.reduce_only);
  if (staleOrders.length > 0) {
    console.log(`stale_open_orders: ${staleOrders.length}`);
    const cancelWindowState = getCancelWindowState(cycle.botState, botConfig, Date.now());
    const lastCancelAt = cycle.botState?.lastCancelAt ? new Date(cycle.botState.lastCancelAt).getTime() : 0;
    const cancelCooldownActive =
      lastCancelAt && Date.now() - lastCancelAt < botConfig.cancelReplaceCooldownMs;
    const cancelLimitReached =
      cancelWindowState.count >= botConfig.maxCancelReplacePerWindow;

    if (cancelCooldownActive || cancelLimitReached) {
      const cancelBlockers = [];
      if (cancelCooldownActive) {
        cancelBlockers.push('cancel/replace cooldown active');
      }
      if (cancelLimitReached) {
        cancelBlockers.push('cancel/replace window limit reached');
      }
      console.log('blockers:');
      for (const blocker of cancelBlockers) {
        console.log(`- ${blocker}`);
      }
      completeCycle('completed');
      const metrics = persistBotMetrics(snapshot, {
        action: cycle.decision.action,
        lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
        realizedPnlBtc: tradeSummary.realizedPnl,
        feesBtc: tradeSummary.fees,
        avgFillPrice: tradeSummary.avgFillPrice,
        filledAmount: tradeSummary.filledAmount,
      }, false, cancelBlockers, cycleRuntime);
      persistBotCycle(cycle.botState, {
        action: cycle.decision.action,
        executionMode: cycle.decision.executionMode,
        direction: cycle.orderIntent.direction || cycle.decision.action,
        positionPnlBtc: snapshot.positionPnl,
        equityDeltaBtc: metrics.equityDeltaBtc,
        orderIntentFingerprint: cycle.orderIntent.intentFingerprint || null,
        orderLabel: cycle.orderIntent.label || null,
        reconciledAt: reconciliation.reconciledAt,
        lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
        divergenceDetected: reconciliation.divergenceDetected,
        divergenceType: reconciliation.divergenceType,
        unexpectedPositionOpen: reconciliation.unexpectedPositionOpen,
        partialFillDetected: reconciliation.partialFillDetected,
        realizedPnlBtc: tradeSummary.realizedPnl,
        feesBtc: tradeSummary.fees,
        avgFillPrice: tradeSummary.avgFillPrice,
        filledAmount: tradeSummary.filledAmount,
      }, false, botConfig, cycleRuntime);
      logBotCycle({
        cycleId: cycleRuntime.cycleId,
        startedAt: cycleRuntime.startedAt,
        finishedAt: cycleRuntime.finishedAt,
        durationMs: cycleRuntime.durationMs,
        skippedBecauseRunning: cycleRuntime.skippedBecauseRunning,
        action: cycle.decision.action,
        executed: false,
        blockers: cancelBlockers,
        reconciliation,
        snapshotContext: buildSnapshotContext(snapshot),
      });
      return;
    }

    if (effectiveExecute) {
      await cancelOrders(config.environment, config.clientId, config.clientSecret, staleOrders);
      const refreshed = await fetchAndPersistPrivateSnapshot(config);
      if (staleReduceOrders.length > 0 && refreshed.snapshot.positionDirection !== 'flat') {
        const refreshedCycle = createCyclePlan(
          refreshed.snapshot,
          refreshed.openOrders,
          riskConfig,
          strategyConfig,
          executionConfig,
          botConfig
        );
        if (refreshedCycle.decision.action === 'reduce' && refreshedCycle.orderIntent.kind === 'order') {
          const replacement = await replaceReduceOrder(config, refreshed.snapshot, refreshedCycle.orderIntent);
          appendEvent({
            recordedAt: new Date().toISOString(),
            type: 'bot_replace_reduce_order',
            action: refreshedCycle.decision.action,
            orderIntent: refreshedCycle.orderIntent,
            result: replacement,
          });
        }
      }
      completeCycle('completed');
      const metrics = persistBotMetrics(snapshot, {
        action: 'cancel_stale_orders',
        lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
        realizedPnlBtc: tradeSummary.realizedPnl,
        feesBtc: tradeSummary.fees,
        avgFillPrice: tradeSummary.avgFillPrice,
        filledAmount: tradeSummary.filledAmount,
      }, true, [], cycleRuntime);
      persistBotCycle(cycle.botState, {
        action: 'cancel_stale_orders',
        executionMode: 'maintenance',
        direction: 'none',
        positionPnlBtc: snapshot.positionPnl,
        equityDeltaBtc: metrics.equityDeltaBtc,
        reconciledAt: reconciliation.reconciledAt,
        lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
        divergenceDetected: reconciliation.divergenceDetected,
        divergenceType: reconciliation.divergenceType,
        unexpectedPositionOpen: reconciliation.unexpectedPositionOpen,
        partialFillDetected: reconciliation.partialFillDetected,
        realizedPnlBtc: tradeSummary.realizedPnl,
        feesBtc: tradeSummary.fees,
        avgFillPrice: tradeSummary.avgFillPrice,
        filledAmount: tradeSummary.filledAmount,
      }, true, botConfig, cycleRuntime);
      logBotCycle({
        cycleId: cycleRuntime.cycleId,
        startedAt: cycleRuntime.startedAt,
        finishedAt: cycleRuntime.finishedAt,
        durationMs: cycleRuntime.durationMs,
        skippedBecauseRunning: cycleRuntime.skippedBecauseRunning,
        action: 'cancel_stale_orders',
        executed: true,
        blockers: [],
        staleOrders: staleOrders.map(order => order.order_id),
        reconciliation,
        snapshotContext: buildSnapshotContext(snapshot),
      });
      await maybeAutoCalibrate(config, refreshed.snapshot, botConfig);
      return;
    }
  }

  if (!cycle.canExecute) {
    if (cycle.blockers.length > 0) {
      console.log('blockers:');
      for (const blocker of cycle.blockers) {
        console.log(`- ${blocker}`);
      }
    }
    if (cycle.blockers.includes('same_direction_reentry_blocked')) {
      appendEvent({
        recordedAt: new Date().toISOString(),
        type: 'same_direction_reentry_blocked',
        cycleId: cycleRuntime.cycleId,
        attemptedDirection: cycle.decision.action,
        activeRound: cycle.activeRound,
        snapshotContext: buildSnapshotContext(snapshot),
      });
    }
    completeCycle('completed');
    const metrics = persistBotMetrics(snapshot, {
      action: cycle.decision.action,
      lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
      realizedPnlBtc: tradeSummary.realizedPnl,
      feesBtc: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
    }, false, cycle.blockers, cycleRuntime);
    persistBotCycle(cycle.botState, {
      action: cycle.decision.action,
      executionMode: cycle.decision.executionMode,
      direction: cycle.orderIntent.direction || cycle.decision.action,
      positionPnlBtc: snapshot.positionPnl,
      equityDeltaBtc: metrics.equityDeltaBtc,
      orderIntentFingerprint: cycle.orderIntent.intentFingerprint || null,
      orderLabel: cycle.orderIntent.label || null,
      reconciledAt: reconciliation.reconciledAt,
      lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
      divergenceDetected: reconciliation.divergenceDetected,
      divergenceType: reconciliation.divergenceType,
      unexpectedPositionOpen: reconciliation.unexpectedPositionOpen,
      partialFillDetected: reconciliation.partialFillDetected,
      realizedPnlBtc: tradeSummary.realizedPnl,
      feesBtc: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
    }, false, botConfig, cycleRuntime);
    logBotCycle({
      cycleId: cycleRuntime.cycleId,
      startedAt: cycleRuntime.startedAt,
      finishedAt: cycleRuntime.finishedAt,
      durationMs: cycleRuntime.durationMs,
      skippedBecauseRunning: cycleRuntime.skippedBecauseRunning,
      action: cycle.decision.action,
      executed: false,
      blockers: cycle.blockers,
      reconciliation,
      snapshotContext: buildSnapshotContext(snapshot),
      activeRound: cycle.activeRound,
    });
    await maybeAutoCalibrate(config, snapshot, botConfig);
    return;
  }

  const executionAudit = readOrCreateExecutionAudit({
    cycleId: cycleRuntime.cycleId,
    orderIntent: cycle.orderIntent,
    snapshotContext: buildSnapshotContext(snapshot),
    source: 'bot-loop',
  });

  console.log(`order: ${cycle.orderIntent.direction} ${cycle.orderIntent.amount} @ ${cycle.orderIntent.price}`);
  console.log(`mode: ${effectiveExecute ? 'execute' : 'dry-run'}`);

  if (!effectiveExecute) {
    transitionExecutionAudit(executionAudit, 'intent_created', {
      note: 'dry-run cycle prepared execution intent',
      reconciliation,
    });
    completeCycle('completed');
    const metrics = persistBotMetrics(snapshot, {
      action: cycle.decision.action,
      lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
      realizedPnlBtc: tradeSummary.realizedPnl,
      feesBtc: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
    }, false, [], cycleRuntime);
    persistBotCycle(cycle.botState, {
      action: cycle.decision.action,
      executionMode: cycle.decision.executionMode,
      direction: cycle.orderIntent.direction || cycle.decision.action,
      positionPnlBtc: snapshot.positionPnl,
      equityDeltaBtc: metrics.equityDeltaBtc,
      orderIntentFingerprint: cycle.orderIntent.intentFingerprint || null,
      orderLabel: cycle.orderIntent.label || null,
      reconciledAt: reconciliation.reconciledAt,
      lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
      divergenceDetected: reconciliation.divergenceDetected,
      divergenceType: reconciliation.divergenceType,
      unexpectedPositionOpen: reconciliation.unexpectedPositionOpen,
      partialFillDetected: reconciliation.partialFillDetected,
      realizedPnlBtc: tradeSummary.realizedPnl,
      feesBtc: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
    }, false, botConfig, cycleRuntime);
    logBotCycle({
      cycleId: cycleRuntime.cycleId,
      startedAt: cycleRuntime.startedAt,
      finishedAt: cycleRuntime.finishedAt,
      durationMs: cycleRuntime.durationMs,
      skippedBecauseRunning: cycleRuntime.skippedBecauseRunning,
      action: cycle.decision.action,
      executed: false,
      blockers: [],
      dryRun: true,
      reconciliation,
      snapshotContext: buildSnapshotContext(snapshot),
    });
    await maybeAutoCalibrate(config, snapshot, botConfig);
    return;
  }

  const ambiguousExchangeOrders = reconciled.findAmbiguousExchangeOrders(cycle.orderIntent);
  if (ambiguousExchangeOrders.length > 0) {
    const ambiguousOrderBlockers = ['ambiguous open order state already exists on exchange'];
    console.log('blockers:');
    for (const blocker of ambiguousOrderBlockers) {
      console.log(`- ${blocker}`);
    }
    transitionExecutionAudit(executionAudit, 'failed', {
      note: 'execution blocked because ambiguous exchange orders exist',
      ambiguousExchangeOrders,
    });
    completeCycle('completed');
    const metrics = persistBotMetrics(snapshot, {
      action: cycle.decision.action,
      lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
      realizedPnlBtc: tradeSummary.realizedPnl,
      feesBtc: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
    }, false, ambiguousOrderBlockers, cycleRuntime);
    persistBotCycle(cycle.botState, {
      action: cycle.decision.action,
      executionMode: cycle.decision.executionMode,
      direction: cycle.orderIntent.direction || cycle.decision.action,
      positionPnlBtc: snapshot.positionPnl,
      equityDeltaBtc: metrics.equityDeltaBtc,
      orderIntentFingerprint: cycle.orderIntent.intentFingerprint || null,
      orderLabel: cycle.orderIntent.label || null,
      reconciledAt: reconciliation.reconciledAt,
      lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
      divergenceDetected: true,
      divergenceType: [...reconciliation.divergenceType, 'ambiguous_open_orders_on_exchange'],
      unexpectedPositionOpen: reconciliation.unexpectedPositionOpen,
      partialFillDetected: reconciliation.partialFillDetected,
      realizedPnlBtc: tradeSummary.realizedPnl,
      feesBtc: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
    }, false, botConfig, cycleRuntime);
    logBotCycle({
      cycleId: cycleRuntime.cycleId,
      startedAt: cycleRuntime.startedAt,
      finishedAt: cycleRuntime.finishedAt,
      durationMs: cycleRuntime.durationMs,
      skippedBecauseRunning: cycleRuntime.skippedBecauseRunning,
      action: cycle.decision.action,
      executed: false,
      blockers: ambiguousOrderBlockers,
      reconciliation,
      snapshotContext: buildSnapshotContext(snapshot),
    });
    return;
  }

  if (reconciled.hasConflictingExchangeOrder(cycle.orderIntent)) {
    const exchangeOrderBlockers = ['matching open order already exists on exchange'];
    console.log('blockers:');
    for (const blocker of exchangeOrderBlockers) {
      console.log(`- ${blocker}`);
    }
    transitionExecutionAudit(executionAudit, 'failed', {
      note: 'execution blocked because matching exchange order already exists',
    });
    completeCycle('completed');
    const metrics = persistBotMetrics(snapshot, {
      action: cycle.decision.action,
      lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
      realizedPnlBtc: tradeSummary.realizedPnl,
      feesBtc: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
    }, false, exchangeOrderBlockers, cycleRuntime);
    persistBotCycle(cycle.botState, {
      action: cycle.decision.action,
      executionMode: cycle.decision.executionMode,
      direction: cycle.orderIntent.direction || cycle.decision.action,
      positionPnlBtc: snapshot.positionPnl,
      equityDeltaBtc: metrics.equityDeltaBtc,
      orderIntentFingerprint: cycle.orderIntent.intentFingerprint || null,
      orderLabel: cycle.orderIntent.label || null,
      reconciledAt: reconciliation.reconciledAt,
      lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
      divergenceDetected: true,
      divergenceType: [...reconciliation.divergenceType, 'duplicate_open_order_on_exchange'],
      unexpectedPositionOpen: reconciliation.unexpectedPositionOpen,
      partialFillDetected: reconciliation.partialFillDetected,
      realizedPnlBtc: tradeSummary.realizedPnl,
      feesBtc: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
    }, false, botConfig, cycleRuntime);
    logBotCycle({
      cycleId: cycleRuntime.cycleId,
      startedAt: cycleRuntime.startedAt,
      finishedAt: cycleRuntime.finishedAt,
      durationMs: cycleRuntime.durationMs,
      skippedBecauseRunning: cycleRuntime.skippedBecauseRunning,
      action: cycle.decision.action,
      executed: false,
      blockers: exchangeOrderBlockers,
      reconciliation,
      snapshotContext: buildSnapshotContext(snapshot),
    });
    return;
  }

  if (isSameIntentWithinCycleWindow(cycle.botState, cycle.orderIntent, cycleRuntime)) {
    const idempotencyBlockers = ['duplicate order intent detected in the same cycle window'];
    console.log('blockers:');
    for (const blocker of idempotencyBlockers) {
      console.log(`- ${blocker}`);
    }
    transitionExecutionAudit(executionAudit, 'failed', {
      note: 'execution blocked because same intent was already emitted in the cycle window',
    });
    completeCycle('completed');
    const metrics = persistBotMetrics(snapshot, {
      action: cycle.decision.action,
      lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
      realizedPnlBtc: tradeSummary.realizedPnl,
      feesBtc: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
    }, false, idempotencyBlockers, cycleRuntime);
    persistBotCycle(cycle.botState, {
      action: cycle.decision.action,
      executionMode: cycle.decision.executionMode,
      direction: cycle.orderIntent.direction || cycle.decision.action,
      positionPnlBtc: snapshot.positionPnl,
      equityDeltaBtc: metrics.equityDeltaBtc,
      orderIntentFingerprint: cycle.orderIntent.intentFingerprint || null,
      orderLabel: cycle.orderIntent.label || null,
      reconciledAt: reconciliation.reconciledAt,
      lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
      divergenceDetected: reconciliation.divergenceDetected,
      divergenceType: reconciliation.divergenceType,
      unexpectedPositionOpen: reconciliation.unexpectedPositionOpen,
      partialFillDetected: reconciliation.partialFillDetected,
      realizedPnlBtc: tradeSummary.realizedPnl,
      feesBtc: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
    }, false, botConfig, cycleRuntime);
    logBotCycle({
      cycleId: cycleRuntime.cycleId,
      startedAt: cycleRuntime.startedAt,
      finishedAt: cycleRuntime.finishedAt,
      durationMs: cycleRuntime.durationMs,
      skippedBecauseRunning: cycleRuntime.skippedBecauseRunning,
      action: cycle.decision.action,
      executed: false,
      blockers: idempotencyBlockers,
      reconciliation,
      snapshotContext: buildSnapshotContext(snapshot),
    });
    return;
  }

  transitionExecutionAudit(executionAudit, 'sent', {
    sentAt: new Date().toISOString(),
    note: 'order submission sent to exchange',
  });

  const result = await sendOrder(
    config.environment,
    config.clientId,
    config.clientSecret,
    cycle.orderIntent
  );
  const exchangeOrder = summarizeOrder(result?.order);
  const exchangeTrades = recentTrades.filter(trade => {
    return (
      (exchangeOrder?.orderId && trade.order_id === exchangeOrder.orderId) ||
      (cycle.orderIntent.label && trade.label === cycle.orderIntent.label)
    );
  });
  const nextExecutionStatus = lifecycleStatusFromOrderState(
    exchangeOrder?.state,
    exchangeOrder?.filledAmount,
    exchangeOrder?.amount
  );
  transitionExecutionAudit(executionAudit, nextExecutionStatus, {
    acceptedAt: new Date().toISOString(),
    orderId: exchangeOrder?.orderId || executionAudit.orderId || null,
    orderLabel: exchangeOrder?.label || executionAudit.orderLabel || cycle.orderIntent.label,
    lastExchangeOrder: exchangeOrder,
    lastExchangeTradeSummary: summarizeTrades(exchangeTrades),
    openAt: nextExecutionStatus === 'open' ? new Date().toISOString() : executionAudit.openAt || null,
    partiallyFilledAt:
      nextExecutionStatus === 'partially_filled'
        ? new Date().toISOString()
        : executionAudit.partiallyFilledAt || null,
    filledAt:
      nextExecutionStatus === 'filled' ? new Date().toISOString() : executionAudit.filledAt || null,
    note: 'exchange acknowledged order submission',
  });
  appendEvent({
    recordedAt: new Date().toISOString(),
    type: 'bot_execution_sent',
    action: cycle.decision.action,
    orderIntent: cycle.orderIntent,
    snapshotContext: {
      ...buildSnapshotContext(snapshot),
    },
    result,
  });
  completeCycle('completed');
  const metrics = persistBotMetrics(snapshot, {
    action: cycle.decision.action,
    positionPnlBtc: snapshot.positionPnl,
    lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
    realizedPnlBtc: tradeSummary.realizedPnl,
    feesBtc: tradeSummary.fees,
    avgFillPrice: tradeSummary.avgFillPrice,
    filledAmount: tradeSummary.filledAmount,
  }, true, [], cycleRuntime);
  persistBotCycle(cycle.botState, {
    action: cycle.decision.action,
    executionMode: cycle.decision.executionMode,
    direction: cycle.orderIntent.direction || cycle.decision.action,
    positionPnlBtc: snapshot.positionPnl,
    equityDeltaBtc: metrics.equityDeltaBtc,
    orderIntentFingerprint: cycle.orderIntent.intentFingerprint || null,
    orderLabel: cycle.orderIntent.label || null,
    reconciledAt: reconciliation.reconciledAt,
    lastReconciledTradeSeq: tradeSummary.lastTradeSeq,
    divergenceDetected: reconciliation.divergenceDetected,
    divergenceType: reconciliation.divergenceType,
    unexpectedPositionOpen: reconciliation.unexpectedPositionOpen,
    partialFillDetected: reconciliation.partialFillDetected,
    realizedPnlBtc: tradeSummary.realizedPnl,
    feesBtc: tradeSummary.fees,
    avgFillPrice: tradeSummary.avgFillPrice,
    filledAmount: tradeSummary.filledAmount,
  }, true, botConfig, cycleRuntime);
  logBotCycle({
    cycleId: cycleRuntime.cycleId,
    startedAt: cycleRuntime.startedAt,
    finishedAt: cycleRuntime.finishedAt,
    durationMs: cycleRuntime.durationMs,
    skippedBecauseRunning: cycleRuntime.skippedBecauseRunning,
    action: cycle.decision.action,
    executed: true,
    blockers: [],
    orderId: result?.order?.order_id || '',
    reconciliation,
    snapshotContext: buildSnapshotContext(snapshot),
  });
  console.log(JSON.stringify(result, null, 2));
  await maybeAutoCalibrate(config, snapshot, botConfig);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const config = readConfig();
  if (!config.clientId || !config.clientSecret) {
    console.error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
    process.exit(1);
  }

  const botConfig = loadBotConfig();
  const staleAfterMs = Math.max(
    DEFAULT_STALE_LOCK_MS,
    Number(botConfig.loopIntervalMs || 0) * 8
  );
  const lockHeartbeatMs = Math.max(
    5000,
    Math.min(30000, Math.floor(staleAfterMs / 3))
  );
  let processLock = null;
  let lockHeartbeatTimer = null;
  let activeCycleRuntime = null;

  try {
    processLock = acquireProcessLock({
      staleAfterMs,
      scriptName: 'deribit-bot-loop.cjs',
      processName: 'deribit-bot-loop',
    });
  } catch (error) {
    if (error.code === 'LOCK_HELD') {
      const owner = error.lockMetadata || {};
      console.error('[deribit-bot-loop] external process lock is active');
      console.error(
        `[deribit-bot-loop] lock owner pid=${owner.pid || 'n/a'} host=${owner.hostname || 'n/a'} startedAt=${owner.startedAt || 'n/a'} updatedAt=${owner.updatedAt || 'n/a'}`
      );
      process.exit(11);
    }
    throw error;
  }

  const releaseProcessLock = reason => {
    if (!processLock) {
      return;
    }
    try {
      processLock.release(reason);
    } catch (error) {
      console.error(`[deribit-bot-loop] failed to release process lock: ${error.message}`);
    } finally {
      processLock = null;
    }
  };
  process.on('exit', () => {
    releaseProcessLock('released');
  });

  async function triggerCycle() {
    if (activeCycleRuntime) {
      const skippedCycleRuntime = finalizeCycleRuntime(createCycleRuntime(), {
        status: 'skipped',
        skippedBecauseRunning: true,
      });
      const currentBotState = readBotState() || getInitialBotState();
      const skippedState = markCycleSkipped(currentBotState, skippedCycleRuntime);
      persistBotMetrics(null, { action: 'hold' }, false, ['cycle already running'], skippedCycleRuntime);
      logBotCycle({
        cycleId: skippedCycleRuntime.cycleId,
        startedAt: skippedCycleRuntime.startedAt,
        finishedAt: skippedCycleRuntime.finishedAt,
        durationMs: skippedCycleRuntime.durationMs,
        skippedBecauseRunning: true,
        action: skippedState.lastAction || 'hold',
        executed: false,
        blockers: ['cycle already running'],
      });
      console.log(
        `[${skippedCycleRuntime.startedAt}] bot_cycle ${skippedCycleRuntime.cycleId} skipped because ${activeCycleRuntime.cycleId} is still running`
      );
      return;
    }

    const cycleRuntime = createCycleRuntime();
    activeCycleRuntime = cycleRuntime;
    const currentBotState = readBotState() || getInitialBotState();
    markCycleStarted(currentBotState, cycleRuntime);

    try {
      await runCycle(config, flags, cycleRuntime);
    } catch (error) {
      finalizeCycleRuntime(cycleRuntime, {
        status: 'failed',
        errorMessage: error.message,
      });
      const latestBotState = readBotState() || currentBotState;
      persistBotCycle(latestBotState, {
        action: latestBotState.lastAction || 'none',
        executionMode: latestBotState.lastExecutionMode || 'none',
        direction: latestBotState.lastEntryDirection || 'none',
      }, false, botConfig, cycleRuntime);
      logBotCycle({
        cycleId: cycleRuntime.cycleId,
        startedAt: cycleRuntime.startedAt,
        finishedAt: cycleRuntime.finishedAt,
        durationMs: cycleRuntime.durationMs,
        skippedBecauseRunning: false,
        action: latestBotState.lastAction || 'none',
        executed: false,
        blockers: [error.message],
      });
      throw error;
    } finally {
      if (activeCycleRuntime && activeCycleRuntime.cycleId === cycleRuntime.cycleId) {
        activeCycleRuntime = null;
      }
    }
  }

  if (flags.once) {
    try {
      await triggerCycle();
      return;
    } finally {
      releaseProcessLock('released');
    }
  }

  lockHeartbeatTimer = setInterval(() => {
    try {
      if (processLock) {
        processLock.refresh();
      }
    } catch (error) {
      console.error(`[deribit-bot-loop] failed to refresh process lock: ${error.message}`);
      releaseProcessLock('lost');
      process.exit(12);
    }
  }, lockHeartbeatMs);

  try {
    await triggerCycle();
  } catch (error) {
    if (lockHeartbeatTimer) {
      clearInterval(lockHeartbeatTimer);
      lockHeartbeatTimer = null;
    }
    releaseProcessLock('released');
    throw error;
  }
  const timer = setInterval(() => {
    triggerCycle().catch(error => {
      console.error(`[deribit-bot-loop] ${error.message}`);
    });
  }, botConfig.loopIntervalMs);

  const shutdown = () => {
    clearInterval(timer);
    if (lockHeartbeatTimer) {
      clearInterval(lockHeartbeatTimer);
      lockHeartbeatTimer = null;
    }
    releaseProcessLock('released');
    setTimeout(() => process.exit(0), 50);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error(`[deribit-bot-loop] ${error.message}`);
  process.exit(1);
});
