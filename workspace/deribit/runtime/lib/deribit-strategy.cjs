const fs = require('fs');
const path = require('path');
const { writeLatestDecision } = require('./deribit-state-store.cjs');

const DEFAULT_STRATEGY_CONFIG = {
  objective: 'accumulate_sats',
  allowLong: true,
  allowShort: true,
  makerOnlyEntry: true,
  manageOpenPosition: true,
  reduceOnAdverseFunding: true,
  takeProfitBtc: 0.0000005,
  stopLossBtc: 0.000001,
  breakEvenHoldMs: 45000,
  breakEvenToleranceBtc: 0.0000001,
  lossTimeoutHoldMs: 90000,
  lossTimeoutMaxLossBtc: 0.0000005,
  softExitHoldMs: 60000,
  softExitMinPnlBtc: 0,
  maxPositionHoldMs: 180000,
  maxSpreadForEntryUsd: 1.5,
  maxMarkIndexGapForEntryUsd: 10,
  shortEntryPremiumUsd: 14,
  longEntryDiscountUsd: 14,
  minDirectionalEdgeUsd: 12,
  maxFundingAbsForEntry: 0.0002,
  entryConfidenceThreshold: 0.63,
  preferHoldWhenUnauthenticated: true,
  maxPositionUsd: 1000,
};

function loadStrategyConfig() {
  const configPath = path.join(__dirname, '..', '..', 'config', 'deribit.strategy.json');
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_STRATEGY_CONFIG };
  }

  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    ...DEFAULT_STRATEGY_CONFIG,
    ...fileConfig,
  };
}

function computeInputs(snapshot) {
  const spreadUsd =
    typeof snapshot?.bestAsk === 'number' && typeof snapshot?.bestBid === 'number'
      ? snapshot.bestAsk - snapshot.bestBid
      : null;
  const markIndexGapUsd =
    typeof snapshot?.markPrice === 'number' && typeof snapshot?.indexPrice === 'number'
      ? Math.abs(snapshot.markPrice - snapshot.indexPrice)
      : null;
  const fundingAbs =
    typeof snapshot?.currentFunding === 'number' ? Math.abs(snapshot.currentFunding) : null;
  const directionalEdgeUsd =
    typeof snapshot?.markPrice === 'number' && typeof snapshot?.indexPrice === 'number'
      ? snapshot.markPrice - snapshot.indexPrice
      : null;
  const markAboveIndex =
    typeof snapshot?.markPrice === 'number' &&
    typeof snapshot?.indexPrice === 'number' &&
    snapshot.markPrice > snapshot.indexPrice;

  return {
    spreadUsd,
    markIndexGapUsd,
    fundingAbs,
    directionalEdgeUsd,
    markAboveIndex,
  };
}

