#!/usr/bin/env node

const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { readAgentState, updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');
const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { buildBountyLiveRouteContext } = require('./lib/bounty-execute-route.cjs');
const { executeManualReplyCandidate } = require('./skill-messaging.cjs');

const EXECUTION_RETRY_MS = 30 * 60 * 1000;
const EXECUTION_COOLDOWN_MS = 20 * 60 * 1000;

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = sanitizeValue(item);
  }
  return sanitized;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (arg === '--live') {
      flags.dryRun = false;
      continue;
    }
    if (arg === '--status-only') {
      flags.statusOnly = true;
      continue;
    }
    if (arg === '--force') {
      flags.force = true;
      continue;
    }
    if (arg === '--approve-live') {
      flags.approveLive = true;
      continue;
    }
  }
  return flags;
}

function evaluateBountyExecuteSkill(state, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const config = options.config || loadAgentConfig();
  const route = buildBountyLiveRouteContext(state, config, { nowIso });
  const prepared = route.prepared;
  const blockers = [...new Set([...(prepared.blockers || []), ...(route.preconditionBlockers || [])])];
  let status = prepared.status;
  let reason = prepared.reason;
  const baseScore = route.liveEligible ? 82 : prepared.eligible ? 70 : prepared.status === 'blocked' ? 18 : 0;
  const scoreBreakdown = {
    execution_real: prepared.eligible ? 26 : 0,
    championship_signal: prepared.eligible ? 22 : 0,
    prepared_manual_candidate: prepared.eligible ? 22 : 0,
    live_route_allowlisted: route.liveSupported ? 8 : 0,
    live_manual_ready: route.liveEligible ? 12 : 0,
  };
  const penaltyBreakdown = {};

  if (prepared.approvalRequired) {
    penaltyBreakdown.approval_required = route.liveEligible ? 6 : prepared.eligible ? 8 : 4;
  }
  if (prepared.status === 'cooldown') {
    penaltyBreakdown.cooldown_active = 36;
  }
  if (prepared.status === 'retry_scheduled') {
    penaltyBreakdown.retry_scheduled = 32;
  }
  if (blockers.includes('prepared_candidate_stale')) {
    penaltyBreakdown.candidate_stale = 44;
  }
  if (blockers.includes('candidate_source_unavailable') || blockers.includes('prepared_candidate_source_missing')) {
    penaltyBreakdown.source_unavailable = 38;
  }
  if (blockers.includes('unsupported_live_action_type') || blockers.includes('live_route_not_allowlisted')) {
    penaltyBreakdown.unsupported_live_route = 42;
  }
  if (blockers.includes('missing_required_candidate_fields')) {
    penaltyBreakdown.missing_required_fields = 40;
  }
  if (!route.dryRunSatisfied && route.liveSupported) {
    penaltyBreakdown.dry_run_required = 6;
  }
  if (blockers.includes('reply_already_completed')) {
    penaltyBreakdown.reply_already_completed = 28;
  }
  if (blockers.length > 0 && !Object.keys(penaltyBreakdown).includes('source_unavailable')) {
    penaltyBreakdown.blockers_present = Math.max(penaltyBreakdown.blockers_present || 0, 18);
  }

  if (!prepared.eligible && prepared.status === 'no_prepared_candidate') {
    status = 'no_prepared_candidate';
    reason = 'no_prepared_bounty_candidate_available';
    penaltyBreakdown.no_prepared_candidate = 18;
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

  const penalties = Object.values(penaltyBreakdown).reduce((sum, value) => sum + Number(value || 0), 0);
  const strategicWeight = route.liveEligible ? 34 : prepared.eligible ? 28 : 0;
  const finalScore = Math.max(0, baseScore + strategicWeight - penalties);

  return {
    skillId: 'bounty_execute',
    ok: true,
    eligible: prepared.eligible,
    status,
    reason,
    blockers,
    command: route.liveEligible ? route.liveCommand : route.dryRunCommand,
    fallbackCommand: route.fallbackCommand,
    approvalRequired: true,
    autoExecutable: false,
    cooldownMs: prepared.cooldownMs || 0,
    baseScore,
    finalScore,
    scoreBreakdown,
    penaltyBreakdown,
    usefulSignalFound: Boolean(prepared.preparedCandidateId),
    preparedCandidateId: prepared.preparedCandidateId || null,
    requiresDryRunFirst: !route.dryRunSatisfied,
    strategicWeight,
    preparedCandidate: sanitizeValue(prepared.preparedCandidate),
    liveEligible: route.liveEligible,
    liveSupported: route.liveSupported,
    liveRouteImplemented: route.liveRouteImplemented,
    liveRouteName: route.liveRouteName,
    allowedActionTypes: route.allowedActionTypes,
    candidateActionType: route.candidateActionType,
    liveCommand: route.liveCommand,
    whyNow: route.whyNow,
  };
}

function persistExecutionState(update, nowIso) {
  return updateAgentState(current => {
    const {
      candidateConsumed: candidateConsumedFlag,
      incrementExecutionCount,
      candidateConsecutiveFailures,
      candidateBreakerOpenUntil,
      candidateLastBreakerReason,
      candidateLastBreakerAt,
      ...stateUpdate
    } = update;
    const candidateId = update.lastPreparedCandidateId || current.bountyExecution?.lastPreparedCandidateId || null;
    const previousHistory = current.bountyExecution?.candidateExecutionHistory || {};
    let nextHistory = previousHistory;

    if (candidateId) {
      const previousCandidateHistory = previousHistory[candidateId] || {};
      const candidateHistory = {
        ...previousCandidateHistory,
        lastDryRunAt: update.lastDryRunAt !== undefined ? update.lastDryRunAt : previousCandidateHistory.lastDryRunAt || null,
        lastDryRunResult: update.lastDryRunResult !== undefined ? update.lastDryRunResult : previousCandidateHistory.lastDryRunResult || null,
        lastLiveAttemptAt: update.lastLiveAttemptAt !== undefined ? update.lastLiveAttemptAt : previousCandidateHistory.lastLiveAttemptAt || null,
        lastLiveResult: update.lastLiveResult !== undefined ? update.lastLiveResult : previousCandidateHistory.lastLiveResult || null,
        lastSuccessAt: update.lastSuccessAt !== undefined ? update.lastSuccessAt : previousCandidateHistory.lastSuccessAt || null,
        lastFailureAt: update.lastFailureAt !== undefined ? update.lastFailureAt : previousCandidateHistory.lastFailureAt || null,
        lastFailureClass: update.lastFailureClass !== undefined ? update.lastFailureClass : previousCandidateHistory.lastFailureClass || null,
        retryAfter: update.retryAfter !== undefined ? update.retryAfter : previousCandidateHistory.retryAfter || null,
        cooldownUntil: update.cooldownUntil !== undefined ? update.cooldownUntil : previousCandidateHistory.cooldownUntil || null,
        consumed: candidateConsumedFlag !== undefined ? Boolean(candidateConsumedFlag) : previousCandidateHistory.consumed === true,
        consumedAt: candidateConsumedFlag
          ? update.lastSuccessAt || nowIso
          : candidateConsumedFlag === false
            ? null
            : previousCandidateHistory.consumedAt || null,
        executionCount: Number(previousCandidateHistory.executionCount || 0) + (incrementExecutionCount ? 1 : 0),
        consecutiveFailures: candidateConsecutiveFailures !== undefined
          ? Number(candidateConsecutiveFailures || 0)
          : Number(previousCandidateHistory.consecutiveFailures || 0),
        breakerOpenUntil: candidateBreakerOpenUntil !== undefined
          ? candidateBreakerOpenUntil
          : previousCandidateHistory.breakerOpenUntil || null,
        lastBreakerReason: candidateLastBreakerReason !== undefined
          ? candidateLastBreakerReason
          : previousCandidateHistory.lastBreakerReason || null,
        lastBreakerAt: candidateLastBreakerAt !== undefined
          ? candidateLastBreakerAt
          : previousCandidateHistory.lastBreakerAt || null,
        lastExecutionMode: update.lastExecutionMode !== undefined ? update.lastExecutionMode : previousCandidateHistory.lastExecutionMode || null,
      };
      nextHistory = {
        ...previousHistory,
        [candidateId]: candidateHistory,
      };
    }

    current.bountyExecution = {
      ...current.bountyExecution,
      ...stateUpdate,
      candidateExecutionHistory: nextHistory,
      lastEvaluationAt: nowIso,
      approvalRequired: true,
      autoExecutable: false,
    };
    current.skills.bountyExecute = {
      ...current.skills.bountyExecute,
      enabled: true,
      lastRunAt: nowIso,
      lastAttemptMode: update.lastLiveAttemptAt ? 'live' : update.lastDryRunAt ? 'dry_run' : 'status_only',
      lastOutcome: update.lastStatus || current.skills.bountyExecute.lastOutcome || 'never',
      lastSuccessAt: update.lastSuccessAt || current.skills.bountyExecute.lastSuccessAt || null,
      lastFailureAt: update.lastFailureAt || current.skills.bountyExecute.lastFailureAt || null,
      lastSkipReason: update.lastBlockedReason || null,
      lastStatusCode: update.lastFailureAt ? 409 : 200,
      errorCount: Number(current.skills.bountyExecute.errorCount || 0) + (update.lastFailureAt ? 1 : 0),
    };
    return current;
  });
}

async function runBountyExecuteSkill(options = {}) {
  const state = readAgentState();
  const config = options.config || loadAgentConfig();
  const executeReplyCandidate = options.executeReplyCandidate || executeManualReplyCandidate;
  const nowIso = new Date().toISOString();
  const statusOnly = parseBoolean(options.statusOnly, false);
  const dryRun = options.dryRun === undefined ? true : parseBoolean(options.dryRun, true);
  const approveLive = parseBoolean(options.approveLive, false);
  const evaluation = evaluateBountyExecuteSkill(state, { nowIso, config });
  const route = buildBountyLiveRouteContext(state, config, { nowIso });

  appendJsonLog('bounty_execute_evaluated', sanitizeValue({
    statusOnly,
    dryRun,
    approveLive,
    status: evaluation.status,
    reason: evaluation.reason,
    blockers: evaluation.blockers,
    preparedCandidateId: evaluation.preparedCandidateId,
    finalScore: evaluation.finalScore,
    liveEligible: evaluation.liveEligible,
    liveRouteName: evaluation.liveRouteName,
    candidateActionType: evaluation.candidateActionType,
  }));

  let executionStatus = evaluation.status;
  let executionReason = evaluation.reason;
  let liveResult = null;
  let dryRunResult = null;
  const candidateHistory = state.bountyExecution?.candidateExecutionHistory?.[evaluation.preparedCandidateId] || {};
  const hasCandidateHistory = Boolean(state.bountyExecution?.candidateExecutionHistory?.[evaluation.preparedCandidateId]);
  let retryAfter = hasCandidateHistory
    ? candidateHistory.retryAfter || null
    : state.bountyExecution?.retryAfter || null;
  let cooldownUntil = hasCandidateHistory
    ? candidateHistory.cooldownUntil || null
    : state.bountyExecution?.cooldownUntil || null;
  let lastFailureAt = hasCandidateHistory
    ? candidateHistory.lastFailureAt || null
    : state.bountyExecution?.lastFailureAt || null;
  let lastFailureClass = hasCandidateHistory
    ? candidateHistory.lastFailureClass || null
    : state.bountyExecution?.lastFailureClass || null;
  let lastDryRunAt = hasCandidateHistory
    ? candidateHistory.lastDryRunAt || null
    : state.bountyExecution?.lastDryRunAt || null;
  let lastLiveAttemptAt = hasCandidateHistory
    ? candidateHistory.lastLiveAttemptAt || null
    : state.bountyExecution?.lastLiveAttemptAt || null;
  let lastSuccessAt = hasCandidateHistory
    ? candidateHistory.lastSuccessAt || null
    : state.bountyExecution?.lastSuccessAt || null;
  let consecutiveFailures = Number(state.bountyExecution?.consecutiveFailures || 0);
  let breakerOpenUntil = state.bountyExecution?.breakerOpenUntil || null;
  let candidateConsecutiveFailures = Number(
    candidateHistory.consecutiveFailures
    ?? (!state.bountyExecution?.candidateExecutionHistory?.[evaluation.preparedCandidateId] ? state.bountyExecution?.consecutiveFailures : 0)
    ?? 0
  );
  let candidateBreakerOpenUntil = candidateHistory.breakerOpenUntil || null;
  let candidateLastBreakerReason = candidateHistory.lastBreakerReason || null;
  let candidateLastBreakerAt = candidateHistory.lastBreakerAt || null;
  let lastExecutedActionType = state.bountyExecution?.lastExecutedActionType || null;
  let lastExecutedCandidateId = state.bountyExecution?.lastExecutedCandidateId || null;
  let lastExecutionMode = statusOnly ? 'status_only' : dryRun ? 'dry_run' : 'live';
  let candidateConsumed = undefined;
  let incrementExecutionCount = false;

  if (!statusOnly) {
    if (dryRun) {
      if (route.liveSupported) {
        const dryRunExecution = await executeReplyCandidate(route.sourceMessage, state, config, {
          dryRun: true,
          liveRouteName: route.liveRouteName,
        });
        executionStatus = dryRunExecution.ok ? 'executed_dry_run' : 'blocked';
        executionReason = dryRunExecution.reason || 'dry_run_preconditions_validated';
        dryRunResult = {
          ...sanitizeValue(dryRunExecution),
          preparedCandidateId: evaluation.preparedCandidateId,
          liveBlocked: !route.dryRunSatisfied,
          liveCommand: route.liveCommand,
        };
        lastDryRunAt = nowIso;
        cooldownUntil = null;
        consecutiveFailures = 0;
        breakerOpenUntil = null;
        candidateConsecutiveFailures = 0;
        candidateBreakerOpenUntil = null;
        candidateLastBreakerReason = null;
        candidateLastBreakerAt = null;
        lastExecutedActionType = route.candidateActionType || lastExecutedActionType;
        lastExecutedCandidateId = evaluation.preparedCandidateId;
        candidateConsumed = false;
      } else {
        executionStatus = evaluation.status === 'retry_scheduled' ? 'retry_scheduled' : 'blocked';
        executionReason = route.liveReason || evaluation.reason;
        dryRunResult = {
          ok: false,
          status: executionStatus,
          reason: executionReason,
          blockers: evaluation.blockers,
          preparedCandidateId: evaluation.preparedCandidateId,
          liveRouteName: route.liveRouteName,
        };
      }
    } else if (!approveLive) {
      executionStatus = 'approval_required';
      executionReason = 'live_approval_missing';
      liveResult = {
        ok: false,
        status: executionStatus,
        reason: executionReason,
        blockers: ['live_approval_missing'],
        preparedCandidateId: evaluation.preparedCandidateId,
        liveRouteName: route.liveRouteName,
      };
    } else if (!route.liveSupported) {
      executionStatus = evaluation.status === 'retry_scheduled' ? 'retry_scheduled' : 'blocked';
      executionReason = route.liveReason || evaluation.reason;
      liveResult = {
        ok: false,
        status: executionStatus,
        reason: executionReason,
        blockers: evaluation.blockers,
        preparedCandidateId: evaluation.preparedCandidateId,
        liveRouteName: route.liveRouteName,
      };
    } else if (!route.dryRunSatisfied) {
      executionStatus = 'blocked';
      executionReason = 'dry_run_required_before_live';
      liveResult = {
        ok: false,
        status: executionStatus,
        reason: executionReason,
        blockers: ['dry_run_required_before_live'],
        preparedCandidateId: evaluation.preparedCandidateId,
        liveRouteName: route.liveRouteName,
      };
    } else {
      const liveExecution = await executeReplyCandidate(route.sourceMessage, state, config, {
        dryRun: false,
        liveRouteName: route.liveRouteName,
      });
      liveResult = {
        ...sanitizeValue(liveExecution),
        preparedCandidateId: evaluation.preparedCandidateId,
      };
      lastLiveAttemptAt = nowIso;
      lastExecutedActionType = route.candidateActionType || 'reply';
      lastExecutedCandidateId = evaluation.preparedCandidateId;
      incrementExecutionCount = true;
      if (liveExecution.ok) {
        executionStatus = 'executed_live';
        executionReason = liveExecution.reason || 'live_reply_executed';
        lastSuccessAt = nowIso;
        lastFailureAt = null;
        lastFailureClass = null;
        retryAfter = null;
        cooldownUntil = new Date(Date.parse(nowIso) + EXECUTION_COOLDOWN_MS).toISOString();
        consecutiveFailures = 0;
        breakerOpenUntil = null;
        candidateConsecutiveFailures = 0;
        candidateBreakerOpenUntil = null;
        candidateLastBreakerReason = null;
        candidateLastBreakerAt = null;
        candidateConsumed = true;
      } else {
        executionStatus = liveExecution.retryable ? 'retry_scheduled' : 'execution_failed';
        executionReason = liveExecution.reason || 'live_preconditions_not_met';
        lastFailureAt = nowIso;
        lastFailureClass = liveExecution.failureClass || 'execution_failed';
        retryAfter = liveExecution.retryable
          ? new Date(Date.parse(nowIso) + EXECUTION_RETRY_MS).toISOString()
          : null;
        consecutiveFailures += 1;
        candidateConsecutiveFailures += 1;
        candidateConsumed = false;
      }
    }

    if (!dryRun && liveResult?.ok === false && !lastFailureAt && !['approval_required', 'blocked'].includes(executionStatus)) {
      lastFailureAt = nowIso;
      lastFailureClass = lastFailureClass || 'execution_failed';
      consecutiveFailures += 1;
      candidateConsecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        breakerOpenUntil = new Date(Date.parse(nowIso) + EXECUTION_RETRY_MS).toISOString();
      }
    }

    if (!dryRun && ['retry_scheduled', 'execution_failed'].includes(executionStatus) && candidateConsecutiveFailures >= 3) {
      candidateBreakerOpenUntil = new Date(Date.parse(nowIso) + EXECUTION_RETRY_MS).toISOString();
      candidateLastBreakerReason = lastFailureClass || executionReason || 'bounty_execution_breaker_open';
      candidateLastBreakerAt = nowIso;
      breakerOpenUntil = candidateBreakerOpenUntil;
    }
  }

  const persistedState = persistExecutionState({
    lastPreparedCandidateId: evaluation.preparedCandidateId,
    lastPreparedCandidateSource: evaluation.preparedCandidate?.source || state.bountyExecution?.lastPreparedCandidateSource || null,
    preparedCandidate: evaluation.preparedCandidate || state.bountyExecution?.preparedCandidate || null,
    lastStatus: executionStatus,
    lastReason: executionReason,
    lastBlockedReason:
      executionStatus === 'blocked' || executionStatus === 'approval_required' || executionStatus === 'retry_scheduled'
        ? (liveResult?.blockers || dryRunResult?.blockers || evaluation.blockers || [])[0] || executionReason
        : null,
    lastManualCommand: evaluation.command,
    lastDryRunAt: dryRun && !statusOnly ? lastDryRunAt || nowIso : state.bountyExecution?.lastDryRunAt || null,
    lastDryRunResult: dryRunResult || state.bountyExecution?.lastDryRunResult || null,
    lastLiveAttemptAt: !dryRun && !statusOnly ? lastLiveAttemptAt || nowIso : state.bountyExecution?.lastLiveAttemptAt || null,
    lastLiveResult: liveResult || state.bountyExecution?.lastLiveResult || null,
    lastSuccessAt,
    lastFailureAt,
    lastFailureClass,
    retryAfter,
    lastExecutedActionType,
    lastExecutedCandidateId,
    lastExecutionMode,
    candidateConsumed,
    candidateConsecutiveFailures,
    candidateBreakerOpenUntil,
    candidateLastBreakerReason,
    candidateLastBreakerAt,
    incrementExecutionCount,
    liveRouteImplemented: evaluation.liveRouteImplemented,
    liveRouteName: evaluation.liveRouteName,
    cooldownUntil,
    breakerOpenUntil,
    consecutiveFailures,
    finalScore: evaluation.finalScore,
    scoreBreakdown: evaluation.scoreBreakdown,
    penaltyBreakdown: evaluation.penaltyBreakdown,
  }, nowIso);

  writeAgentStatus({
    checkedAt: nowIso,
    bountyExecute: sanitizeValue({
      status: executionStatus,
      reason: executionReason,
      blockers: evaluation.blockers,
      preparedCandidateId: evaluation.preparedCandidateId,
      command: evaluation.command,
      liveCommand: evaluation.liveCommand,
      fallbackCommand: evaluation.fallbackCommand,
      approvalRequired: evaluation.approvalRequired,
      autoExecutable: evaluation.autoExecutable,
      finalScore: evaluation.finalScore,
      requiresDryRunFirst: evaluation.requiresDryRunFirst,
      liveEligible: evaluation.liveEligible,
      liveRouteImplemented: evaluation.liveRouteImplemented,
      liveRouteName: evaluation.liveRouteName,
      candidateActionType: evaluation.candidateActionType,
      dryRunResult,
      liveResult,
    }),
  });

  appendJsonLog('bounty_execute_completed', sanitizeValue({
    statusOnly,
    dryRun,
    approveLive,
    status: executionStatus,
    reason: executionReason,
    preparedCandidateId: evaluation.preparedCandidateId,
    dryRunResult,
    liveResult,
    liveRouteName: evaluation.liveRouteName,
    candidateActionType: evaluation.candidateActionType,
  }));

  return {
    ok: !['execution_failed'].includes(executionStatus),
    skill: 'bounty-execute',
    statusOnly,
    dryRun,
    approveLive,
    ...sanitizeValue(evaluation),
    status: executionStatus,
    reason: executionReason,
    dryRunResult: sanitizeValue(dryRunResult),
    liveResult: sanitizeValue(liveResult),
    state: persistedState,
  };
}

if (require.main === module) {
  runBountyExecuteSkill(parseArgs(process.argv.slice(2)))
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    })
    .catch(error => {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exit(1);
    });
}

module.exports = {
  evaluateBountyExecuteSkill,
  runBountyExecuteSkill,
};
