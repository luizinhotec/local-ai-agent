function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesSince(isoString, nowMs = Date.now()) {
  if (!isoString) return null;
  const parsed = Date.parse(isoString);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (nowMs - parsed) / 60000);
}

function isoAfterMinutes(baseIso, minutes) {
  const parsed = Date.parse(baseIso || '');
  if (!Number.isFinite(parsed) || !Number.isFinite(minutes)) return null;
  return new Date(parsed + minutes * 60 * 1000).toISOString();
}

function buildMessagingCooldown(state, config, nowMs = Date.now()) {
  const cooldownMin = Number(config?.messaging?.cooldownMin || 60);
  const decisionMessaging = state?.routeEvaluatorDecisionContext?.messaging || null;
  const blockedTargets = Array.isArray(decisionMessaging?.blockedReplyTargets)
    ? decisionMessaging.blockedReplyTargets
    : [];
  const pendingReplyCount = Number(
    decisionMessaging?.pendingReplyCount ??
    state?.unreadCount ??
    0
  );

  const targetCooldowns = blockedTargets
    .map(item => {
      const elapsedMin = toFiniteNumber(item?.elapsedMin);
      const remainingMin = elapsedMin === null ? null : Math.max(0, cooldownMin - elapsedMin);
      return {
        target: item?.target || null,
        peerDisplayName: item?.peerDisplayName || null,
        elapsedMin,
        remainingMin,
      };
    })
    .filter(item => item.remainingMin === null || item.remainingMin > 0);

  targetCooldowns.sort((a, b) => {
    const left = a.remainingMin === null ? Number.POSITIVE_INFINITY : a.remainingMin;
    const right = b.remainingMin === null ? Number.POSITIVE_INFINITY : b.remainingMin;
    return left - right;
  });

  const nextTarget = targetCooldowns[0] || null;
  const lastReplyAt = state?.lastReplyAt || null;
  const elapsedSinceLastReplyMin = minutesSince(lastReplyAt, nowMs);
  const globalRemainingMin =
    elapsedSinceLastReplyMin === null ? null : Math.max(0, cooldownMin - elapsedSinceLastReplyMin);

  const active = Boolean(
    pendingReplyCount > 0 &&
    ((nextTarget && (nextTarget.remainingMin === null || nextTarget.remainingMin > 0)) ||
      (globalRemainingMin !== null && globalRemainingMin > 0))
  );

  return {
    active,
    cooldownMin,
    pendingReplyCount,
    blockedTargetCount: targetCooldowns.length,
    nextTarget,
    remainingMin:
      nextTarget?.remainingMin ??
      (globalRemainingMin !== null && globalRemainingMin > 0 ? globalRemainingMin : 0),
    availableAt:
      nextTarget && nextTarget.remainingMin !== null
        ? isoAfterMinutes(new Date(nowMs).toISOString(), nextTarget.remainingMin)
        : globalRemainingMin !== null && globalRemainingMin > 0 && lastReplyAt
          ? isoAfterMinutes(lastReplyAt, globalRemainingMin)
          : null,
  };
}

