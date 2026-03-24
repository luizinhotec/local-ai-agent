const { getPreparedBountyExecutionState } = require('./bounty-scan.cjs');
const { LIVE_ROUTE_NAME, ALLOWED_LIVE_ACTION_TYPES } = require('./bounty-execute-constants.cjs');

function firstNonEmpty(values) {
  for (const value of values) {
    if (value) return value;
  }
  return null;
}

function resolveMessagingPolicy(config) {
  const featureEnabled = Boolean(config?.featureFlags?.messaging);
  const safeRepliesOnly = Boolean(config?.messaging?.safeRepliesOnly);
  const fullOutboundEnabled = Boolean(config?.messaging?.fullOutboundEnabled);

  if (!featureEnabled) {
    return {
      enabled: false,
      valid: true,
      policyMode: 'disabled',
      activePolicy: 'disabled',
      outboundAllowed: false,
      reason: 'feature_disabled',
    };
  }

  if (safeRepliesOnly && fullOutboundEnabled) {
    return {
      enabled: true,
      valid: false,
      policyMode: 'invalid',
      activePolicy: 'invalid',
      outboundAllowed: false,
      reason: 'invalid_policy_combination',
    };
  }

  if (safeRepliesOnly) {
    return {
      enabled: true,
      valid: true,
      policyMode: 'safe_replies_only',
      activePolicy: 'safe_replies_only',
      outboundAllowed: false,
      reason: 'safe_replies_only_active',
    };
  }

  if (fullOutboundEnabled) {
    return {
      enabled: true,
      valid: true,
      policyMode: 'full_outbound',
      activePolicy: 'full_outbound',
      outboundAllowed: true,
      reason: 'full_outbound_explicitly_enabled',
    };
  }

  return {
    enabled: true,
    valid: false,
    policyMode: 'invalid',
    activePolicy: 'invalid',
    outboundAllowed: false,
    reason: 'messaging_policy_ambiguous_fail_closed',
  };
}

function canReplyToTarget(state, config, candidate) {
  const target = candidate.peerBtcAddress || candidate.fromAddress;
  const cooldownMs = Number(config?.messaging?.cooldownMin || 60) * 60 * 1000;
  const lastReply = (state.lastReplyTargets || [])
    .filter(entry => entry.peerBtcAddress === target)
    .sort((left, right) => new Date(right.at || 0).getTime() - new Date(left.at || 0).getTime())[0];
  if (lastReply?.at) {
    const lastAt = new Date(lastReply.at).getTime();
    if (Number.isFinite(lastAt) && Date.now() - lastAt < cooldownMs) {
      return { allowed: false, reason: 'reply_target_cooldown_active' };
    }
  }
  return { allowed: true };
}

function hasSuccessfulDryRun(executionState, candidateId) {
  if (!candidateId) return false;
  const lastDryRunResult = executionState?.lastDryRunResult || null;
  return Boolean(
    lastDryRunResult?.ok &&
    lastDryRunResult?.status === 'executed_dry_run' &&
    lastDryRunResult?.preparedCandidateId === candidateId &&
    lastDryRunResult?.liveRouteName === LIVE_ROUTE_NAME
  );
}

function deriveLiveBlockedReason(prepared, blockers) {
  if (blockers.includes('prepared_candidate_stale')) return 'prepared_candidate_stale';
  if (blockers.includes('unsupported_live_action_type')) return 'unsupported_live_action_type';
  if (blockers.includes('missing_required_candidate_fields')) return 'missing_required_candidate_fields';
  if (blockers.includes('live_route_not_allowlisted')) return 'unsupported_live_action_type';
  if (blockers.includes('reply_already_completed')) return 'reply_already_completed';
  if (blockers.includes('reply_target_cooldown_active')) return 'reply_target_cooldown_active';
  if (blockers.includes('messaging_feature_disabled')) return 'messaging_feature_disabled';
  if (blockers.includes('messaging_policy_invalid')) return 'messaging_policy_invalid';
  if (blockers.includes('prepared_candidate_source_missing')) return 'prepared_candidate_source_missing';
  if (blockers.includes('unsupported_candidate_source_type')) return 'unsupported_candidate_source_type';
  if (blockers.includes('dry_run_required_before_live')) return 'dry_run_required_before_live';
  if (blockers.includes('candidate_source_unavailable')) return 'candidate_source_unavailable';
  return prepared.reason || blockers[0] || 'live_preconditions_not_met';
}

