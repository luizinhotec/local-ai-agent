const {
  MIN_EXTERNAL_BOUNTY_REWARD_SATS,
  isExternalCandidateRewardEligible,
  scanExternalBountiesSync,
} = require('./bounty-external-scan.cjs');

const BOUNTY_PATTERNS = [
  /aibtc\.com\/bounty/i,
  /\bbount(?:y|ies)\b/i,
  /\breal sats\b/i,
  /\baudit(?:s)?\b/i,
  /\bescrow\b/i,
  /\bbip-322\b/i,
  /\bclarity\b/i,
];

const PREPARED_CANDIDATE_TTL_MS = 6 * 60 * 60 * 1000;
const PREPARED_CANDIDATE_RETENTION_LIMIT = 12;

function isBountyCandidateMessage(message) {
  const content = String(message?.content || '');
  if (!content) return false;
  return BOUNTY_PATTERNS.some(pattern => pattern.test(content));
}

function summarizeBountyCandidate(message) {
  return {
    messageId: message.messageId || null,
    peerBtcAddress: message.peerBtcAddress || null,
    peerDisplayName: message.peerDisplayName || null,
    sentAt: message.sentAt || null,
    contentPreview: String(message.content || '').slice(0, 220),
    sourceType: 'inbox_message',
  };
}

function normalizeExternalCandidate(candidate) {
  return {
    messageId: candidate.candidateId || candidate.messageId || null,
    candidateId: candidate.candidateId || candidate.messageId || null,
    peerBtcAddress: null,
    peerDisplayName: 'External Bounty',
    sentAt: candidate.sentAt || new Date(candidate.priorityTimestamp || Date.now()).toISOString(),
    contentPreview: String(candidate.title || candidate.contentPreview || '').slice(0, 220),
    sourceType: candidate.sourceType || 'external',
    source: candidate.source || 'external_bounty',
    candidateActionType: candidate.candidateActionType || 'analysis',
    allowedActionTypes: Array.isArray(candidate.allowedActionTypes) ? candidate.allowedActionTypes : ['analysis'],
    supportedLiveRoute: candidate.supportedLiveRoute || null,
    rewardSats: Number(candidate.rewardSats || 0),
    stale: candidate.stale === true,
    candidateConsumed: candidate.candidateConsumed === true,
    priorityTimestamp: Number(candidate.priorityTimestamp || Date.now()),
    priorityOrder: Number(candidate.priorityOrder || 1),
    title: candidate.title || null,
  };
}

function appendExternalBountyScanLog(payload) {
  try {
    const { appendJsonLog } = require('./agent-logger.cjs');
    if (typeof appendJsonLog === 'function') {
      appendJsonLog('external_bounty_scan', payload);
    }
  } catch {
    // Keep scan path side-effect free if logging is unavailable.
  }
}

