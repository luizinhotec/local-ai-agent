const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { readAgentState, updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');
const { runMessagingSkill } = require('./skill-messaging.cjs');
const { runWalletActionsSkill } = require('./skill-wallet-actions.cjs');
const { runSbtcToUsdcx } = require('./skill-defi-simple.cjs');
const { runBtcL1ToSbtcReadinessSkill } = require('./skill-btc-l1-to-sbtc-readiness.cjs');
const { runBtcL1ToUsdcRouterSkill } = require('./skill-btc-l1-to-usdc-router.cjs');
const { evaluateSkillBuilder } = require('./lib/skill-builder.cjs');
const { DEFAULT_COMPETITIVE_POLICY, resolveCompetitivePolicy } = require('./lib/competitive-policy.cjs');
const { evaluateDecision } = require('../../active/tools/bitflow-runtime/policy/decision-engine.cjs');

const HISTORY_LIMIT = 20;
const CHAMPIONSHIP_EXECUTION_GATE_VERSION = 'championship_execution_gate_v1';
const CHAMPIONSHIP_WATCH_GATE_VERSION = 'championship_watch_gate_v1';

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

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

function minutesSince(isoString) {
  if (!isoString) return null;
  const time = Date.parse(isoString);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (Date.now() - time) / 60000);
}

function hasGlobalCooldown(state, cooldownMin) {
  const elapsed = minutesSince(state.lastRouteEvaluationAt);
  if (elapsed === null) return false;
  return elapsed < Math.min(Math.max(cooldownMin, 1), 10);
}

function buildMessagingContext(state, messagingResult, config) {
  const inboxMessages = messagingResult.state?.inboxMessages || state.inboxMessages || [];
  const pendingReplies = inboxMessages.filter(
    item => item && !item.repliedAt
  );
  const outboundQueue = messagingResult.state?.outboundQueue || state.outboundQueue || [];
  const paymentRequiredItems = outboundQueue.filter(item => item.status === 'payment_required');
  const pendingReplyTargets = pendingReplies.map(item => ({
    messageId: item.messageId || null,
    peerBtcAddress: item.peerBtcAddress || null,
    peerDisplayName: item.peerDisplayName || null,
    sentAt: item.sentAt || null,
  }));

  const targetCooldowns = pendingReplyTargets.map(target => {
    const lastReply = (state.lastReplyTargets || [])
      .slice()
      .reverse()
      .find(item => item.peerBtcAddress === target.peerBtcAddress);
    const elapsedMin = minutesSince(lastReply?.at || null);
    return {
      target: target.peerBtcAddress,
      peerDisplayName: target.peerDisplayName,
      cooldownActive: elapsedMin !== null && elapsedMin < config.messaging.cooldownMin,
      elapsedMin,
    };
  });

  const safePendingReplies = pendingReplyTargets.filter(target => {
    const cooldown = targetCooldowns.find(item => item.target === target.peerBtcAddress);
    return !cooldown?.cooldownActive;
  });

  const detectedSocialAchievements = [];
  if (state.progressionStatus?.achievementsUnlocked?.communicatorLikelyReady) {
    detectedSocialAchievements.push('communicator');
  }
  if (state.progressionStatus?.achievementsUnlocked?.senderPending) {
    detectedSocialAchievements.push('sender_pending');
  }

  return {
    unreadCount: Number(messagingResult.state?.unreadCount ?? state.unreadCount ?? 0),
    pendingReplyCount: pendingReplies.length,
    pendingReplyTargets: safePendingReplies,
    blockedReplyTargets: targetCooldowns.filter(item => item.cooldownActive),
    queueDepth: outboundQueue.length,
    outboundQueue: sanitizeValue(outboundQueue.slice(0, 10)),
    paymentRequiredCount: paymentRequiredItems.length,
    paymentRequiredItems: sanitizeValue(paymentRequiredItems.slice(0, 5)),
    replyAnalytics: sanitizeValue(messagingResult.state?.replyAnalytics || state.replyAnalytics || null),
    replyTemplateStats: sanitizeValue(messagingResult.state?.replyTemplateStats || state.replyTemplateStats || null),
    achievements: detectedSocialAchievements,
    lastReplyAt: messagingResult.state?.lastReplyAt || state.lastReplyAt || null,
    cooldownMin: config.messaging.cooldownMin,
    policyMode:
      messagingResult.state?.skills?.messaging?.policyMode ||
      state.skills?.messaging?.policyMode ||
      'disabled',
  };
}

function buildWalletContext(walletResult) {
  const walletStatus = walletResult.walletStatus || walletResult.state?.walletStatus || {};
  const balances = walletStatus.balances || {};
  const walletBlockers = (walletResult.plan?.knownBlockers || []).filter(
    blocker => blocker !== 'feature_disabled'
  );
  return {
    ready: Boolean(walletStatus.ready),
    signerReady: Boolean(walletStatus.signerReadiness?.ok),
    btcNetworkReady: Boolean(walletStatus.network?.btc?.ok),
    stacksNetworkReady: Boolean(walletStatus.network?.stacks?.ok),
    stxAddress: walletStatus.wallet?.stxAddress || walletStatus.wallet?.address || null,
    stxMicro: Number(balances.stacks?.stxMicroStx || 0),
    sbtcSats: Number(balances.stacks?.sbtcSats || 0),
    usdcxBaseUnits: Number(balances.stacks?.usdcxBaseUnits || 0),
    blockers: sanitizeValue(walletBlockers),
    microPlan: sanitizeValue(walletResult.plan?.microAction?.valueActionPlan || null),
  };
}

