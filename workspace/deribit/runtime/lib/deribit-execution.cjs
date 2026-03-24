const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_EXECUTION_CONFIG = {
  environment: 'testnet',
  defaultOrderSizeUsd: 100,
  maxOrderSizeUsd: 250,
  labelPrefix: 'codex-deribit',
  postOnly: true,
  timeInForce: 'good_til_cancelled',
  allowProductionExecution: false,
};

const CRITICAL_EXIT_MODES = new Set([
  'stop-loss',
  'loss-timeout',
  'time-stop',
  'break-even-exit',
  'risk-reduction',
]);

function loadExecutionConfig() {
  const configPath = path.join(__dirname, '..', '..', 'config', 'deribit.execution.json');
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_EXECUTION_CONFIG };
  }

  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    ...DEFAULT_EXECUTION_CONFIG,
    ...fileConfig,
  };
}

function buildOrderLabel(prefix, action) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${prefix}-${action}-${timestamp}`;
}

function buildOrderIntentFingerprint(orderIntent) {
  const stablePayload = {
    kind: orderIntent?.kind || 'no-op',
    direction: orderIntent?.direction || 'none',
    instrumentName: orderIntent?.instrumentName || '',
    amount: Number(orderIntent?.amount || 0),
    type: orderIntent?.type || '',
    price: Number(orderIntent?.price || 0),
    postOnly: Boolean(orderIntent?.postOnly),
    reduceOnly: Boolean(orderIntent?.reduceOnly),
    timeInForce: orderIntent?.timeInForce || '',
    executionMode: orderIntent?.decision?.executionMode || 'none',
    action: orderIntent?.decision?.action || 'none',
  };
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(stablePayload))
    .digest('hex')
    .slice(0, 16);
}

function buildClientOrderId(prefix, orderIntent, cycleId) {
  if (!cycleId) {
    return null;
  }
  const safePrefix = String(prefix || 'codex-deribit').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 18);
  const fingerprint = buildOrderIntentFingerprint(orderIntent);
  const compactCycleId = String(cycleId || 'cycle').replace(/[^a-zA-Z0-9]/g, '').slice(-12);
  return `${safePrefix}-${compactCycleId}-${fingerprint}`.slice(0, 64);
}

function clampOrderSize(snapshot, strategyConfig, executionConfig) {
  const strategyMax = Number(strategyConfig?.maxPositionUsd) || executionConfig.maxOrderSizeUsd;
  return Math.min(
    Number(executionConfig.defaultOrderSizeUsd) || 0,
    Number(executionConfig.maxOrderSizeUsd) || 0,
    strategyMax
  );
}

function decideReduceDirection(snapshot) {
  if (snapshot?.positionDirection === 'buy') {
    return 'sell';
  }
  if (snapshot?.positionDirection === 'sell') {
    return 'buy';
  }
  return null;
}

function buildReduceExecutionPolicy(snapshot, decision) {
  const direction = decideReduceDirection(snapshot);
  const isCriticalExit = CRITICAL_EXIT_MODES.has(decision?.executionMode || '');
  if (!direction) {
    return null;
  }

  return {
    direction,
    type: 'limit',
    postOnly: false,
    reduceOnly: true,
    // Keep the exchange parameter set already used by the project; improve exit safety via price selection.
    timeInForce: 'good_til_cancelled',
    price: direction === 'sell' ? snapshot.bestBid : snapshot.bestAsk,
    lifecycleHint: isCriticalExit ? 'critical-exit' : 'managed-exit',
  };
}

function buildOrderIntent(snapshot, decision, strategyConfig, executionConfig, options = {}) {
  const sizeUsd = clampOrderSize(snapshot, strategyConfig, executionConfig);
  const baseIntent = {
    kind: 'order',
    direction: decision.action,
    amount: sizeUsd,
    instrumentName: snapshot.instrument,
    type: 'limit',
    postOnly: Boolean(executionConfig.postOnly),
    reduceOnly: false,
    timeInForce: executionConfig.timeInForce,
    price: decision.action === 'buy' ? snapshot.bestBid : snapshot.bestAsk,
    decision,
  };

  if (decision.action === 'hold') {
    return {
      kind: 'no-op',
      reason: 'decision action is hold',
      decision,
    };
  }

  if (decision.action === 'reduce') {
    const reducePolicy = buildReduceExecutionPolicy(snapshot, decision);
    if (!reducePolicy?.direction) {
      return {
        kind: 'no-op',
        reason: 'no active position to reduce',
        decision,
      };
    }

    const reduceIntent = {
      kind: 'order',
      direction: reducePolicy.direction,
      amount:
        decision.executionMode && decision.executionMode !== 'risk-reduction'
          ? Math.min(Math.abs(snapshot.positionSizeUsd || 0), sizeUsd)
          : Math.abs(snapshot.positionSizeUsd || 0),
      instrumentName: snapshot.instrument,
      type: reducePolicy.type,
      postOnly: reducePolicy.postOnly,
      reduceOnly: reducePolicy.reduceOnly,
      timeInForce: reducePolicy.timeInForce,
      price: reducePolicy.price,
      lifecycleHint: reducePolicy.lifecycleHint,
      decision,
    };
    const clientOrderId = buildClientOrderId(
      executionConfig.labelPrefix,
      reduceIntent,
      options.cycleId
    );
    return {
      ...reduceIntent,
      clientOrderId,
      intentFingerprint: buildOrderIntentFingerprint(reduceIntent),
      label: clientOrderId || buildOrderLabel(executionConfig.labelPrefix, decision.action),
    };
  }

  if (decision.action === 'buy' || decision.action === 'sell') {
    const clientOrderId = buildClientOrderId(
      executionConfig.labelPrefix,
      baseIntent,
      options.cycleId
    );
    return {
      ...baseIntent,
      clientOrderId,
      intentFingerprint: buildOrderIntentFingerprint(baseIntent),
      label: clientOrderId || buildOrderLabel(executionConfig.labelPrefix, decision.action),
    };
  }

  return {
    kind: 'no-op',
    reason: `unsupported decision action: ${decision.action}`,
    decision,
  };
}

function validateExecutionPreflight(snapshot, riskResult, decision, executionConfig, options = {}) {
  const errors = [];

  if (!snapshot?.authEnabled) {
    errors.push('authenticated private state is required for execution');
  }

  if (riskResult?.overallStatus === 'block') {
    errors.push('risk state is block');
  }

  if (decision?.executionMode === 'no-trade') {
    errors.push('decision execution mode is no-trade');
  }

  if (snapshot?.environment === 'production' && !executionConfig.allowProductionExecution && !options.allowProduction) {
    errors.push('production execution is disabled');
  }

  if (!snapshot?.instrument) {
    errors.push('instrument is unavailable');
  }

  if (typeof snapshot?.bestBid !== 'number' || typeof snapshot?.bestAsk !== 'number') {
    errors.push('best bid/ask unavailable');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  DEFAULT_EXECUTION_CONFIG,
  CRITICAL_EXIT_MODES,
  loadExecutionConfig,
  buildOrderIntentFingerprint,
  buildClientOrderId,
  buildReduceExecutionPolicy,
  buildOrderIntent,
  validateExecutionPreflight,
};