function toTimestamp(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sortCandidatesByRecency(candidates) {
  return [...candidates].sort((left, right) => {
    const rightTime = toTimestamp(right?.sentAt) || 0;
    const leftTime = toTimestamp(left?.sentAt) || 0;
    return rightTime - leftTime;
  });
}

function comparePreparedCandidates(left, right) {
  if ((left.priorityOrder || 0) !== (right.priorityOrder || 0)) {
    return (left.priorityOrder || 0) - (right.priorityOrder || 0);
  }
  if ((left.consecutiveFailures || 0) !== (right.consecutiveFailures || 0)) {
    return (left.consecutiveFailures || 0) - (right.consecutiveFailures || 0);
  }
  if ((left.rewardSats || 0) !== (right.rewardSats || 0)) {
    return (right.rewardSats || 0) - (left.rewardSats || 0);
  }
  if ((right.priorityTimestamp || 0) !== (left.priorityTimestamp || 0)) {
    return (right.priorityTimestamp || 0) - (left.priorityTimestamp || 0);
  }
  return String(left.candidateId || '').localeCompare(String(right.candidateId || ''));
}

function buildCandidateMap(candidates) {
  return new Map(
    (Array.isArray(candidates) ? candidates : [])
      .filter(candidate => candidate?.candidateId)
      .map(candidate => [candidate.candidateId, candidate])
  );
}

function getCandidateHistory(executionState, candidateId) {
  const history = executionState?.candidateExecutionHistory || {};
  if (!candidateId || !history || typeof history !== 'object') return null;
  const entry = history[candidateId];
  return entry && typeof entry === 'object' ? entry : null;
}

function getCandidateExecutionMetadata(executionState, candidateId, nowMs) {
  const historyMap = executionState?.candidateExecutionHistory || {};
  const hasAnyHistory = Boolean(historyMap && typeof historyMap === 'object' && Object.keys(historyMap).length > 0);
  const history = getCandidateHistory(executionState, candidateId);
  const useLegacyFallback = !history && executionState?.lastExecutedCandidateId === candidateId;
  const useLegacyTimestampFallback = !history && !hasAnyHistory;
  const lastLiveResult = history?.lastLiveResult || (useLegacyFallback ? executionState?.lastLiveResult || null : null);
  const lastExecutionMode = history?.lastExecutionMode || (useLegacyFallback ? executionState?.lastExecutionMode || null : null);
  const retryAfterMs = toTimestamp(history?.retryAfter || (useLegacyFallback ? executionState?.retryAfter : null));
  const cooldownUntilMs = toTimestamp(history?.cooldownUntil || (useLegacyFallback ? executionState?.cooldownUntil : null));
  const breakerOpenUntilMs = toTimestamp(history?.breakerOpenUntil || (!history && !hasAnyHistory ? executionState?.breakerOpenUntil : null));
  const consumed = history?.consumed === true || Boolean(
    !history &&
    candidateId &&
    executionState?.lastExecutedCandidateId === candidateId &&
    executionState?.lastExecutionMode === 'live' &&
    executionState?.lastLiveResult?.ok
  );

  const candidateConsumed = Boolean(consumed || (candidateId && lastExecutionMode === 'live' && lastLiveResult?.ok));
  const consumedAt = candidateConsumed
    ? history?.consumedAt || history?.lastSuccessAt || history?.lastLiveAttemptAt || (useLegacyTimestampFallback ? executionState?.lastSuccessAt || executionState?.lastLiveAttemptAt || null : null)
    : null;
  const retryScheduled = Boolean(candidateId && retryAfterMs && retryAfterMs > nowMs);
  const cooldownActive = Boolean(candidateId && lastExecutionMode !== 'dry_run' && cooldownUntilMs && cooldownUntilMs > nowMs);
  const breakerActive = Boolean(candidateId && breakerOpenUntilMs && breakerOpenUntilMs > nowMs);

  return {
    history: history ? { ...history } : null,
    candidateConsumed,
    consumedAt,
    retryAfter: retryScheduled ? new Date(retryAfterMs).toISOString() : null,
    retryScheduled,
    retryCooldownMs: retryScheduled ? Math.max(0, retryAfterMs - nowMs) : 0,
    cooldownUntil: cooldownActive ? new Date(cooldownUntilMs).toISOString() : null,
    cooldownActive,
    cooldownMs: cooldownActive ? Math.max(0, cooldownUntilMs - nowMs) : 0,
    breakerOpenUntil: breakerActive ? new Date(breakerOpenUntilMs).toISOString() : null,
    breakerActive,
    breakerCooldownMs: breakerActive ? Math.max(0, breakerOpenUntilMs - nowMs) : 0,
    lastBreakerReason: history?.lastBreakerReason || null,
    lastBreakerAt: history?.lastBreakerAt || null,
    lastDryRunAt: history?.lastDryRunAt || (useLegacyTimestampFallback ? executionState?.lastDryRunAt || null : null),
    lastDryRunResult: history?.lastDryRunResult || null,
    lastLiveAttemptAt: history?.lastLiveAttemptAt || (useLegacyTimestampFallback ? executionState?.lastLiveAttemptAt || null : null),
    lastLiveResult,
    lastFailureAt: history?.lastFailureAt || (useLegacyFallback ? executionState?.lastFailureAt || null : null),
    lastFailureClass: history?.lastFailureClass || (useLegacyFallback ? executionState?.lastFailureClass || null : null),
    executionCount: Number(history?.executionCount || 0),
    consecutiveFailures: Number(
      history?.consecutiveFailures
      ?? (!history && !hasAnyHistory ? executionState?.consecutiveFailures : 0)
      ?? 0
    ),
    lastExecutionMode: history?.lastExecutionMode || (useLegacyFallback ? executionState?.lastExecutionMode || null : null),
    lastSuccessAt: history?.lastSuccessAt || (useLegacyTimestampFallback ? executionState?.lastSuccessAt || null : null),
  };
}

function createPreparedCandidate(scanCandidate, existingCandidate, executionState, nowIso) {
  const nowMs = Date.parse(nowIso);
  const sentAtMs = toTimestamp(scanCandidate?.sentAt);
  const ageMs = sentAtMs === null ? null : Math.max(0, nowMs - sentAtMs);
  const stale = ageMs !== null && ageMs > PREPARED_CANDIDATE_TTL_MS;
  const executionMeta = getCandidateExecutionMetadata(executionState, scanCandidate?.messageId || null, nowMs);
  const preparedAt = existingCandidate?.preparedAt || nowIso;
  const priorityTimestamp = sentAtMs || 0;
  const priorityOrder = executionMeta.candidateConsumed
    ? 5
    : stale
      ? 4
      : executionMeta.breakerActive
        ? 3
        : executionMeta.retryScheduled
          ? 2
          : executionMeta.cooldownActive
            ? 1
            : 0;

  return {
    candidateId: scanCandidate.candidateId || scanCandidate.messageId || null,
    source: scanCandidate.source || scanCandidate.sourceType || 'inbox_message',
    sourceType: scanCandidate.sourceType || 'inbox_message',
    candidateActionType: existingCandidate?.candidateActionType || scanCandidate.candidateActionType || 'reply',
    allowedActionTypes: Array.isArray(existingCandidate?.allowedActionTypes)
      ? existingCandidate.allowedActionTypes
      : (Array.isArray(scanCandidate?.allowedActionTypes) ? scanCandidate.allowedActionTypes : ['reply']),
    supportedLiveRoute: existingCandidate?.supportedLiveRoute || scanCandidate?.supportedLiveRoute || (scanCandidate.sourceType === 'external' ? null : 'bounty_reply_manual_approved'),
    sourceMessageId: scanCandidate.sourceType === 'external' ? null : (scanCandidate.messageId || scanCandidate.candidateId || null),
    peerBtcAddress: scanCandidate.peerBtcAddress || null,
    peerDisplayName: scanCandidate.peerDisplayName || (scanCandidate.sourceType === 'external' ? 'External Bounty' : null),
    contentPreview: scanCandidate.contentPreview || scanCandidate.title || null,
    sentAt: scanCandidate.sentAt || null,
    candidateTimestamp: scanCandidate.sentAt || null,
    preparedAt,
    refreshedAt: nowIso,
    evaluatedAt: nowIso,
    expiresAt: ageMs === null ? null : new Date(nowMs + Math.max(0, PREPARED_CANDIDATE_TTL_MS - ageMs)).toISOString(),
    stale,
    ageMs,
    priorityTimestamp,
    priorityOrder,
    candidateConsumed: executionMeta.candidateConsumed,
    consumedAt: executionMeta.consumedAt,
    cooldownUntil: executionMeta.cooldownUntil,
    cooldownMs: executionMeta.cooldownMs,
    retryAfter: executionMeta.retryAfter,
    retryCooldownMs: executionMeta.retryCooldownMs,
    breakerOpenUntil: executionMeta.breakerOpenUntil,
    breakerCooldownMs: executionMeta.breakerCooldownMs,
    lastBreakerReason: executionMeta.lastBreakerReason,
    lastBreakerAt: executionMeta.lastBreakerAt,
    lastDryRunAt: executionMeta.lastDryRunAt,
    lastDryRunResult: executionMeta.lastDryRunResult,
    lastLiveAttemptAt: executionMeta.lastLiveAttemptAt,
    lastLiveResult: executionMeta.lastLiveResult,
    lastSuccessAt: executionMeta.lastSuccessAt,
    lastFailureAt: executionMeta.lastFailureAt,
    lastFailureClass: executionMeta.lastFailureClass,
    executionCount: executionMeta.executionCount,
    consecutiveFailures: executionMeta.consecutiveFailures,
    lastExecutionMode: executionMeta.lastExecutionMode,
    lastSeenAt: nowIso,
    title: scanCandidate.title || null,
    rewardSats: Number(scanCandidate.rewardSats || 0),
    command: 'npm run agent:bounty:execute -- --dry-run',
    liveCommand: 'npm run agent:bounty:execute -- --live --approve-live',
    fallbackCommand: 'npm run agent:bounty:scan -- --dry-run',
  };
}

function mergePreparedCandidates(state, scan, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const executionState = state?.bountyExecution || {};
  const existingById = buildCandidateMap(executionState.preparedCandidates);
  const merged = (scan.candidates || [])
    .map(candidate => createPreparedCandidate(candidate, existingById.get(candidate.messageId), executionState, nowIso))
    .sort(comparePreparedCandidates)
    .slice(0, PREPARED_CANDIDATE_RETENTION_LIMIT);

  return merged;
}

function isPreparedCandidateOperationallyUsable(candidate) {
  const blockers = Array.isArray(candidate?.blockers) ? candidate.blockers : [];
  if (!candidate) return false;
  if (candidate.stale === true) return false;
  if (candidate.candidateConsumed === true) return false;
  if (candidate.consumed === true) return false;
  if (candidate.repliedAt) return false;
  if (blockers.includes('prepared_candidate_stale')) return false;
  if (blockers.includes('reply_already_completed')) return false;
  if (blockers.includes('candidate_consumed')) return false;
  return true;
}

function derivePreparedSelection(candidate) {
  if (!candidate) {
    return {
      eligible: false,
      status: 'no_prepared_candidate',
      reason: 'no_prepared_bounty_candidate_available',
      blockers: ['no_prepared_candidate'],
      cooldownMs: 0,
    };
  }
  if (candidate.candidateConsumed) {
    return {
      eligible: false,
      status: 'no_prepared_candidate',
      reason: 'prepared_bounty_candidate_consumed',
      blockers: ['candidate_consumed'],
      cooldownMs: 0,
    };
  }
  if (candidate.retryAfter && Number(candidate.retryCooldownMs || 0) > 0) {
    return {
      eligible: false,
      status: 'retry_scheduled',
      reason: 'bounty_execution_retry_scheduled',
      blockers: ['retry_scheduled'],
      cooldownMs: Number(candidate.retryCooldownMs || 0),
    };
  }
  if (candidate.cooldownUntil && Number(candidate.cooldownMs || 0) > 0) {
    return {
      eligible: false,
      status: 'cooldown',
      reason: 'bounty_execution_cooldown_active',
      blockers: ['cooldown_active'],
      cooldownMs: Number(candidate.cooldownMs || 0),
    };
  }
  if (candidate.breakerOpenUntil && Number(candidate.breakerCooldownMs || 0) > 0) {
    return {
      eligible: false,
      status: 'blocked',
      reason: candidate.lastBreakerReason || 'bounty_execution_breaker_open',
      blockers: ['breaker_open'],
      cooldownMs: Number(candidate.breakerCooldownMs || 0),
    };
  }
  if (candidate.stale) {
    return {
      eligible: false,
      status: 'blocked',
      reason: 'prepared_bounty_candidate_stale',
      blockers: ['prepared_candidate_stale'],
      cooldownMs: 0,
    };
  }
  return {
    eligible: true,
    status: 'candidate_ready_for_manual_execution',
    reason: 'prepared_bounty_candidate_ready',
    blockers: [],
    cooldownMs: 0,
  };
}

function scanBountyCandidatesFromState(state) {
  const inboxMessages = Array.isArray(state?.inboxMessages) ? state.inboxMessages : null;
  const scannedExternalCandidates = scanExternalBountiesSync();
  const externalCandidates = scannedExternalCandidates.filter(isExternalCandidateRewardEligible);
  appendExternalBountyScanLog({
    count: externalCandidates.length,
    rawCount: scannedExternalCandidates.length,
    minRewardSats: MIN_EXTERNAL_BOUNTY_REWARD_SATS,
  });
  if (!inboxMessages) {
    return {
      ok: true,
      eligible: false,
      status: 'source_unavailable',
      reason: 'inbox_source_unavailable',
      blockers: ['inbox_source_unavailable'],
      candidates: externalCandidates.map(normalizeExternalCandidate),
      lastCandidateCount: 0,
      usefulSignalFound: externalCandidates.length > 0,
      command: 'npm run agent:messages -- --status-only',
      fallbackCommand: 'npm run agent:status',
      approvalRequired: false,
      autoExecutable: false,
      cooldownMs: 60 * 60 * 1000,
    };
  }

  const inboxCandidates = inboxMessages
    .filter(isBountyCandidateMessage)
    .map(summarizeBountyCandidate);
  const candidates = sortCandidatesByRecency([
    ...inboxCandidates,
    ...externalCandidates.map(normalizeExternalCandidate),
  ]);

  if (candidates.length === 0) {
    return {
      ok: true,
      eligible: false,
      status: 'no_candidates',
      reason: 'no_bounty_candidates_found',
      blockers: [],
      candidates,
      lastCandidateCount: 0,
      usefulSignalFound: false,
      command: 'npm run agent:bounty:scan -- --dry-run',
      fallbackCommand: 'npm run agent:messages -- --status-only',
      approvalRequired: false,
      autoExecutable: false,
      cooldownMs: 60 * 60 * 1000,
    };
  }

  return {
    ok: true,
    eligible: true,
    status: 'candidate_found',
    reason: 'bounty_candidate_found_in_inbox',
    blockers: [],
    candidates,
    lastCandidateCount: candidates.length,
    usefulSignalFound: true,
    command: 'npm run agent:bounty:scan -- --dry-run',
    fallbackCommand: 'npm run agent:messages -- --status-only',
    approvalRequired: false,
    autoExecutable: false,
    cooldownMs: 45 * 60 * 1000,
  };
}

function buildPreparedBountyCandidate(state, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const scan = scanBountyCandidatesFromState(state);
  const preparedCandidates = mergePreparedCandidates(state, scan, { nowIso });
  const candidate = preparedCandidates.filter(isPreparedCandidateOperationallyUsable)[0] || null;
  const selection = derivePreparedSelection(candidate);
  const selectedCandidate = selection.status === 'no_prepared_candidate' ? null : candidate;

  if (!candidate) {
    return {
      ok: true,
      status: scan.status === 'source_unavailable' ? 'blocked' : 'no_candidates',
      reason:
        scan.status === 'source_unavailable'
          ? 'bounty_candidate_source_unavailable'
          : 'no_operational_bounty_candidates',
      blockers:
        scan.status === 'source_unavailable'
          ? ['candidate_source_unavailable']
          : ['no_operational_bounty_candidates'],
      candidate: null,
      candidates: preparedCandidates,
      selectedCandidateId: null,
      sourceScan: scan,
    };
  }
    return {
      ok: true,
      status: selection.status,
      reason: selection.reason,
      blockers: selection.blockers,
      candidate: selectedCandidate,
      candidates: preparedCandidates,
      selectedCandidateId: selectedCandidate?.candidateId || null,
      sourceScan: scan,
    };
}

function getPreparedBountyExecutionState(state, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const executionState = state?.bountyExecution || {};
  const preparedCandidates = Array.isArray(executionState.preparedCandidates)
    ? executionState.preparedCandidates
    : executionState.preparedCandidate
      ? [executionState.preparedCandidate]
      : [];
  const candidate = [...preparedCandidates]
    .map(item => {
      const sentAtMs = toTimestamp(item?.sentAt);
      const ageMs = sentAtMs === null ? item?.ageMs ?? null : Math.max(0, nowMs - sentAtMs);
      const stale = ageMs !== null && ageMs > PREPARED_CANDIDATE_TTL_MS;
      const executionMeta = getCandidateExecutionMetadata(executionState, item?.candidateId || null, nowMs);
      return {
        ...item,
        ageMs,
        stale,
        candidateConsumed: executionMeta.candidateConsumed,
        consumedAt: executionMeta.consumedAt,
        cooldownUntil: executionMeta.cooldownUntil,
        cooldownMs: executionMeta.cooldownMs,
        retryAfter: executionMeta.retryAfter,
        retryCooldownMs: executionMeta.retryCooldownMs,
        breakerOpenUntil: executionMeta.breakerOpenUntil,
        breakerCooldownMs: executionMeta.breakerCooldownMs,
        lastBreakerReason: executionMeta.lastBreakerReason,
        lastBreakerAt: executionMeta.lastBreakerAt,
        lastDryRunAt: executionMeta.lastDryRunAt,
        lastDryRunResult: executionMeta.lastDryRunResult,
        lastLiveAttemptAt: executionMeta.lastLiveAttemptAt,
        lastLiveResult: executionMeta.lastLiveResult,
        lastFailureAt: executionMeta.lastFailureAt,
        lastFailureClass: executionMeta.lastFailureClass,
        executionCount: executionMeta.executionCount,
        consecutiveFailures: executionMeta.consecutiveFailures,
        lastExecutionMode: executionMeta.lastExecutionMode,
        priorityTimestamp: sentAtMs || item?.priorityTimestamp || 0,
        priorityOrder: executionMeta.candidateConsumed
          ? 5
          : stale
            ? 4
            : executionMeta.breakerActive
              ? 3
              : executionMeta.retryScheduled
                ? 2
                : executionMeta.cooldownActive
                  ? 1
                  : 0,
      };
    })
    .sort(comparePreparedCandidates)
    .filter(isPreparedCandidateOperationallyUsable)[0] || null;
  const blockers = [];

  if (!candidate || !(candidate.candidateId || executionState.lastPreparedCandidateId)) {
    return {
      ok: true,
      eligible: false,
      status: 'no_candidates',
      reason: 'no_operational_bounty_candidates',
      blockers: ['no_operational_bounty_candidates'],
      preparedCandidate: null,
      preparedCandidateId: null,
      preparedCandidates,
      sourceAvailable: false,
      command: 'npm run agent:bounty:scan -- --dry-run',
      fallbackCommand: 'npm run agent:messages -- --status-only',
      approvalRequired: true,
      autoExecutable: false,
      requiresDryRunFirst: true,
      cooldownMs: 0,
      ageMs: null,
    };
  }

  if (candidate.candidateConsumed) {
    return {
      ok: true,
      eligible: false,
      status: 'no_prepared_candidate',
      reason: 'prepared_bounty_candidate_consumed',
      blockers: ['candidate_consumed'],
      preparedCandidate: null,
      preparedCandidateId: null,
      preparedCandidates,
      sourceAvailable: true,
      command: 'npm run agent:bounty:scan -- --dry-run',
      fallbackCommand: candidate.fallbackCommand || 'npm run agent:messages -- --status-only',
      approvalRequired: true,
      autoExecutable: false,
      requiresDryRunFirst: true,
      cooldownMs: 0,
      ageMs: candidate.ageMs ?? null,
    };
  }

  if (candidate.retryAfter && Number(candidate.retryCooldownMs || 0) > 0) {
    return {
      ok: true,
      eligible: false,
      status: 'retry_scheduled',
      reason: 'bounty_execution_retry_scheduled',
      blockers: ['retry_scheduled'],
      preparedCandidate: candidate,
      preparedCandidateId: candidate.candidateId || executionState.lastPreparedCandidateId,
      preparedCandidates,
      sourceAvailable: true,
      command: candidate.command || 'npm run agent:bounty:execute -- --dry-run',
      fallbackCommand: candidate.fallbackCommand || 'npm run agent:bounty:scan -- --dry-run',
      approvalRequired: true,
      autoExecutable: false,
      requiresDryRunFirst: true,
      cooldownMs: Number(candidate.retryCooldownMs || 0),
      ageMs: candidate.ageMs ?? null,
    };
  }

  if (candidate.cooldownUntil && Number(candidate.cooldownMs || 0) > 0) {
    return {
      ok: true,
      eligible: false,
      status: 'cooldown',
      reason: 'bounty_execution_cooldown_active',
      blockers: ['cooldown_active'],
      preparedCandidate: candidate,
      preparedCandidateId: candidate.candidateId || executionState.lastPreparedCandidateId,
      preparedCandidates,
      sourceAvailable: true,
      command: candidate.command || 'npm run agent:bounty:execute -- --dry-run',
      fallbackCommand: candidate.fallbackCommand || 'npm run agent:bounty:scan -- --dry-run',
      approvalRequired: true,
      autoExecutable: false,
      requiresDryRunFirst: true,
      cooldownMs: Number(candidate.cooldownMs || 0),
      ageMs: candidate.ageMs ?? null,
    };
  }

  if (candidate.breakerOpenUntil && Number(candidate.breakerCooldownMs || 0) > 0) {
    return {
      ok: true,
      eligible: false,
      status: 'blocked',
      reason: candidate.lastBreakerReason || 'bounty_execution_breaker_open',
      blockers: ['breaker_open'],
      preparedCandidate: candidate,
      preparedCandidateId: candidate.candidateId || executionState.lastPreparedCandidateId,
      preparedCandidates,
      sourceAvailable: true,
      command: candidate.command || 'npm run agent:bounty:execute -- --dry-run',
      fallbackCommand: candidate.fallbackCommand || 'npm run agent:bounty:scan -- --dry-run',
      approvalRequired: true,
      autoExecutable: false,
      requiresDryRunFirst: true,
      cooldownMs: Number(candidate.breakerCooldownMs || 0),
      ageMs: candidate.ageMs ?? null,
    };
  }

  const inboxMessages = Array.isArray(state?.inboxMessages) ? state.inboxMessages : null;
  if (!inboxMessages) {
    blockers.push('candidate_source_unavailable');
    return {
      ok: true,
      eligible: false,
      status: 'blocked',
      reason: 'bounty_candidate_source_unavailable',
      blockers,
      preparedCandidate: candidate,
      preparedCandidateId: candidate.candidateId || executionState.lastPreparedCandidateId,
      preparedCandidates,
      sourceAvailable: false,
      command: candidate.command || 'npm run agent:bounty:execute -- --dry-run',
      fallbackCommand: 'npm run agent:messages -- --status-only',
      approvalRequired: true,
      autoExecutable: false,
      requiresDryRunFirst: true,
      cooldownMs: 0,
      ageMs: candidate.ageMs ?? null,
    };
  }

  const sourceMessage = inboxMessages.find(message => message?.messageId === candidate.sourceMessageId);
  if (!sourceMessage) {
    blockers.push('prepared_candidate_source_missing');
  }
  if (sourceMessage && !isBountyCandidateMessage(sourceMessage)) {
    blockers.push('prepared_candidate_no_longer_matches_scan');
  }

  const ageMs = candidate.ageMs ?? null;
  if (candidate.candidateConsumed) {
    blockers.push('candidate_consumed');
  }
  if (candidate.stale) {
    blockers.push('prepared_candidate_stale');
  }

  if (blockers.length > 0) {
    return {
      ok: true,
      eligible: false,
      status: 'blocked',
      reason: blockers.includes('prepared_candidate_stale')
        ? 'prepared_bounty_candidate_stale'
        : 'prepared_bounty_candidate_blocked',
      blockers,
      preparedCandidate: {
        ...candidate,
        ageMs,
        stale: blockers.includes('prepared_candidate_stale'),
      },
      preparedCandidateId: candidate.candidateId || executionState.lastPreparedCandidateId,
      preparedCandidates,
      sourceAvailable: blockers.every(blocker => blocker !== 'candidate_source_unavailable'),
      command: candidate.command || 'npm run agent:bounty:execute -- --dry-run',
      fallbackCommand: candidate.fallbackCommand || 'npm run agent:bounty:scan -- --dry-run',
      approvalRequired: true,
      autoExecutable: false,
      requiresDryRunFirst: true,
      cooldownMs: 0,
      ageMs,
    };
  }

  return {
    ok: true,
    eligible: true,
    status: 'candidate_ready_for_manual_execution',
    reason: 'prepared_bounty_candidate_ready',
    blockers: [],
    preparedCandidate: {
      ...candidate,
      ageMs,
      stale: false,
    },
    preparedCandidateId: candidate.candidateId || executionState.lastPreparedCandidateId,
    preparedCandidates,
    sourceAvailable: true,
    command: candidate.command || 'npm run agent:bounty:execute -- --dry-run',
    fallbackCommand: candidate.fallbackCommand || 'npm run agent:bounty:scan -- --dry-run',
    approvalRequired: true,
    autoExecutable: false,
    requiresDryRunFirst: true,
    cooldownMs: 0,
    ageMs,
  };
}

module.exports = {
  PREPARED_CANDIDATE_TTL_MS,
  PREPARED_CANDIDATE_RETENTION_LIMIT,
  scanBountyCandidatesFromState,
  buildPreparedBountyCandidate,
  getPreparedBountyExecutionState,
  isPreparedCandidateOperationallyUsable,
};