function explainDefiState(state) {
  const nextAction = state?.lastNextActionSuggestion || null;
  const context = state?.routeEvaluatorDecisionContext?.defi || null;
  const blockers = Array.isArray(context?.blockers) ? context.blockers : [];
  const gateReason =
    nextAction?.championshipGateBlockReason ||
    state?.lastChampionshipExecutionGate?.championshipGateBlockReason ||
    null;
  const effectiveDecisionPolicy = state?.lastChampionshipExecutionGate?.effectiveDecisionPolicy || null;
  const estimatedFeeSats =
    toFiniteNumber(context?.estimatedFeeSats) ??
    toFiniteNumber(state?.lastChampionshipExecutionGate?.estimatedFeeSats);
  const maxDecisionFeeSats = toFiniteNumber(effectiveDecisionPolicy?.maxEstimatedFeeSats);
  const feePerByte =
    toFiniteNumber(context?.quoteSummary?.rawFeeInputs?.feePerByte) ??
    toFiniteNumber(context?.shadowExecution?.feePerByte) ??
    toFiniteNumber(context?.policyDiagnostics?.feePerByte);
  const maxFeePerByte = toFiniteNumber(effectiveDecisionPolicy?.maxFeePerByte);
  const routeHops =
    toFiniteNumber(context?.quoteSummary?.totalHops) ??
    toFiniteNumber(context?.shadowExecution?.totalHops);
  const maxRouteHops = toFiniteNumber(effectiveDecisionPolicy?.maxRouteHops);
  const minOutputRatio = toFiniteNumber(effectiveDecisionPolicy?.minOutputRatio);
  const amountOut = toFiniteNumber(context?.quoteSummary?.amountOut);
  const minAmountOut = toFiniteNumber(context?.quoteSummary?.minAmountOut);
  const btcUsd = toFiniteNumber(context?.quoteSummary?.rawFeeInputs?.btcUsd);
  const amountSats = toFiniteNumber(context?.amountSats);
  const inputUsd =
    amountSats !== null && btcUsd !== null
      ? (amountSats / 100000000) * btcUsd
      : null;
  const minOutputUsd = minAmountOut !== null ? minAmountOut / 1000000 : null;
  const outputRatio =
    inputUsd !== null && inputUsd > 0 && minOutputUsd !== null
      ? minOutputUsd / inputUsd
      : null;
  const feeOverDecisionLimit =
    estimatedFeeSats !== null &&
    maxDecisionFeeSats !== null &&
    estimatedFeeSats > maxDecisionFeeSats;
  const feePerByteOverLimit =
    feePerByte !== null &&
    maxFeePerByte !== null &&
    feePerByte > maxFeePerByte;
  const routeHopsOverLimit =
    routeHops !== null &&
    maxRouteHops !== null &&
    routeHops > maxRouteHops;
  const outputRatioBelowMin =
    outputRatio !== null &&
    minOutputRatio !== null &&
    outputRatio < minOutputRatio;
  const breakerOpenUntil = state?.skillBuilder?.skillStates?.defi_quote_monitor?.breakerOpenUntil || null;

  const reasons = [];
  if (nextAction?.recommendedAction === 'quote_only') {
    reasons.push('A estrategia atual permite apenas observacao de cotacao.');
  }
  if (gateReason === 'decision_not_pass') {
    reasons.push('O gate de execucao nao aprovou a oportunidade atual.');
  }
  if (feeOverDecisionLimit) {
    reasons.push(`A fee estimada de ${estimatedFeeSats} sats excede o limite de ${maxDecisionFeeSats} sats.`);
  }
  if (feePerByteOverLimit) {
    reasons.push(`A fee por byte de ${feePerByte.toFixed(2)} excede o limite de ${maxFeePerByte}.`);
  }
  if (routeHopsOverLimit) {
    reasons.push(`A rota usa ${routeHops} hops e excede o limite de ${maxRouteHops}.`);
  }
  if (outputRatioBelowMin) {
    reasons.push(`A proporcao minima de saida ${outputRatio.toFixed(4)} ficou abaixo do minimo ${minOutputRatio}.`);
  }
  if (blockers.includes('circuit_breaker_open')) {
    reasons.push('O circuit breaker de DeFi esta aberto para evitar execucao arriscada.');
  }
  if (blockers.includes('manual_bridge_required')) {
    reasons.push('Existe dependencia manual de bridge em parte do fluxo BTC L1.');
  }
  return {
    recommendedAction: nextAction?.recommendedAction || state?.lastRecommendedAction || 'wait',
    gateReason,
    blockers,
    decision: context?.decision || null,
    decisionReason: context?.decisionReason || null,
    estimatedFeeSats,
    maxDecisionFeeSats,
    feeOverDecisionLimit,
    feePerByte,
    maxFeePerByte,
    feePerByteOverLimit,
    routeHops,
    maxRouteHops,
    routeHopsOverLimit,
    outputRatio,
    minOutputRatio,
    outputRatioBelowMin,
    priceImpactBps: toFiniteNumber(context?.priceImpactBps),
    breakerOpenUntil,
    humanReason:
      reasons.join(' ') ||
      'Nao ha autorizacao de execucao DeFi neste momento.',
  };
}

function buildOperationalSummary({ config, state, status, watchdog, nowIso = new Date().toISOString() }) {
  const nowMs = Date.parse(nowIso);
  const nextAction = state?.lastNextActionSuggestion || status?.nextAction || {};
  const cooldown = buildMessagingCooldown(state, config, nowMs);
  const defi = explainDefiState(state);
  const actionableNow = Boolean(
    nextAction?.autoLiveEligible &&
    nextAction?.recommendedAction === 'messaging_only' &&
    !cooldown.active
  );

  const summary = {
    generatedAt: nowIso,
    loopRunning: Boolean(status?.standardLoop?.lastRunAt),
    watchdogStale: Boolean(watchdog?.stale),
    messaging: {
      enabled: Boolean(state?.skills?.messaging?.enabled),
      policyMode: state?.skills?.messaging?.policyMode || 'disabled',
      unreadCount: Number(state?.unreadCount || 0),
      repliedMessages: Number(state?.repliedMessages || 0),
      cooldown,
    },
    nextAction: {
      recommendedAction: nextAction?.recommendedAction || 'wait',
      reason: nextAction?.reason || state?.lastRecommendedReason || null,
      command: nextAction?.recommendedCommand || null,
      autoLiveEligible: Boolean(nextAction?.autoLiveEligible),
      autoLiveBlockReason: nextAction?.autoLiveBlockReason || null,
      actionableNow,
    },
    defi,
    defiAmountScan: {
      lastScanAt: state?.defiAmountScan?.lastScanAt || null,
      preferredAmountSats: toFiniteNumber(state?.defiAmountScan?.preferredAmountSats),
      preferredPassNow: Boolean(state?.defiAmountScan?.preferredPassNow),
      preferredReason: state?.defiAmountScan?.preferredReason || null,
      scannedCount: Array.isArray(state?.defiAmountScan?.amounts) ? state.defiAmountScan.amounts.length : 0,
    },
    loop: {
      lastRunAt: state?.lastStandardLoopRunAt || status?.standardLoop?.lastRunAt || null,
      lastAction: state?.lastStandardLoopAction || status?.standardLoop?.lastAction || null,
      lastBlockReason: state?.lastStandardLoopBlockReason || status?.standardLoop?.lastBlockReason || null,
      cycles: Number(state?.standardLoopCycles || 0),
      autoActions: Number(state?.standardLoopAutoActionsCount || 0),
    },
    supervisorLine: null,
  };

  summary.supervisorLine = [
    `loop=${summary.loop.lastAction || 'unknown'}`,
    `msgs=${summary.messaging.unreadCount} unread/${summary.messaging.repliedMessages} replied`,
    `cooldown=${summary.messaging.cooldown.active ? 'active' : 'free'}`,
    `next=${summary.nextAction.recommendedAction}`,
    `defi=${summary.defi.humanReason}`,
  ].join(' | ');

  return summary;
}

module.exports = {
  buildOperationalSummary,
};