function decideAction(snapshot, riskResult, strategyConfig, context = {}) {
  const inputs = computeInputs(snapshot);
  const reasons = [];
  const blockers = [];
  const warnings = [];
  const positionAbsUsd =
    typeof snapshot?.positionSizeUsd === 'number' ? Math.abs(snapshot.positionSizeUsd) : 0;

  if (riskResult?.overallStatus === 'block') {
    blockers.push('risk engine is in block state');
  }

  if (strategyConfig.preferHoldWhenUnauthenticated && !snapshot?.authEnabled) {
    warnings.push('private account state unavailable');
  }

  if (inputs.spreadUsd === null || inputs.spreadUsd > strategyConfig.maxSpreadForEntryUsd) {
    warnings.push('spread is not suitable for entry');
  }

  if (
    inputs.markIndexGapUsd === null ||
    inputs.markIndexGapUsd > strategyConfig.maxMarkIndexGapForEntryUsd
  ) {
    warnings.push('mark/index gap is not suitable for entry');
  }

  if (
    inputs.directionalEdgeUsd === null ||
    Math.abs(inputs.directionalEdgeUsd) < strategyConfig.minDirectionalEdgeUsd
  ) {
    warnings.push('directional edge is too small for entry');
  }

  if (
    inputs.fundingAbs === null ||
    inputs.fundingAbs > strategyConfig.maxFundingAbsForEntry
  ) {
    warnings.push('funding is not suitable for entry');
  }

  if (positionAbsUsd > strategyConfig.maxPositionUsd) {
    blockers.push('position already exceeds strategy max size');
  }

  let confidence = 0.5;
  const hasOpenPosition = positionAbsUsd > 0;
  const positionPnlBtc =
    typeof snapshot?.positionPnl === 'number' ? snapshot.positionPnl : null;
  const lastEntryAt = context?.botState?.lastEntryAt
    ? new Date(context.botState.lastEntryAt).getTime()
    : 0;
  const holdMs = lastEntryAt ? Date.now() - lastEntryAt : 0;

  if (inputs.spreadUsd !== null && inputs.spreadUsd <= strategyConfig.maxSpreadForEntryUsd) {
    confidence += 0.1;
    reasons.push('tight spread');
  }

  if (
    inputs.markIndexGapUsd !== null &&
    inputs.markIndexGapUsd <= strategyConfig.maxMarkIndexGapForEntryUsd
  ) {
    confidence += 0.1;
    reasons.push('controlled mark/index deviation');
  }

  if (
    inputs.directionalEdgeUsd !== null &&
    Math.abs(inputs.directionalEdgeUsd) >= strategyConfig.minDirectionalEdgeUsd
  ) {
    confidence += 0.1;
    reasons.push('directional edge above minimum threshold');
  }

  if (
    inputs.fundingAbs !== null &&
    inputs.fundingAbs <= strategyConfig.maxFundingAbsForEntry
  ) {
    confidence += 0.05;
    reasons.push('funding within strategy band');
  }

  if (snapshot?.authEnabled) {
    confidence += 0.05;
    reasons.push('private state available');
  }

  if (blockers.length > 0) {
    const result = {
      decidedAt: new Date().toISOString(),
      objective: strategyConfig.objective,
      action: positionAbsUsd > 0 ? 'reduce' : 'hold',
      confidence: Number(confidence.toFixed(2)),
      reasons,
      blockers,
      warnings,
      executionMode: 'no-trade',
    };
    writeLatestDecision(result);
    return result;
  }

  if (hasOpenPosition && strategyConfig.manageOpenPosition) {
    if (
      positionPnlBtc !== null &&
      positionPnlBtc >= strategyConfig.takeProfitBtc
    ) {
      reasons.push('take profit threshold reached');
      const result = {
        decidedAt: new Date().toISOString(),
        objective: strategyConfig.objective,
        action: 'reduce',
        confidence: Number(confidence.toFixed(2)),
        reasons,
        blockers,
        warnings,
        executionMode: 'take-profit',
      };
      writeLatestDecision(result);
      return result;
    }

    if (
      positionPnlBtc !== null &&
      positionPnlBtc <= -Math.abs(strategyConfig.stopLossBtc)
    ) {
      reasons.push('stop loss threshold reached');
      const result = {
        decidedAt: new Date().toISOString(),
        objective: strategyConfig.objective,
        action: 'reduce',
        confidence: Number(confidence.toFixed(2)),
        reasons,
        blockers,
        warnings,
        executionMode: 'stop-loss',
      };
      writeLatestDecision(result);
      return result;
    }

    if (
      holdMs &&
      holdMs >= strategyConfig.breakEvenHoldMs &&
      positionPnlBtc !== null &&
      positionPnlBtc >= -Math.abs(strategyConfig.breakEvenToleranceBtc)
    ) {
      reasons.push('break-even exit threshold reached');
      const result = {
        decidedAt: new Date().toISOString(),
        objective: strategyConfig.objective,
        action: 'reduce',
        confidence: Number(confidence.toFixed(2)),
        reasons,
        blockers,
        warnings,
        executionMode: 'break-even-exit',
      };
      writeLatestDecision(result);
      return result;
    }

    if (
      holdMs &&
      holdMs >= strategyConfig.lossTimeoutHoldMs &&
      positionPnlBtc !== null &&
      positionPnlBtc <= 0 &&
      positionPnlBtc >= -Math.abs(strategyConfig.lossTimeoutMaxLossBtc)
    ) {
      reasons.push('loss timeout threshold reached');
      const result = {
        decidedAt: new Date().toISOString(),
        objective: strategyConfig.objective,
        action: 'reduce',
        confidence: Number(confidence.toFixed(2)),
        reasons,
        blockers,
        warnings,
        executionMode: 'loss-timeout',
      };
      writeLatestDecision(result);
      return result;
    }

    if (
      holdMs &&
      holdMs >= strategyConfig.softExitHoldMs &&
      positionPnlBtc !== null &&
      positionPnlBtc >= strategyConfig.softExitMinPnlBtc
    ) {
      reasons.push('soft exit threshold reached');
      const result = {
        decidedAt: new Date().toISOString(),
        objective: strategyConfig.objective,
        action: 'reduce',
        confidence: Number(confidence.toFixed(2)),
        reasons,
        blockers,
        warnings,
        executionMode: 'managed-exit',
      };
      writeLatestDecision(result);
      return result;
    }

    if (holdMs && holdMs >= strategyConfig.maxPositionHoldMs) {
      reasons.push('max position hold time reached');
      const result = {
        decidedAt: new Date().toISOString(),
        objective: strategyConfig.objective,
        action: 'reduce',
        confidence: Number(confidence.toFixed(2)),
        reasons,
        blockers,
        warnings,
        executionMode: 'time-stop',
      };
      writeLatestDecision(result);
      return result;
    }

    if (
      strategyConfig.reduceOnAdverseFunding &&
      inputs.fundingAbs !== null &&
      inputs.fundingAbs > strategyConfig.maxFundingAbsForEntry
    ) {
      reasons.push('open position under adverse funding');
      const result = {
        decidedAt: new Date().toISOString(),
        objective: strategyConfig.objective,
        action: 'reduce',
        confidence: Number(confidence.toFixed(2)),
        reasons,
        blockers,
        warnings,
        executionMode: 'risk-reduction',
      };
      writeLatestDecision(result);
      return result;
    }

    const result = {
      decidedAt: new Date().toISOString(),
      objective: strategyConfig.objective,
      action: 'hold',
      confidence: Number(confidence.toFixed(2)),
      reasons,
      blockers,
      warnings,
      executionMode: 'position-management',
    };
    writeLatestDecision(result);
    return result;
  }

  if (warnings.length > 0 || confidence < strategyConfig.entryConfidenceThreshold) {
    const result = {
      decidedAt: new Date().toISOString(),
      objective: strategyConfig.objective,
      action: positionAbsUsd > 0 ? 'hold' : 'hold',
      confidence: Number(confidence.toFixed(2)),
      reasons,
      blockers,
      warnings,
      executionMode: 'observe',
    };
    writeLatestDecision(result);
    return result;
  }

  if (
    strategyConfig.allowShort &&
    inputs.directionalEdgeUsd !== null &&
    inputs.directionalEdgeUsd >= strategyConfig.shortEntryPremiumUsd
  ) {
    reasons.push('short premium threshold reached');
    const result = {
      decidedAt: new Date().toISOString(),
      objective: strategyConfig.objective,
      action: 'sell',
      confidence: Number(confidence.toFixed(2)),
      reasons,
      blockers,
      warnings,
      executionMode: strategyConfig.makerOnlyEntry ? 'maker-only' : 'normal',
    };
    writeLatestDecision(result);
    return result;
  }

  if (
    strategyConfig.allowLong &&
    inputs.directionalEdgeUsd !== null &&
    inputs.directionalEdgeUsd <= -Math.abs(strategyConfig.longEntryDiscountUsd)
  ) {
    reasons.push('long discount threshold reached');
    const result = {
      decidedAt: new Date().toISOString(),
      objective: strategyConfig.objective,
      action: 'buy',
      confidence: Number(confidence.toFixed(2)),
      reasons,
      blockers,
      warnings,
      executionMode: strategyConfig.makerOnlyEntry ? 'maker-only' : 'normal',
    };
    writeLatestDecision(result);
    return result;
  }

  const result = {
    decidedAt: new Date().toISOString(),
    objective: strategyConfig.objective,
    action: 'hold',
    confidence: Number(confidence.toFixed(2)),
    reasons,
    blockers,
    warnings,
    executionMode: 'observe',
  };
  writeLatestDecision(result);
  return result;
}

module.exports = {
  DEFAULT_STRATEGY_CONFIG,
  loadStrategyConfig,
  decideAction,
};