function buildBountyLiveRouteContext(state, config, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const normalizedConfig = {
    featureFlags: {
      messaging: Boolean(config?.featureFlags?.messaging),
    },
    messaging: {
      cooldownMin: Number(config?.messaging?.cooldownMin || 60),
      safeRepliesOnly: config?.messaging?.safeRepliesOnly ?? true,
      fullOutboundEnabled: config?.messaging?.fullOutboundEnabled ?? false,
    },
  };
  const prepared = getPreparedBountyExecutionState(state, { nowIso });
  const candidate = prepared.preparedCandidate || null;
  const executionState = state?.bountyExecution || {};
  const inboxMessages = Array.isArray(state?.inboxMessages) ? state.inboxMessages : null;
  const preconditionBlockers = [...(prepared.blockers || [])];
  const candidateActionType = candidate?.candidateActionType || null;
  const supportedLiveRoute = candidate?.supportedLiveRoute || null;
  const sourceMessage = candidate?.sourceMessageId && Array.isArray(inboxMessages)
    ? inboxMessages.find(message => message?.messageId === candidate.sourceMessageId) || null
    : null;
  const messagingPolicy = resolveMessagingPolicy(normalizedConfig);

  if (candidate && candidate.sourceType !== 'inbox_message') {
    preconditionBlockers.push('unsupported_candidate_source_type');
  }
  if (candidate && !candidateActionType) {
    preconditionBlockers.push('missing_candidate_action_type');
  }
  if (candidate && candidateActionType && !ALLOWED_LIVE_ACTION_TYPES.includes(candidateActionType)) {
    preconditionBlockers.push('unsupported_live_action_type');
  }
  if (candidate && supportedLiveRoute !== LIVE_ROUTE_NAME) {
    preconditionBlockers.push('live_route_not_allowlisted');
  }
  if (candidate) {
    const requiredFields = ['candidateId', 'sourceMessageId', 'peerBtcAddress', 'contentPreview'];
    const missingRequiredFields = requiredFields.filter(field => !candidate[field]);
    if (missingRequiredFields.length > 0) {
      preconditionBlockers.push('missing_required_candidate_fields');
    }
  }
  if (candidate && !Array.isArray(inboxMessages)) {
    preconditionBlockers.push('candidate_source_unavailable');
  }
  if (candidate && Array.isArray(inboxMessages) && !sourceMessage) {
    preconditionBlockers.push('prepared_candidate_source_missing');
  }
  if (sourceMessage?.repliedAt) {
    preconditionBlockers.push('reply_already_completed');
  }
  if (!messagingPolicy.enabled) {
    preconditionBlockers.push('messaging_feature_disabled');
  } else if (!messagingPolicy.valid) {
    preconditionBlockers.push('messaging_policy_invalid');
  } else if (sourceMessage) {
    const replySafety = canReplyToTarget(state, normalizedConfig, sourceMessage);
    if (!replySafety.allowed) {
      preconditionBlockers.push(replySafety.reason);
    }
  }

  const normalizedBlockers = [...new Set(preconditionBlockers.filter(Boolean))];
  const dryRunSatisfied = hasSuccessfulDryRun(executionState, prepared.preparedCandidateId);
  const liveRouteImplemented =
    candidateActionType === 'reply' && supportedLiveRoute === LIVE_ROUTE_NAME;
  const liveSupported =
    prepared.eligible &&
    liveRouteImplemented &&
    normalizedBlockers.length === 0;
  const liveEligible = liveSupported && dryRunSatisfied;
  const liveReason = liveEligible
    ? 'prepared_bounty_live_reply_ready'
    : deriveLiveBlockedReason(prepared, dryRunSatisfied ? normalizedBlockers : [...normalizedBlockers, 'dry_run_required_before_live']);

  return {
    prepared,
    preparedCandidate: candidate,
    preparedCandidateId: prepared.preparedCandidateId || null,
    candidateActionType,
    allowedActionTypes: [...ALLOWED_LIVE_ACTION_TYPES],
    supportedLiveRoute,
    liveRouteName: LIVE_ROUTE_NAME,
    liveRouteImplemented,
    liveSupported,
    liveEligible,
    dryRunSatisfied,
    sourceMessage,
    sourceAvailable: prepared.sourceAvailable,
    messagingPolicy: {
      enabled: messagingPolicy.enabled,
      valid: messagingPolicy.valid,
      activePolicy: messagingPolicy.activePolicy,
      policyMode: messagingPolicy.policyMode,
      reason: messagingPolicy.reason,
    },
    preconditionBlockers: normalizedBlockers,
    dryRunCommand: candidate?.command || 'npm run agent:bounty:execute -- --dry-run',
    liveCommand: candidate?.liveCommand || 'npm run agent:bounty:execute -- --live --approve-live',
    fallbackCommand: candidate?.fallbackCommand || 'npm run agent:bounty:scan -- --dry-run',
    liveReason,
    whyNow: firstNonEmpty([
      liveEligible ? 'prepared_bounty_live_reply_ready' : null,
      prepared.eligible ? 'prepared_bounty_candidate_ready' : null,
      prepared.reason,
    ]),
  };
}

module.exports = {
  buildBountyLiveRouteContext,
  LIVE_ROUTE_NAME,
  ALLOWED_LIVE_ACTION_TYPES,
};
