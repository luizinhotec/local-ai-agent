const crypto = require('crypto');
const { buildPreparedBountyCandidate, getPreparedBountyExecutionState, scanBountyCandidatesFromState } = require('./bounty-scan.cjs');
const { buildBountyLiveRouteContext } = require('./bounty-execute-route.cjs');

const SKILL_IDS = {
  messagingPaid: 'messaging_paid_outbound',
  messagingReplies: 'messaging_safe_replies',
  walletMicro: 'wallet_micro_transfer',
  bountyInteractions: 'bounty_interactions',
  bountyExecute: 'bounty_execute',
  defiMonitor: 'defi_quote_monitor',
};

const HISTORY_LIMIT = 20;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createDefaultSkillState(id) {
  return {
    id,
    evaluations: 0,
    recommendations: 0,
    baseScore: 0,
    finalScore: 0,
    strategicWeight: 0,
    scoreBreakdown: {},
    penaltyBreakdown: {},
    penalties: 0,
    lastStatus: 'never',
    lastReason: null,
    lastBlockedReason: null,
    lastRecommendedAt: null,
    lastEvaluatedAt: null,
    lastCommand: null,
    lastManualCommand: null,
    lastTargetHash: null,
    lastCandidateCount: 0,
    lastPreparedCandidateId: null,
    lastUsefulSignalAt: null,
    cooldownUntil: null,
    breakerOpenUntil: null,
    breakerReason: null,
    consecutiveFailures: 0,
    manualApprovalRequired: false,
    autoExecutable: false,
  };
}

function defaultSkillBuilderState() {
  return {
    implemented: false,
    lastEvaluationAt: null,
    lastRecommendedSkillId: null,
    lastRecommendedSkillCommand: null,
    lastLoopRecommendedAction: null,
    lastLoopRecommendedCommand: null,
    lastLoopRecommendedSkillId: null,
    ranking: [],
    skillStates: Object.fromEntries(
      Object.values(SKILL_IDS).map(id => [id, createDefaultSkillState(id)])
    ),
  };
}