function buildDefiContext(defiResult, walletContext, policy) {
  const quote = defiResult.quoteSummary || {};
  const plan = defiResult.plan || {};
  const blockers = [...new Set(defiResult.blockers || plan.knownBlockers || [])];
  const estimatedFeeSats = toPositiveNumber(quote.estimatedFeeSats);
  const slippageBps = Math.abs(Number(quote.priceImpactBps || 0));
  const priceImpactBps = Number(quote.priceImpactBps || 0);
  const amountSats = Number(defiResult.amountSats || 0);
  let decision = String(plan.cachedContext?.decision || '').toUpperCase() || null;
  let decisionReason = plan.cachedContext?.decisionReason || null;
  const quoteFresh = Boolean(plan.quoteFresh);
  const technicallyReady =
    defiResult.pair === 'sbtc-usdcx' &&
    defiResult.status === 'ready' &&
    blockers.length === 0 &&
    walletContext.signerReady &&
    walletContext.stacksNetworkReady &&
    walletContext.sbtcSats >= amountSats;

  let economicVerdict = 'skip';
  if (technicallyReady) {
    economicVerdict = 'pass';
  } else if (quote.amountOut && walletContext.sbtcSats > 0) {
    economicVerdict = 'inconclusive';
  }
  if (!decision) {
    if (blockers.includes('quote_unavailable') || blockers.includes('quote_amounts_missing')) {
      decision = 'INCONCLUSIVE';
      decisionReason = 'quote_unavailable';
    } else if (blockers.includes('estimated_fee_unavailable')) {
      decision = 'INCONCLUSIVE';
      decisionReason = 'estimated_fee_unavailable';
    } else {
      const derivedDecision = deriveEconomicDecisionFromQuote(quote, amountSats, policy?.decision || {});
      if (derivedDecision) {
        decision = derivedDecision.decision;
        decisionReason = derivedDecision.decisionReason;
      }
    }
  }

  return {
    pair: defiResult.pair || 'sbtc-usdcx',
    status: defiResult.status || 'not_ready',
    amountSats,
    quoteSummary: sanitizeValue(quote),
    estimatedFeeSats,
    slippageBps,
    priceImpactBps,
    quoteFresh,
    blockers,
    knownBlockers: blockers,
    decision,
    decisionReason,
    balanceSbtcSats: walletContext.sbtcSats,
    planStatus: plan.status || defiResult.status || 'not_ready',
    executionPolicy: sanitizeValue(defiResult.executionPolicy || plan.executionPolicy || null),
    dependencyReadiness: sanitizeValue(plan.dependencyReadiness || null),
    policyDiagnostics: sanitizeValue({
      source: policy?.source || 'default',
      routeOverrideActive: Boolean(policy?.routeOverrideActive),
      routeOverrideKeys: policy?.routeOverrideKeys || [],
      decision: policy?.decision || null,
      watchGate: policy?.watchGate || null,
      championshipGate: policy?.championshipGate || null,
    }),
    economicVerdict,
    technicallyReady,
  };
}

function toPositiveNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function deriveEconomicDecisionFromQuote(quote, amountSats, decisionPolicy = {}) {
  const estimatedFeeSats = toPositiveNumber(quote?.estimatedFeeSats);
  const amountOut = toPositiveNumber(quote?.amountOut);
  const minAmountOut = toPositiveNumber(quote?.minAmountOut);
  const btcUsd = toPositiveNumber(quote?.rawFeeInputs?.btcUsd);
  const feePerByte = toPositiveNumber(quote?.rawFeeInputs?.feePerByte);
  const routeHops = toPositiveNumber(quote?.totalHops);

  if (
    estimatedFeeSats === null ||
    amountOut === null ||
    minAmountOut === null ||
    btcUsd === null ||
    amountSats <= 0
  ) {
    return null;
  }

  const inputUsd = (amountSats / 100_000_000) * btcUsd;
  const expectedOutputUsd = amountOut / 1_000_000;
  const minOutputUsd = minAmountOut / 1_000_000;
  const feeUsd = (estimatedFeeSats / 100_000_000) * btcUsd;
  const netProfitUsd = expectedOutputUsd - inputUsd - feeUsd;
  const worstCaseNetProfitUsd = minOutputUsd - inputUsd - feeUsd;
  const outputRatio = inputUsd > 0 ? minOutputUsd / inputUsd : null;

  if (
    !Number.isFinite(inputUsd) ||
    !Number.isFinite(expectedOutputUsd) ||
    !Number.isFinite(minOutputUsd) ||
    !Number.isFinite(feeUsd)
  ) {
    return null;
  }

  const effectiveDecisionPolicy = {
    minOutputRatio: Number.isFinite(Number(decisionPolicy.minOutputRatio)) ? Number(decisionPolicy.minOutputRatio) : DEFAULT_COMPETITIVE_POLICY.decision.minOutputRatio,
    maxEstimatedFeeSats: Number.isFinite(Number(decisionPolicy.maxEstimatedFeeSats)) ? Number(decisionPolicy.maxEstimatedFeeSats) : DEFAULT_COMPETITIVE_POLICY.decision.maxEstimatedFeeSats,
    maxFeePerByte: Number.isFinite(Number(decisionPolicy.maxFeePerByte)) ? Number(decisionPolicy.maxFeePerByte) : DEFAULT_COMPETITIVE_POLICY.decision.maxFeePerByte,
    maxRouteHops: Number.isFinite(Number(decisionPolicy.maxRouteHops)) ? Number(decisionPolicy.maxRouteHops) : DEFAULT_COMPETITIVE_POLICY.decision.maxRouteHops,
    minExpectedNetUsd: Number.isFinite(Number(decisionPolicy.minExpectedNetUsd)) ? Number(decisionPolicy.minExpectedNetUsd) : DEFAULT_COMPETITIVE_POLICY.decision.minExpectedNetUsd,
    minWorstCaseNetUsd: Number.isFinite(Number(decisionPolicy.minWorstCaseNetUsd)) ? Number(decisionPolicy.minWorstCaseNetUsd) : DEFAULT_COMPETITIVE_POLICY.decision.minWorstCaseNetUsd,
  };

  const validationPassed =
    estimatedFeeSats > 0 &&
    estimatedFeeSats <= effectiveDecisionPolicy.maxEstimatedFeeSats &&
    Number.isFinite(routeHops) &&
    routeHops > 0 &&
    routeHops <= effectiveDecisionPolicy.maxRouteHops &&
    Number.isFinite(outputRatio) &&
    outputRatio > 0 &&
    outputRatio >= effectiveDecisionPolicy.minOutputRatio &&
    (feePerByte === null || feePerByte <= effectiveDecisionPolicy.maxFeePerByte);

  const result = evaluateDecision({
    profitComplete: true,
    validationPassed,
    netProfitUsd,
    worstCaseNetProfitUsd,
    outputRatio,
    feePerByte,
    routeHops,
    thresholds: {
      minExpectedNetUsd: effectiveDecisionPolicy.minExpectedNetUsd,
      minWorstCaseNetUsd: effectiveDecisionPolicy.minWorstCaseNetUsd,
      policyMinOutputRatio: effectiveDecisionPolicy.minOutputRatio,
      policyMaxFeePerByte: effectiveDecisionPolicy.maxFeePerByte,
      policyMaxRouteHops: effectiveDecisionPolicy.maxRouteHops,
    },
  });

  return {
    decision: result.decision === 'EXECUTE' ? 'PASS' : result.decision,
    decisionReason: result.reason || null,
    economicMetrics: {
      inputUsd,
      expectedOutputUsd,
      minOutputUsd,
      feeUsd,
      netProfitUsd,
      worstCaseNetProfitUsd,
      outputRatio,
      feePerByte,
      routeHops,
    },
  };
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function buildShadowExecution(defiContext, latencyMs) {
  const quote = defiContext.quoteSummary || {};
  return {
    at: new Date().toISOString(),
    pair: defiContext.pair,
    amountSats: defiContext.amountSats,
    simulatedAmountOut: toPositiveNumber(quote.amountOut),
    simulatedMinAmountOut: toPositiveNumber(quote.minAmountOut),
    simulatedFeeSats: toPositiveNumber(defiContext.estimatedFeeSats),
    simulatedLatencyMs: Math.max(0, Math.round(latencyMs || 0)),
    simulatedPriceImpactBps: Number(defiContext.priceImpactBps || 0),
    routePath: sanitizeValue(quote.routePath || []),
    executionPath: sanitizeValue(quote.executionPath || []),
    totalHops: Number(quote.totalHops || 0),
    quoteFresh: Boolean(defiContext.quoteFresh),
    decision: defiContext.decision || null,
    decisionReason: defiContext.decisionReason || null,
  };
}

function computeEdgeScore(shadowExecution) {
  const simulatedAmountOut = Number(shadowExecution.simulatedAmountOut || 0);
  const simulatedMinAmountOut = Number(shadowExecution.simulatedMinAmountOut || 0);
  const simulatedFeeSats = toPositiveNumber(shadowExecution.simulatedFeeSats);
  const absImpact = Math.abs(Number(shadowExecution.simulatedPriceImpactBps || 0));
  const outBuffer = simulatedAmountOut > 0
    ? Math.max(0, (simulatedAmountOut - simulatedMinAmountOut) / simulatedAmountOut)
    : 0;

  const bufferScore = Math.min(40, outBuffer * 4000);
  const feeScore = simulatedFeeSats === null ? 0 : Math.max(0, 30 - (simulatedFeeSats / 200) * 30);
  const impactScore = Math.max(0, 30 - (absImpact / 40) * 30);

  return clampScore(bufferScore + feeScore + impactScore);
}

function computeExecutionQualityScore(shadowExecution, defiContext) {
  const totalHops = Math.max(1, Number(shadowExecution.totalHops || 1));
  const absImpact = Math.abs(Number(shadowExecution.simulatedPriceImpactBps || 0));
  const slippageBps = Math.abs(Number(defiContext.slippageBps || 0));

  const routeStabilityScore = Math.max(0, 45 - (totalHops - 1) * 12);
  const impactScore = Math.max(0, 30 - (absImpact / 40) * 30);
  const slippageScore = Math.max(0, 25 - (slippageBps / 40) * 25);

  return clampScore(routeStabilityScore + impactScore + slippageScore);
}

function evaluateChampionshipWatchGate(defiContext, walletContext, policy) {
  const infrastructureBlockers = [];
  const dependencyReadiness = defiContext.dependencyReadiness || {};
  const absPriceImpactBps = Math.abs(Number(defiContext.priceImpactBps || 0));
  const estimatedFeeSats = toPositiveNumber(defiContext.estimatedFeeSats);
  const watchPolicy = policy?.watchGate || {};
  const maxAmountSats = Number.isFinite(Number(watchPolicy.maxAmountSats)) ? Number(watchPolicy.maxAmountSats) : DEFAULT_COMPETITIVE_POLICY.watchGate.maxAmountSats;
  const maxEstimatedFeeSats = Number.isFinite(Number(watchPolicy.maxEstimatedFeeSats)) ? Number(watchPolicy.maxEstimatedFeeSats) : DEFAULT_COMPETITIVE_POLICY.watchGate.maxEstimatedFeeSats;
  const maxPriceImpactBps = Number.isFinite(Number(watchPolicy.maxPriceImpactBps)) ? Number(watchPolicy.maxPriceImpactBps) : DEFAULT_COMPETITIVE_POLICY.watchGate.maxPriceImpactBps;

  if (defiContext.pair !== 'sbtc-usdcx') {
    return {
      eligible: false,
      reason: 'pair_not_supported',
      score: 0,
      version: CHAMPIONSHIP_WATCH_GATE_VERSION,
    };
  }
  if (!Number.isFinite(defiContext.amountSats) || defiContext.amountSats <= 0 || defiContext.amountSats > maxAmountSats) {
    return {
      eligible: false,
      reason: 'amount_outside_watch_band',
      score: 0,
      version: CHAMPIONSHIP_WATCH_GATE_VERSION,
    };
  }
  if (!defiContext.quoteFresh) {
    return {
      eligible: false,
      reason: 'quote_stale',
      score: 0,
      version: CHAMPIONSHIP_WATCH_GATE_VERSION,
    };
  }
  if (estimatedFeeSats === null) {
    return {
      eligible: false,
      reason: 'estimated_fee_unavailable',
      score: 0,
      version: CHAMPIONSHIP_WATCH_GATE_VERSION,
    };
  }
  if (estimatedFeeSats > maxEstimatedFeeSats) {
    return {
      eligible: false,
      reason: 'estimated_fee_above_watch_max_sats',
      score: 0,
      version: CHAMPIONSHIP_WATCH_GATE_VERSION,
    };
  }
  if (absPriceImpactBps > maxPriceImpactBps) {
    return {
      eligible: false,
      reason: 'price_impact_above_watch_max_bps',
      score: 0,
      version: CHAMPIONSHIP_WATCH_GATE_VERSION,
    };
  }

  if (!walletContext.signerReady) infrastructureBlockers.push('signer_not_ready');
  if (!walletContext.stacksNetworkReady) infrastructureBlockers.push('stacks_network_unavailable');
  if (dependencyReadiness.executorAvailable === false) infrastructureBlockers.push('executor_unavailable');
  if (dependencyReadiness.executorPasswordReady === false) infrastructureBlockers.push('executor_password_not_ready');
  if (dependencyReadiness.walletMatch === false) infrastructureBlockers.push('wallet_match_not_ready');
  if (defiContext.knownBlockers.includes('stacks_balances_unavailable')) infrastructureBlockers.push('stacks_balances_unavailable');
  if (defiContext.knownBlockers.includes('quote_unavailable')) infrastructureBlockers.push('quote_unavailable');
  if (defiContext.knownBlockers.includes('quote_returned_no_routes')) infrastructureBlockers.push('quote_returned_no_routes');
  if (defiContext.knownBlockers.includes('missing_stx_address')) infrastructureBlockers.push('missing_stx_address');

  if (infrastructureBlockers.length > 0) {
    return {
      eligible: false,
      reason: infrastructureBlockers[0],
      score: 0,
      infrastructureBlockers,
      version: CHAMPIONSHIP_WATCH_GATE_VERSION,
    };
  }

  const feeScore = Math.max(0, 100 - Math.round((estimatedFeeSats / maxEstimatedFeeSats) * 50));
  const impactScore = Math.max(0, 100 - Math.round((absPriceImpactBps / maxPriceImpactBps) * 50));

  return {
    eligible: true,
    reason: 'watch_gate_pass',
    score: Math.max(0, Math.min(100, Math.round((feeScore + impactScore) / 2))),
    infrastructureBlockers: [],
    version: CHAMPIONSHIP_WATCH_GATE_VERSION,
  };
}

function evaluateChampionshipExecutionGate(defiContext, policy) {
  const championshipPolicy = policy?.championshipGate || {};
  const maxEstimatedFeeSats = Number.isFinite(Number(championshipPolicy.maxEstimatedFeeSats)) ? Number(championshipPolicy.maxEstimatedFeeSats) : DEFAULT_COMPETITIVE_POLICY.championshipGate.maxEstimatedFeeSats;
  const maxPriceImpactBps = Number.isFinite(Number(championshipPolicy.maxPriceImpactBps)) ? Number(championshipPolicy.maxPriceImpactBps) : DEFAULT_COMPETITIVE_POLICY.championshipGate.maxPriceImpactBps;
  if (defiContext.decision !== 'PASS') {
    return {
      eligible: false,
      blockReason: 'decision_not_pass',
      version: CHAMPIONSHIP_EXECUTION_GATE_VERSION,
    };
  }
  if (defiContext.decisionReason === 'worst_case_profit_below_threshold') {
    return {
      eligible: false,
      blockReason: 'worst_case_profit_below_threshold',
      version: CHAMPIONSHIP_EXECUTION_GATE_VERSION,
    };
  }
  if (defiContext.knownBlockers.includes('circuit_breaker_open')) {
    return {
      eligible: false,
      blockReason: 'circuit_breaker_open',
      version: CHAMPIONSHIP_EXECUTION_GATE_VERSION,
    };
  }
  if (defiContext.knownBlockers.length > 0) {
    return {
      eligible: false,
      blockReason: defiContext.knownBlockers[0],
      version: CHAMPIONSHIP_EXECUTION_GATE_VERSION,
    };
  }
  if (defiContext.estimatedFeeSats === null) {
    return {
      eligible: false,
      blockReason: 'estimated_fee_unavailable',
      version: CHAMPIONSHIP_EXECUTION_GATE_VERSION,
    };
  }
  if (defiContext.estimatedFeeSats > maxEstimatedFeeSats) {
    return {
      eligible: false,
      blockReason: 'estimated_fee_above_championship_max_sats',
      version: CHAMPIONSHIP_EXECUTION_GATE_VERSION,
    };
  }
  if (Math.abs(defiContext.priceImpactBps) > maxPriceImpactBps) {
    return {
      eligible: false,
      blockReason: 'price_impact_above_championship_max_bps',
      version: CHAMPIONSHIP_EXECUTION_GATE_VERSION,
    };
  }
  if (!defiContext.quoteFresh) {
    return {
      eligible: false,
      blockReason: 'quote_stale',
      version: CHAMPIONSHIP_EXECUTION_GATE_VERSION,
    };
  }
  return {
    eligible: true,
    blockReason: null,
    version: CHAMPIONSHIP_EXECUTION_GATE_VERSION,
  };
}

function buildRouterContext(readinessResult, routerResult) {
  return {
    btcL1ReadinessStatus: readinessResult.status || 'not_ready',
    bridgeMode: readinessResult.sbtcBridge?.mode || 'unknown',
    bridgeRecommendation: readinessResult.recommendation || null,
    bridgeBlockers: sanitizeValue(readinessResult.blockers || []),
    routerStatus: routerResult.status || 'not_ready',
    routerBlockers: sanitizeValue(routerResult.blockers || []),
    routerExecutionMode: routerResult.executionMode || null,
    pointOfManualAction: routerResult.pointOfManualAction || null,
  };
}

function decideAction(context, state, config) {
  const blockers = [];
  const reasons = [];
  const globalCooldownActive = !context.force && hasGlobalCooldown(state, config.messaging.cooldownMin);
  const championshipGate = context.defi.championshipGate || evaluateChampionshipExecutionGate(context.defi);

  if (
    context.messaging.pendingReplyCount > 0 &&
    context.messaging.pendingReplyTargets.length > 0 &&
    !globalCooldownActive
  ) {
    reasons.push('pending_social_reply_available');
    return {
      recommendedAction: 'messaging_only',
      nextBestAction: context.defi.economicVerdict === 'pass' ? 'defi_swap_execute' : 'quote_only',
      confidence: 0.93,
      estimatedCostClass: 'zero',
      reason: reasons.join(','),
      blockers,
    };
  }

  if (
    context.defi.economicVerdict === 'pass' &&
    championshipGate.eligible &&
    context.wallet.signerReady &&
    context.wallet.stacksNetworkReady &&
    !globalCooldownActive
  ) {
    reasons.push('defi_ready_with_guardrails_passing');
    return {
      recommendedAction: 'defi_swap_execute',
      nextBestAction: context.messaging.pendingReplyCount > 0 ? 'messaging_only' : 'quote_only',
      confidence: 0.79,
      estimatedCostClass: 'low',
      reason: reasons.join(','),
      blockers,
    };
  }

  if (
    context.wallet.sbtcSats > 0 &&
    context.wallet.signerReady &&
    context.wallet.stacksNetworkReady &&
    context.defi.quoteSummary?.amountOut
  ) {
    reasons.push(championshipGate.eligible ? 'defi_monitoring_has_value_but_live_not_justified' : 'championship_execution_gate_blocked');
    blockers.push(...context.defi.blockers);
    if (!championshipGate.eligible && championshipGate.blockReason) {
      blockers.unshift(championshipGate.blockReason);
    }
    return {
      recommendedAction: 'quote_only',
      nextBestAction: context.messaging.pendingReplyCount > 0 ? 'messaging_only' : 'wait',
      confidence: 0.75,
      estimatedCostClass: 'zero',
      reason: reasons.join(','),
      blockers: [...new Set(blockers)],
      championshipGateEligible: championshipGate.eligible,
      championshipGateBlockReason: championshipGate.blockReason,
      autoLiveEligible: false,
    };
  }

  reasons.push(globalCooldownActive ? 'global_cooldown_active' : 'no_compelling_low_risk_action');
  blockers.push(...context.router.routerBlockers);
  blockers.push(...context.wallet.blockers);
  return {
    recommendedAction: 'wait',
    nextBestAction: context.wallet.sbtcSats > 0 ? 'quote_only' : 'messaging_only',
    confidence: 0.68,
    estimatedCostClass: 'zero',
    reason: reasons.join(','),
    blockers: [...new Set(blockers)].filter(Boolean),
  };
}

function trimHistory(history) {
  return history.slice(-HISTORY_LIMIT);
}

async function runRouteEvaluatorSkill(options = {}) {
  const config = loadAgentConfig();
  const nowIso = new Date().toISOString();
  const statusOnly = parseBoolean(options.statusOnly, false);
  const dryRun = options.dryRun === undefined ? true : parseBoolean(options.dryRun, true);
  const force = parseBoolean(options.force, false);
  const amountSats = Number(options['amount-sats'] || 3000);
  const pair = 'sbtc-usdcx';
  const competitivePolicy = resolveCompetitivePolicy(config, pair);

  appendJsonLog('route_evaluator_started', {
    statusOnly,
    dryRun,
    force,
    amountSats,
    pair,
    competitivePolicy: sanitizeValue(competitivePolicy),
  });

  const currentState = readAgentState();
  const messagingResult = await runMessagingSkill({
    statusOnly: true,
    dryRun: true,
  });
  const walletResult = await runWalletActionsSkill({
    statusOnly: true,
    dryRun: true,
  });
  const defiStartedAt = Date.now();
  const defiResult = await runSbtcToUsdcx({
    mode: 'plan',
    persist: false,
    pair,
    'amount-sats': amountSats,
  });
  const defiLatencyMs = Date.now() - defiStartedAt;
  const readinessResult = await runBtcL1ToSbtcReadinessSkill({
    statusOnly: true,
    dryRun: true,
    persist: false,
  });
  const routerResult = await runBtcL1ToUsdcRouterSkill({
    statusOnly: true,
    dryRun: true,
    route: 'defi_native',
    'amount-sats': amountSats,
  });

  const refreshedState = readAgentState();
  const decisionContext = {
    amountSats,
    pair,
    force,
    messaging: buildMessagingContext(refreshedState, messagingResult, config),
    wallet: buildWalletContext(walletResult),
    defi: null,
    router: null,
    progression: {
      levelName: refreshedState.progressionStatus?.levelName || null,
      achievementsUnlocked: sanitizeValue(refreshedState.progressionStatus?.achievementsUnlocked || {}),
      completedIdentitySteps: sanitizeValue(refreshedState.completedIdentitySteps || []),
      lastHeartbeatAt: refreshedState.lastHeartbeatAt || null,
      lastMessagingRunAt: refreshedState.lastMessagingRunAt || null,
      lastWalletCheckAt: refreshedState.lastWalletCheckAt || null,
      lastDefiCheckAt: refreshedState.lastDefiCheckAt || null,
    },
  };
  decisionContext.defi = buildDefiContext(defiResult, decisionContext.wallet, competitivePolicy);
  decisionContext.defi.shadowExecution = buildShadowExecution(decisionContext.defi, defiLatencyMs);
  decisionContext.defi.edgeScore = computeEdgeScore(decisionContext.defi.shadowExecution);
  decisionContext.defi.executionQualityScore = computeExecutionQualityScore(
    decisionContext.defi.shadowExecution,
    decisionContext.defi,
  );
  decisionContext.defi.watchGate = evaluateChampionshipWatchGate(decisionContext.defi, decisionContext.wallet, competitivePolicy);
  decisionContext.defi.championshipGate = evaluateChampionshipExecutionGate(decisionContext.defi, competitivePolicy);
  decisionContext.router = buildRouterContext(readinessResult, routerResult);

  if (decisionContext.defi.watchGate?.eligible) {
    appendJsonLog('championship_shadow_execution_completed', sanitizeValue({
      pair: decisionContext.defi.pair,
      amountSats: decisionContext.defi.amountSats,
      shadowExecution: decisionContext.defi.shadowExecution,
      edgeScore: decisionContext.defi.edgeScore,
      executionQualityScore: decisionContext.defi.executionQualityScore,
    }));
  }

  appendJsonLog('route_evaluator_context_built', sanitizeValue({
    amountSats,
    decisionContext,
  }));

  const skillBuilder = evaluateSkillBuilder(decisionContext, refreshedState, config, {
    amountSats,
    nowIso,
  });
  const decision = {
    ...decideAction(decisionContext, refreshedState, config),
    recommendedSkillId: skillBuilder.recommendedSkill?.skillId || null,
    recommendedSkillLabel: skillBuilder.recommendedSkill?.label || null,
    recommendedSkillCategory: skillBuilder.recommendedSkill?.category || null,
    recommendedSkillReason: skillBuilder.recommendedSkill?.reason || null,
    recommendedSkillWhyNow: skillBuilder.recommendedSkill?.whyNow || skillBuilder.recommendedSkill?.reason || null,
    recommendedSkillCommand: skillBuilder.recommendedSkill?.command || null,
    recommendedSkillFallbackCommand: skillBuilder.recommendedSkill?.fallbackCommand || null,
    recommendedSkillApprovalRequired: Boolean(skillBuilder.recommendedSkill?.approvalRequired),
    recommendedSkillAutoExecutable: Boolean(skillBuilder.recommendedSkill?.autoExecutable),
    recommendedSkillScore: Number(skillBuilder.recommendedSkill?.score || 0),
    loopRecommendedSkillId: skillBuilder.loopRecommendation?.skillId || null,
    loopRecommendedSkillCommand: skillBuilder.loopRecommendation?.command || null,
    loopRecommendedSkillFallbackCommand: skillBuilder.loopRecommendation?.fallbackCommand || null,
    loopRecommendedSkillMetadata: skillBuilder.loopRecommendation?.metadata || null,
    skillRanking: skillBuilder.ranking,
    championshipGateEligible: Boolean(decisionContext.defi.championshipGate?.eligible),
    championshipGateBlockReason: decisionContext.defi.championshipGate?.blockReason || null,
    championshipGateVersion: decisionContext.defi.championshipGate?.version || CHAMPIONSHIP_EXECUTION_GATE_VERSION,
    watchGateEligible: Boolean(decisionContext.defi.watchGate?.eligible),
    watchGateReason: decisionContext.defi.watchGate?.reason || null,
    watchGateScore: Number(decisionContext.defi.watchGate?.score || 0),
    watchGateVersion: decisionContext.defi.watchGate?.version || CHAMPIONSHIP_WATCH_GATE_VERSION,
    edgeScore: Number(decisionContext.defi.edgeScore || 0),
    executionQualityScore: Number(decisionContext.defi.executionQualityScore || 0),
    autoLiveEligible: false,
  };

  if (
    skillBuilder.loopRecommendation?.recommendedAction &&
    ['messaging_only', 'quote_only', 'defi_swap_execute', 'wait'].includes(skillBuilder.loopRecommendation.recommendedAction) &&
    !(decision.recommendedAction === 'quote_only' && skillBuilder.loopRecommendation.recommendedAction === 'wait')
  ) {
    decision.recommendedAction = skillBuilder.loopRecommendation.recommendedAction;
    decision.reason = skillBuilder.loopRecommendation.reason;
    decision.confidence = skillBuilder.loopRecommendation.confidence;
    decision.estimatedCostClass = skillBuilder.loopRecommendation.estimatedCostClass;
    decision.blockers = skillBuilder.loopRecommendation.blockers;
    decision.autoLiveEligible = false;
  }

  const routeEvaluatorStatus = {
    implemented: true,
    status: 'evaluated',
    recommendedAction: decision.recommendedAction,
    estimatedCostClass: decision.estimatedCostClass,
    policySource: competitivePolicy.source,
    routeOverrideActive: competitivePolicy.routeOverrideActive,
  };

  const finalState = updateAgentState(current => {
    current.routeEvaluatorStatus = routeEvaluatorStatus;
    current.lastRouteEvaluationAt = nowIso;
    current.lastRecommendedAction = decision.recommendedAction;
    current.lastRecommendedReason = decision.reason;
    current.lastRecommendationConfidence = decision.confidence;
    current.routeEvaluatorDecisionContext = sanitizeValue(decisionContext);
    current.watchGateEligible = decision.watchGateEligible;
    current.watchGateReason = decision.watchGateReason;
    current.watchGateScore = decision.watchGateScore;
    current.lastShadowExecution = sanitizeValue(
      decision.watchGateEligible ? decisionContext.defi.shadowExecution : null
    );
    current.edgeScore = decision.edgeScore;
    current.executionQualityScore = decision.executionQualityScore;
    current.championshipGateEligible = decision.championshipGateEligible;
    current.championshipGateBlockReason = decision.championshipGateBlockReason;
    current.lastChampionshipWatchGate = sanitizeValue({
      at: nowIso,
      version: decision.watchGateVersion,
      watchGateEligible: decision.watchGateEligible,
      watchGateReason: decision.watchGateReason,
      watchGateScore: decision.watchGateScore,
      estimatedFeeSats: decisionContext.defi.estimatedFeeSats,
      priceImpactBps: decisionContext.defi.priceImpactBps,
      decision: decisionContext.defi.decision,
      decisionReason: decisionContext.defi.decisionReason,
      quoteFresh: decisionContext.defi.quoteFresh,
      policySource: competitivePolicy.source,
      routeOverrideActive: competitivePolicy.routeOverrideActive,
      effectiveDecisionPolicy: competitivePolicy.decision,
      effectiveWatchPolicy: competitivePolicy.watchGate,
    });
    current.lastChampionshipExecutionGate = sanitizeValue({
      at: nowIso,
      version: decision.championshipGateVersion,
      championshipGateEligible: decision.championshipGateEligible,
      championshipGateBlockReason: decision.championshipGateBlockReason,
      decision: decisionContext.defi.decision,
      decisionReason: decisionContext.defi.decisionReason,
      estimatedFeeSats: decisionContext.defi.estimatedFeeSats,
      priceImpactBps: decisionContext.defi.priceImpactBps,
      quoteFresh: decisionContext.defi.quoteFresh,
      policySource: competitivePolicy.source,
      routeOverrideActive: competitivePolicy.routeOverrideActive,
      effectiveDecisionPolicy: competitivePolicy.decision,
      effectiveChampionshipPolicy: competitivePolicy.championshipGate,
    });
    current.skillBuilder = skillBuilder.nextBuilderState;
    current.routeEvaluatorHistory = trimHistory([
      ...(current.routeEvaluatorHistory || []),
      {
        at: nowIso,
        amountSats,
        recommendedAction: decision.recommendedAction,
        recommendedSkillId: decision.recommendedSkillId,
        recommendedSkillReason: decision.recommendedSkillReason,
        recommendedSkillScore: decision.recommendedSkillScore,
        loopRecommendedSkillId: decision.loopRecommendedSkillId,
        nextBestAction: decision.nextBestAction,
        confidence: decision.confidence,
        estimatedCostClass: decision.estimatedCostClass,
        reason: decision.reason,
        blockers: decision.blockers,
        watchGateEligible: decision.watchGateEligible,
        watchGateReason: decision.watchGateReason,
        watchGateScore: decision.watchGateScore,
        edgeScore: decision.edgeScore,
        executionQualityScore: decision.executionQualityScore,
        championshipGateEligible: decision.championshipGateEligible,
        championshipGateBlockReason: decision.championshipGateBlockReason,
        policySource: competitivePolicy.source,
        routeOverrideActive: competitivePolicy.routeOverrideActive,
        effectiveDecisionPolicy: competitivePolicy.decision,
      },
    ]);
    current.skills.routeEvaluator = {
      ...current.skills.routeEvaluator,
      enabled: true,
      lastRunAt: nowIso,
      lastSuccessAt: nowIso,
      lastSkipReason: null,
      lastOutcome: 'completed',
      lastAttemptMode: dryRun ? 'dry_run' : statusOnly ? 'status_only' : 'evaluate',
      lastStatusCode: 200,
    };
    return current;
  });

  writeAgentStatus({
    checkedAt: nowIso,
    routeEvaluator: {
      recommendedAction: decision.recommendedAction,
      recommendedSkillId: decision.recommendedSkillId,
      recommendedSkillLabel: decision.recommendedSkillLabel,
      recommendedSkillScore: decision.recommendedSkillScore,
      nextBestAction: decision.nextBestAction,
      confidence: decision.confidence,
      estimatedCostClass: decision.estimatedCostClass,
      reason: decision.reason,
      blockers: decision.blockers,
      watchGateEligible: decision.watchGateEligible,
      watchGateReason: decision.watchGateReason,
      watchGateScore: decision.watchGateScore,
      edgeScore: decision.edgeScore,
      executionQualityScore: decision.executionQualityScore,
      championshipGateEligible: decision.championshipGateEligible,
      championshipGateBlockReason: decision.championshipGateBlockReason,
      watchGateVersion: decision.watchGateVersion,
      championshipGateVersion: decision.championshipGateVersion,
      decision: decisionContext.defi.decision,
      decisionReason: decisionContext.defi.decisionReason,
      estimatedFeeSats: decisionContext.defi.estimatedFeeSats,
      priceImpactBps: decisionContext.defi.priceImpactBps,
      quoteFresh: decisionContext.defi.quoteFresh,
      policySource: competitivePolicy.source,
      routeOverrideActive: competitivePolicy.routeOverrideActive,
      effectiveDecisionPolicy: competitivePolicy.decision,
      effectiveWatchPolicy: competitivePolicy.watchGate,
      effectiveChampionshipPolicy: competitivePolicy.championshipGate,
    },
  });

  appendJsonLog('route_evaluator_decision_made', sanitizeValue({
    recommendedAction: decision.recommendedAction,
    recommendedSkillId: decision.recommendedSkillId,
    recommendedSkillLabel: decision.recommendedSkillLabel,
    recommendedSkillScore: decision.recommendedSkillScore,
    nextBestAction: decision.nextBestAction,
    confidence: decision.confidence,
    estimatedCostClass: decision.estimatedCostClass,
    reason: decision.reason,
    blockers: decision.blockers,
    watchGateEligible: decision.watchGateEligible,
    watchGateReason: decision.watchGateReason,
    watchGateScore: decision.watchGateScore,
    edgeScore: decision.edgeScore,
    executionQualityScore: decision.executionQualityScore,
    watchGateVersion: decision.watchGateVersion,
    championshipGateEligible: decision.championshipGateEligible,
    championshipGateBlockReason: decision.championshipGateBlockReason,
    championshipGateVersion: decision.championshipGateVersion,
    decision: decisionContext.defi.decision,
    decisionReason: decisionContext.defi.decisionReason,
    estimatedFeeSats: decisionContext.defi.estimatedFeeSats,
    priceImpactBps: decisionContext.defi.priceImpactBps,
    quoteFresh: decisionContext.defi.quoteFresh,
    policySource: competitivePolicy.source,
    routeOverrideActive: competitivePolicy.routeOverrideActive,
    effectiveDecisionPolicy: competitivePolicy.decision,
    effectiveWatchPolicy: competitivePolicy.watchGate,
    effectiveChampionshipPolicy: competitivePolicy.championshipGate,
  }));

  appendJsonLog('route_evaluator_completed', {
    ok: true,
    recommendedAction: decision.recommendedAction,
    confidence: decision.confidence,
    championshipGateEligible: decision.championshipGateEligible,
    championshipGateBlockReason: decision.championshipGateBlockReason,
    watchGateEligible: decision.watchGateEligible,
    watchGateReason: decision.watchGateReason,
    watchGateScore: decision.watchGateScore,
    edgeScore: decision.edgeScore,
    executionQualityScore: decision.executionQualityScore,
    policySource: competitivePolicy.source,
    routeOverrideActive: competitivePolicy.routeOverrideActive,
  });

  return {
    ok: true,
    skill: 'route-evaluator',
    statusOnly,
    dryRun,
    amountSats,
    recommendedAction: decision.recommendedAction,
    reason: decision.reason,
    confidence: decision.confidence,
    blockers: sanitizeValue(decision.blockers),
    watchGateEligible: decision.watchGateEligible,
    watchGateReason: decision.watchGateReason,
    watchGateScore: decision.watchGateScore,
    edgeScore: decision.edgeScore,
    executionQualityScore: decision.executionQualityScore,
    watchGateVersion: decision.watchGateVersion,
    championshipGateEligible: decision.championshipGateEligible,
    championshipGateBlockReason: decision.championshipGateBlockReason,
    championshipGateVersion: decision.championshipGateVersion,
    policySource: competitivePolicy.source,
    routeOverrideActive: competitivePolicy.routeOverrideActive,
    effectiveDecisionPolicy: sanitizeValue(competitivePolicy.decision),
    effectiveWatchPolicy: sanitizeValue(competitivePolicy.watchGate),
    effectiveChampionshipPolicy: sanitizeValue(competitivePolicy.championshipGate),
    recommendedSkillId: decision.recommendedSkillId,
    recommendedSkillLabel: decision.recommendedSkillLabel,
    recommendedSkillCategory: decision.recommendedSkillCategory,
    recommendedSkillReason: decision.recommendedSkillReason,
    recommendedSkillWhyNow: decision.recommendedSkillWhyNow,
    recommendedSkillCommand: decision.recommendedSkillCommand,
    recommendedSkillFallbackCommand: decision.recommendedSkillFallbackCommand,
    recommendedSkillApprovalRequired: decision.recommendedSkillApprovalRequired,
    recommendedSkillAutoExecutable: decision.recommendedSkillAutoExecutable,
    recommendedSkillScore: decision.recommendedSkillScore,
    loopRecommendedSkillId: decision.loopRecommendedSkillId,
    loopRecommendedSkillCommand: decision.loopRecommendedSkillCommand,
    loopRecommendedSkillFallbackCommand: decision.loopRecommendedSkillFallbackCommand,
    loopRecommendedSkillMetadata: sanitizeValue(decision.loopRecommendedSkillMetadata),
    skillRanking: sanitizeValue(skillBuilder.ranking),
    decisionContext: sanitizeValue({
      messaging: decisionContext.messaging,
      wallet: decisionContext.wallet,
      defi: {
        status: decisionContext.defi.status,
        amountSats: decisionContext.defi.amountSats,
        estimatedFeeSats: decisionContext.defi.estimatedFeeSats,
        slippageBps: decisionContext.defi.slippageBps,
        priceImpactBps: decisionContext.defi.priceImpactBps,
        quoteFresh: decisionContext.defi.quoteFresh,
        economicVerdict: decisionContext.defi.economicVerdict,
        decision: decisionContext.defi.decision,
        decisionReason: decisionContext.defi.decisionReason,
        blockers: decisionContext.defi.blockers,
        shadowExecution: decisionContext.defi.shadowExecution,
        edgeScore: decisionContext.defi.edgeScore,
        executionQualityScore: decisionContext.defi.executionQualityScore,
        policyDiagnostics: decisionContext.defi.policyDiagnostics,
        watchGate: decisionContext.defi.watchGate,
        championshipGate: decisionContext.defi.championshipGate,
      },
      router: decisionContext.router,
      progression: decisionContext.progression,
    }),
    nextBestAction: decision.nextBestAction,
    estimatedCostClass: decision.estimatedCostClass,
    state: finalState,
  };
}

module.exports = {
  runRouteEvaluatorSkill,
  evaluateChampionshipWatchGate,
};