function mergeSkillBuilderState(current) {
  const defaults = defaultSkillBuilderState();
  const incoming = current || {};
  const skillStates = {
    ...defaults.skillStates,
    ...(incoming.skillStates || {}),
  };

  for (const id of Object.values(SKILL_IDS)) {
    skillStates[id] = {
      ...createDefaultSkillState(id),
      ...(skillStates[id] || {}),
    };
  }

  return {
    ...defaults,
    ...incoming,
    skillStates,
  };
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function hasActiveCooldown(skillState) {
  if (!skillState?.cooldownUntil) return false;
  const until = Date.parse(skillState.cooldownUntil);
  return Number.isFinite(until) && until > Date.now();
}

function hasOpenBreaker(skillState) {
  if (!skillState?.breakerOpenUntil) return false;
  const until = Date.parse(skillState.breakerOpenUntil);
  return Number.isFinite(until) && until > Date.now();
}

function buildScoredSkill({
  id,
  label,
  category,
  priority,
  baseScore,
  strategicWeight,
  scoreBreakdown = {},
  penaltyBreakdown = {},
  status,
  reason,
  blockers = [],
  command = null,
  fallbackCommand = null,
  approvalRequired = false,
  autoExecutable = false,
  costClass = 'zero',
  cooldownMin = 0,
  targetKey = null,
  lastCandidateCount = 0,
  usefulSignalFound = false,
  metadata = null,
  preparedCandidateId = null,
  requiresDryRunFirst = false,
}) {
  const normalizedScoreBreakdown = Object.fromEntries(
    Object.entries(scoreBreakdown).filter(([, value]) => Number(value) !== 0)
  );
  const normalizedPenaltyBreakdown = Object.fromEntries(
    Object.entries(penaltyBreakdown).filter(([, value]) => Number(value) !== 0)
  );
  const penalties = Object.values(normalizedPenaltyBreakdown).reduce((sum, value) => sum + Number(value || 0), 0);
  const applyStrategicWeight = Number(baseScore || 0) > 0 || Boolean(usefulSignalFound);
  const weightedScore = Number(baseScore || 0) + (applyStrategicWeight ? Number(strategicWeight || 0) : 0);
  const finalScore = Math.max(0, weightedScore - penalties);

  return {
    id,
    label,
    category,
    priority,
    baseScore,
    strategicWeight,
    penalties,
    finalScore,
    scoreBreakdown: normalizedScoreBreakdown,
    penaltyBreakdown: normalizedPenaltyBreakdown,
    status,
    reason,
    blockers: unique(blockers),
    command,
    fallbackCommand,
    approvalRequired,
    autoExecutable,
    costClass,
    cooldownMin,
    cooldownMs: cooldownMin * 60 * 1000,
    targetKey,
    targetHash: targetKey ? sha256(targetKey).slice(0, 12) : null,
    lastCandidateCount,
    preparedCandidateId,
    usefulSignalFound,
    requiresDryRunFirst,
    metadata,
  };
}

function withOperationalPenalties(previousSkillState, penalties = {}, options = {}) {
  const next = { ...penalties };
  if (hasOpenBreaker(previousSkillState)) {
    next.breaker_open = Math.max(next.breaker_open || 0, options.breakerPenalty || 24);
  }
  if (hasActiveCooldown(previousSkillState)) {
    next.cooldown_active = Math.max(next.cooldown_active || 0, options.cooldownPenalty || 14);
  }
  return next;
}

function evaluateMessagingPaid(context, previousSkillState) {
  const paymentItems = context.messaging.paymentRequiredItems || [];
  const nextItem = paymentItems[0] || null;
  const blockers = [];
  let status = nextItem ? 'candidate_found' : 'no_candidates';
  let reason = nextItem ? 'paid_outbound_pending' : 'no_payment_required_messages';
  const baseScore = nextItem ? 72 : 0;
  const strategicWeight = 24;
  const scoreBreakdown = {
    execution_real: nextItem ? 28 : 0,
    championship_signal: nextItem ? 20 : 0,
    payment_required: nextItem ? 24 : 0,
  };
  const penaltyBreakdown = withOperationalPenalties(previousSkillState, {}, {
    breakerPenalty: 18,
    cooldownPenalty: 16,
  });

  if (!nextItem) {
    return buildScoredSkill({
      id: SKILL_IDS.messagingPaid,
      label: 'Messaging Pago',
      category: 'messaging',
      priority: 1,
      baseScore,
      strategicWeight,
      scoreBreakdown,
      penaltyBreakdown,
      status,
      reason,
      blockers,
      command: 'npm run agent:messages:pay -- --dry-run --max-payments=1',
      fallbackCommand: 'npm run agent:messages -- --status-only',
      approvalRequired: true,
      autoExecutable: false,
      costClass: 'low',
      cooldownMin: 5,
      lastCandidateCount: 0,
      usefulSignalFound: false,
      metadata: { queueDepth: 0 },
    });
  }

  if (context.messaging.policyMode !== 'full_outbound') {
    blockers.push('full_outbound_not_enabled');
    status = 'blocked';
    reason = 'paid_outbound_blocked_by_policy';
    penaltyBreakdown.policy_block = 48;
  }
  if (!context.wallet.ready || !context.wallet.signerReady || !context.wallet.stacksNetworkReady) {
    blockers.push('wallet_not_ready_for_paid_messaging');
    status = 'blocked';
    reason = 'wallet_not_ready_for_paid_messaging';
    penaltyBreakdown.wallet_not_ready = 26;
  }
  if (Number(context.wallet.sbtcSats || 0) < Number(nextItem.paymentSatoshis || 100)) {
    blockers.push('insufficient_sbtc_for_message_payment');
    status = 'blocked';
    reason = 'insufficient_sbtc_for_message_payment';
    penaltyBreakdown.insufficient_balance = 32;
  }

  return buildScoredSkill({
    id: SKILL_IDS.messagingPaid,
    label: 'Messaging Pago',
    category: 'messaging',
    priority: 1,
    baseScore,
    strategicWeight,
    scoreBreakdown,
    penaltyBreakdown,
    status,
    reason,
    blockers,
    command: 'npm run agent:messages:pay -- --live --approve-live --max-payments=1',
    fallbackCommand: 'npm run agent:messages:pay -- --dry-run --max-payments=1',
    approvalRequired: true,
    autoExecutable: false,
    costClass: 'low',
    cooldownMin: 5,
    targetKey: `${nextItem.targetBtcAddress || 'unknown'}:${nextItem.contentHash || nextItem.content || ''}`,
    lastCandidateCount: paymentItems.length,
    usefulSignalFound: paymentItems.length > 0,
    metadata: {
      queueItemId: nextItem.id || null,
      targetBtcAddress: nextItem.targetBtcAddress || null,
      paymentSatoshis: nextItem.paymentSatoshis || 100,
      queueDepth: paymentItems.length,
    },
  });
}

function evaluateMessagingReplies(context, previousSkillState) {
  const candidate = (context.messaging.pendingReplyTargets || [])[0] || null;
  const blockers = [];
  let status = candidate ? 'candidate_found' : 'no_candidates';
  let reason = candidate ? 'safe_reply_candidate_available' : 'no_pending_safe_replies';
  const baseScore = candidate ? 60 : 0;
  const strategicWeight = 18;
  const scoreBreakdown = {
    execution_real: candidate ? 18 : 0,
    championship_signal: candidate ? 16 : 0,
    low_cost: candidate ? 12 : 0,
    social_presence: candidate ? 14 : 0,
  };
  const penaltyBreakdown = withOperationalPenalties(previousSkillState, {}, {
    breakerPenalty: 0,
    cooldownPenalty: 14,
  });

  if (!candidate && (context.messaging.pendingReplyCount || 0) > 0) {
    blockers.push('reply_target_cooldown_active');
    status = 'cooldown';
    reason = 'reply_candidates_blocked_by_target_cooldown';
    penaltyBreakdown.reply_target_cooldown = 26;
  }

  return buildScoredSkill({
    id: SKILL_IDS.messagingReplies,
    label: 'Messaging Seguro',
    category: 'messaging',
    priority: 2,
    baseScore,
    strategicWeight,
    scoreBreakdown,
    penaltyBreakdown,
    status,
    reason,
    blockers,
    command: 'npm run agent:messages -- --live --reply-pending --max-replies-per-cycle=1',
    fallbackCommand: 'npm run agent:messages -- --status-only',
    approvalRequired: false,
    autoExecutable: status === 'candidate_found',
    costClass: 'zero',
    cooldownMin: Math.max(1, Math.min(context.messaging.cooldownMin || 60, 15)),
    targetKey: candidate?.peerBtcAddress || candidate?.messageId || null,
    lastCandidateCount: context.messaging.pendingReplyCount || 0,
    usefulSignalFound: Boolean(candidate),
    metadata: {
      pendingReplyCount: context.messaging.pendingReplyCount || 0,
      unreadCount: context.messaging.unreadCount || 0,
    },
  });
}

function evaluateWalletMicro(context, previousSkillState) {
  const plan = context.wallet.microPlan || {};
  const blockers = [...(plan.blockers || [])];
  const ready = plan.status === 'ready_for_explicit_live';
  const baseScore = ready ? 42 : 10;
  const strategicWeight = 10;
  const scoreBreakdown = {
    execution_real: ready ? 18 : 0,
    low_risk_controlled: ready ? 14 : 0,
    operator_proof: ready ? 10 : 0,
  };
  const penaltyBreakdown = withOperationalPenalties(previousSkillState, {}, {
    breakerPenalty: 16,
    cooldownPenalty: 18,
  });
  let status = ready ? 'candidate_found' : 'blocked';
  let reason = plan.reason || (ready ? 'wallet_micro_ready' : 'wallet_micro_not_ready');

  if (!ready && blockers.includes('feature_disabled')) {
    penaltyBreakdown.feature_disabled = 24;
  }
  if (!ready && blockers.length > 0) {
    penaltyBreakdown.blockers_present = Math.max(penaltyBreakdown.blockers_present || 0, 12);
  }

  return buildScoredSkill({
    id: SKILL_IDS.walletMicro,
    label: 'Wallet Micro',
    category: 'wallet',
    priority: 4,
    baseScore,
    strategicWeight,
    scoreBreakdown,
    penaltyBreakdown,
    status,
    reason,
    blockers,
    command: 'npm run agent:wallet:micro:live',
    fallbackCommand: 'npm run agent:wallet:micro:dryrun',
    approvalRequired: true,
    autoExecutable: false,
    costClass: 'low',
    cooldownMin: 30,
    targetKey: plan.targetAddress || context.wallet.stxAddress || null,
    lastCandidateCount: ready ? 1 : 0,
    usefulSignalFound: ready,
    metadata: {
      amountMicroStx: plan.amountMicroStx || null,
      targetAddress: plan.targetAddress || null,
      feeEstimateMicroStx: plan.feeEstimateMicroStx || null,
    },
  });
}

function evaluateBountyInteractions(currentState, previousSkillState, nowIso) {
  const scan = scanBountyCandidatesFromState(currentState);
  const prepared = buildPreparedBountyCandidate(currentState, { nowIso });
  const effectiveCandidate = prepared.candidate || null;
  const blockers = [...(prepared.blockers || scan.blockers || [])];
  const status = prepared.status || scan.status || 'no_candidates';
  const reason = prepared.reason || scan.reason || 'no_bounty_candidates_found';
  const effectiveEligible = Boolean(effectiveCandidate);
  const baseScore = effectiveEligible ? 54 : status === 'source_unavailable' ? 6 : 0;
  const strategicWeight = 20;
  const scoreBreakdown = {
    championship_signal: effectiveEligible ? 18 : 0,
    execution_prep: effectiveEligible ? 16 : 0,
    useful_external_lead: effectiveEligible ? 20 : 0,
  };
  const penaltyBreakdown = withOperationalPenalties(previousSkillState, {}, {
    breakerPenalty: 12,
    cooldownPenalty: 14,
  });

  if (status === 'source_unavailable') {
    penaltyBreakdown.source_unavailable = 24;
  }
  if (status === 'no_candidates') {
    penaltyBreakdown.no_candidates = 10;
  }
  if (status === 'cooldown') {
    penaltyBreakdown.cooldown_state = 14;
  }

  return buildScoredSkill({
    id: SKILL_IDS.bountyInteractions,
    label: 'Bounties',
    category: 'bounty',
    priority: 3,
    baseScore,
    strategicWeight,
    scoreBreakdown,
    penaltyBreakdown,
    status,
    reason,
      blockers,
    command: effectiveCandidate?.command || scan.command,
    fallbackCommand: effectiveCandidate?.fallbackCommand || scan.fallbackCommand,
    approvalRequired: Boolean(effectiveCandidate?.approvalRequired || scan.approvalRequired),
    autoExecutable: false,
    costClass: 'zero',
    cooldownMin: Math.max(1, Math.floor((((effectiveEligible ? 45 * 60 * 1000 : scan.cooldownMs) || 3600000)) / 60000)),
    targetKey: effectiveCandidate?.candidateId || effectiveCandidate?.peerBtcAddress || null,
    lastCandidateCount: effectiveEligible ? 1 : 0,
    usefulSignalFound: effectiveEligible,
    metadata: {
      candidates: prepared.candidates || [],
      preparedStatus: prepared.status,
      preparedReason: prepared.reason,
    },
  });
}

function evaluateBountyExecute(currentState, previousSkillState, config, nowIso) {
  const route = buildBountyLiveRouteContext(currentState, config, { nowIso });
  const prepared = route.prepared;
  const blockers = [...new Set([...(prepared.blockers || []), ...(route.preconditionBlockers || [])])];
  let status = prepared.status || 'no_prepared_candidate';
  let reason = prepared.reason || 'no_prepared_bounty_candidate_available';
  const baseScore = route.liveEligible ? 82 : prepared.eligible ? 70 : status === 'blocked' ? 18 : 0;
  const strategicWeight = route.liveEligible ? 34 : prepared.eligible ? 28 : 0;
  const scoreBreakdown = {
    execution_real: prepared.eligible ? 26 : 0,
    championship_signal: prepared.eligible ? 22 : 0,
    prepared_manual_candidate: prepared.eligible ? 22 : 0,
    live_route_allowlisted: route.liveSupported ? 8 : 0,
    live_manual_ready: route.liveEligible ? 12 : 0,
  };
  const penaltyBreakdown = withOperationalPenalties(previousSkillState, {}, {
    breakerPenalty: 20,
    cooldownPenalty: 20,
  });

  if (prepared.approvalRequired) {
    penaltyBreakdown.approval_required = prepared.eligible ? 8 : 4;
  }
  if (status === 'cooldown') {
    penaltyBreakdown.cooldown_state = Math.max(penaltyBreakdown.cooldown_state || 0, 36);
  }
  if (status === 'retry_scheduled') {
    penaltyBreakdown.retry_scheduled = Math.max(penaltyBreakdown.retry_scheduled || 0, 32);
  }
  if (blockers.includes('prepared_candidate_stale')) {
    penaltyBreakdown.candidate_stale = Math.max(penaltyBreakdown.candidate_stale || 0, 44);
  }
  if (blockers.includes('candidate_source_unavailable') || blockers.includes('prepared_candidate_source_missing')) {
    penaltyBreakdown.source_unavailable = Math.max(penaltyBreakdown.source_unavailable || 0, 38);
  }
  if (blockers.includes('unsupported_live_action_type') || blockers.includes('live_route_not_allowlisted')) {
    penaltyBreakdown.unsupported_live_route = Math.max(penaltyBreakdown.unsupported_live_route || 0, 42);
  }
  if (blockers.includes('missing_required_candidate_fields')) {
    penaltyBreakdown.missing_required_fields = Math.max(penaltyBreakdown.missing_required_fields || 0, 40);
  }
  if (status === 'no_prepared_candidate') {
    penaltyBreakdown.no_prepared_candidate = Math.max(penaltyBreakdown.no_prepared_candidate || 0, 18);
  }
  if (!route.dryRunSatisfied && route.liveSupported) {
    penaltyBreakdown.dry_run_required = Math.max(penaltyBreakdown.dry_run_required || 0, 6);
  }
  if (blockers.length > 0) {
    penaltyBreakdown.blockers_present = Math.max(penaltyBreakdown.blockers_present || 0, 18);
  }
  if (prepared.eligible && blockers.length > 0) {
    status = 'blocked';
    reason = route.liveReason;
  } else if (route.liveEligible) {
    status = 'approval_required';
    reason = 'prepared_bounty_live_reply_ready';
  } else if (prepared.eligible) {
    status = 'candidate_ready_for_manual_execution';
    reason = route.dryRunSatisfied ? 'prepared_bounty_candidate_ready' : 'dry_run_required_before_live';
  }

  return buildScoredSkill({
    id: SKILL_IDS.bountyExecute,
    label: 'Bounty Execute',
    category: 'bounty',
    priority: 3,
    baseScore,
    strategicWeight,
    scoreBreakdown,
    penaltyBreakdown,
    status,
    reason,
    blockers,
    command: route.liveEligible ? route.liveCommand : route.dryRunCommand,
    fallbackCommand: route.fallbackCommand,
    approvalRequired: true,
    autoExecutable: false,
    costClass: 'zero',
    cooldownMin: Math.max(0, Math.floor((prepared.cooldownMs || 0) / 60000)),
    targetKey: prepared.preparedCandidateId || prepared.preparedCandidate?.peerBtcAddress || null,
    lastCandidateCount: prepared.preparedCandidateId ? 1 : 0,
    preparedCandidateId: prepared.preparedCandidateId || null,
    usefulSignalFound: Boolean(prepared.preparedCandidateId),
    requiresDryRunFirst: !route.dryRunSatisfied,
    metadata: {
      preparedCandidate: prepared.preparedCandidate || null,
      sourceAvailable: prepared.sourceAvailable,
      liveCommand: route.liveCommand,
      liveRouteName: route.liveRouteName,
      liveEligible: route.liveEligible,
      candidateActionType: route.candidateActionType,
      whyNow: route.whyNow,
    },
  });
}

function evaluateDefiMonitor(context, amountSats, previousSkillState) {
  const blockers = [...(context.defi.blockers || [])];
  const quoteAvailable = Boolean(context.wallet.sbtcSats > 0 && context.defi.quoteSummary?.amountOut);
  let status = quoteAvailable ? 'ready' : 'idle';
  let reason = quoteAvailable ? 'defi_quote_monitoring_available' : 'defi_quote_monitoring_idle';
  const baseScore = quoteAvailable ? 18 : 4;
  const strategicWeight = 2;
  const scoreBreakdown = {
    observability: quoteAvailable ? 10 : 4,
    residual_signal: quoteAvailable ? 8 : 0,
  };
  const penaltyBreakdown = withOperationalPenalties(previousSkillState, {
    monitor_only: quoteAvailable ? 6 : 2,
  }, {
    breakerPenalty: 8,
    cooldownPenalty: 8,
  });

  if (blockers.includes('circuit_breaker_open')) {
    status = 'blocked';
    reason = 'defi_monitor_circuit_breaker_open';
    penaltyBreakdown.breaker_open = Math.max(penaltyBreakdown.breaker_open || 0, 8);
  }
  if (blockers.length > 0) {
    penaltyBreakdown.blockers_present = Math.max(penaltyBreakdown.blockers_present || 0, 4);
  }
  if (!quoteAvailable) {
    penaltyBreakdown.source_unavailable = Math.max(penaltyBreakdown.source_unavailable || 0, 8);
  }

  return buildScoredSkill({
    id: SKILL_IDS.defiMonitor,
    label: 'DeFi Monitor',
    category: 'defi',
    priority: 5,
    baseScore,
    strategicWeight,
    scoreBreakdown,
    penaltyBreakdown,
    status,
    reason,
    blockers,
    command: `npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=${amountSats}`,
    fallbackCommand: 'npm run agent:status',
    approvalRequired: false,
    autoExecutable: status === 'ready',
    costClass: 'zero',
    cooldownMin: 15,
    targetKey: `sbtc-usdcx:${amountSats}`,
    lastCandidateCount: quoteAvailable ? 1 : 0,
    usefulSignalFound: quoteAvailable,
    metadata: {
      amountSats,
      economicVerdict: context.defi.economicVerdict || null,
      estimatedFeeSats: context.defi.estimatedFeeSats || null,
      slippageBps: context.defi.slippageBps || null,
    },
  });
}

function updateSkillState(previous, evaluation, nowIso) {
  const next = {
    ...createDefaultSkillState(evaluation.id),
    ...(previous || {}),
  };

  next.evaluations += 1;
  next.baseScore = evaluation.baseScore;
  next.finalScore = evaluation.finalScore;
  next.strategicWeight = evaluation.strategicWeight;
  next.scoreBreakdown = evaluation.scoreBreakdown;
  next.penaltyBreakdown = evaluation.penaltyBreakdown;
  next.penalties = evaluation.penalties;
  next.lastStatus = evaluation.status;
  next.lastReason = evaluation.reason;
  next.lastBlockedReason = evaluation.blockers[0] || null;
  next.lastEvaluatedAt = nowIso;
  next.lastCommand = evaluation.command;
  next.lastManualCommand = evaluation.command;
  next.lastTargetHash = evaluation.targetHash;
  next.lastCandidateCount = evaluation.lastCandidateCount || 0;
  next.lastPreparedCandidateId = evaluation.preparedCandidateId || null;
  next.manualApprovalRequired = Boolean(evaluation.approvalRequired);
  next.autoExecutable = Boolean(evaluation.autoExecutable);

  if (evaluation.usefulSignalFound) {
    next.lastUsefulSignalAt = nowIso;
  }

  if (['candidate_found', 'ready'].includes(evaluation.status)) {
    next.consecutiveFailures = 0;
    next.breakerOpenUntil = null;
    next.breakerReason = null;
  } else if (['blocked', 'source_unavailable'].includes(evaluation.status) && evaluation.blockers.length > 0) {
    next.consecutiveFailures += 1;
    if (next.consecutiveFailures >= 3) {
      next.breakerOpenUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      next.breakerReason = evaluation.blockers[0];
    }
  }

  if (['candidate_found', 'ready', 'cooldown'].includes(evaluation.status)) {
    next.cooldownUntil = evaluation.cooldownMin > 0
      ? new Date(Date.now() + evaluation.cooldownMin * 60 * 1000).toISOString()
      : null;
  }

  return next;
}

function chooseLoopRecommendation(evaluations, amountSats) {
  const safeReply = evaluations.find(item => item.id === SKILL_IDS.messagingReplies);
  const defiMonitor = evaluations.find(item => item.id === SKILL_IDS.defiMonitor);

  if (safeReply && safeReply.status === 'candidate_found') {
    return {
      skillId: safeReply.id,
      skillLabel: safeReply.label,
      recommendedAction: 'messaging_only',
      reason: safeReply.reason,
      confidence: 0.93,
      estimatedCostClass: 'zero',
      blockers: safeReply.blockers,
      command: safeReply.command,
      fallbackCommand: safeReply.fallbackCommand,
      metadata: safeReply.metadata,
    };
  }

  if (defiMonitor && defiMonitor.status === 'ready') {
    return {
      skillId: defiMonitor.id,
      skillLabel: defiMonitor.label,
      recommendedAction: 'quote_only',
      reason: defiMonitor.reason,
      confidence: 0.7,
      estimatedCostClass: 'zero',
      blockers: defiMonitor.blockers,
      command: `npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=${amountSats}`,
      fallbackCommand: defiMonitor.fallbackCommand,
      metadata: defiMonitor.metadata,
    };
  }

  return {
    skillId: null,
    skillLabel: null,
    recommendedAction: 'wait',
    reason: 'no_safe_auto_action_available',
    confidence: 0.7,
    estimatedCostClass: 'zero',
    blockers: [],
    command: null,
    fallbackCommand: 'npm run agent:status',
    metadata: null,
  };
}

function evaluateSkillBuilder(context, currentState, config, options = {}) {
  const amountSats = Number(options.amountSats || 3000);
  const nowIso = options.nowIso || new Date().toISOString();
  const builderState = mergeSkillBuilderState(currentState.skillBuilder);

  const evaluations = [
    evaluateMessagingPaid(context, builderState.skillStates[SKILL_IDS.messagingPaid]),
    evaluateMessagingReplies(context, builderState.skillStates[SKILL_IDS.messagingReplies]),
    evaluateBountyExecute(currentState, builderState.skillStates[SKILL_IDS.bountyExecute], config, nowIso),
    evaluateBountyInteractions(currentState, builderState.skillStates[SKILL_IDS.bountyInteractions], nowIso),
    evaluateWalletMicro(context, builderState.skillStates[SKILL_IDS.walletMicro]),
    evaluateDefiMonitor(context, amountSats, builderState.skillStates[SKILL_IDS.defiMonitor]),
  ].sort((left, right) => {
    if (right.finalScore !== left.finalScore) return right.finalScore - left.finalScore;
    return left.priority - right.priority;
  });

  const topSkill = evaluations[0] || null;
  const loopRecommendation = chooseLoopRecommendation(evaluations, amountSats);

  const nextSkillStates = { ...builderState.skillStates };
  for (const evaluation of evaluations) {
    const previous = nextSkillStates[evaluation.id];
    const updated = updateSkillState(previous, evaluation, nowIso);
    if (topSkill && topSkill.id === evaluation.id) {
      updated.recommendations += 1;
      updated.lastRecommendedAt = nowIso;
    }
    nextSkillStates[evaluation.id] = updated;
  }

  return {
        recommendedSkill: topSkill
      ? {
          skillId: topSkill.id,
          label: topSkill.label,
          category: topSkill.category,
          reason: topSkill.reason,
          whyNow: topSkill.metadata?.whyNow || topSkill.reason,
          command: topSkill.command,
          fallbackCommand: topSkill.fallbackCommand,
          approvalRequired: topSkill.approvalRequired,
          autoExecutable: topSkill.autoExecutable,
          score: topSkill.finalScore,
          baseScore: topSkill.baseScore,
          strategicWeight: topSkill.strategicWeight,
          scoreBreakdown: topSkill.scoreBreakdown,
          penaltyBreakdown: topSkill.penaltyBreakdown,
          status: topSkill.status,
          blockers: topSkill.blockers,
          costClass: topSkill.costClass,
          lastCandidateCount: topSkill.lastCandidateCount,
          preparedCandidateId: topSkill.preparedCandidateId,
          usefulSignalFound: topSkill.usefulSignalFound,
          requiresDryRunFirst: topSkill.requiresDryRunFirst,
          metadata: topSkill.metadata,
        }
      : null,
    loopRecommendation,
    ranking: evaluations.map(item => ({
      skillId: item.id,
      label: item.label,
      category: item.category,
      baseScore: item.baseScore,
      strategicWeight: item.strategicWeight,
      penalties: item.penalties,
      finalScore: item.finalScore,
      scoreBreakdown: item.scoreBreakdown,
      penaltyBreakdown: item.penaltyBreakdown,
      status: item.status,
      reason: item.reason,
      blockers: item.blockers,
      approvalRequired: item.approvalRequired,
      autoExecutable: item.autoExecutable,
      command: item.command,
      fallbackCommand: item.fallbackCommand,
      costClass: item.costClass,
      lastCandidateCount: item.lastCandidateCount,
      preparedCandidateId: item.preparedCandidateId,
      usefulSignalFound: item.usefulSignalFound,
      requiresDryRunFirst: item.requiresDryRunFirst,
      metadata: item.metadata,
    })),
    nextBuilderState: {
      implemented: true,
      lastEvaluationAt: nowIso,
      lastRecommendedSkillId: topSkill?.id || null,
      lastRecommendedSkillCommand: topSkill?.command || null,
      lastLoopRecommendedAction: loopRecommendation.recommendedAction,
      lastLoopRecommendedCommand: loopRecommendation.command,
      lastLoopRecommendedSkillId: loopRecommendation.skillId || null,
      ranking: evaluations.map(item => ({
        skillId: item.id,
        finalScore: item.finalScore,
        status: item.status,
        reason: item.reason,
        blockers: item.blockers,
        scoreBreakdown: item.scoreBreakdown,
        penaltyBreakdown: item.penaltyBreakdown,
      })).slice(0, HISTORY_LIMIT),
      skillStates: nextSkillStates,
    },
  };
}

module.exports = {
  SKILL_IDS,
  defaultSkillBuilderState,
  mergeSkillBuilderState,
  evaluateSkillBuilder,
  __test: {
    createDefaultSkillState,
    evaluateMessagingPaid,
    evaluateMessagingReplies,
    evaluateBountyInteractions,
    evaluateBountyExecute,
    evaluateWalletMicro,
    evaluateDefiMonitor,
  },
};
