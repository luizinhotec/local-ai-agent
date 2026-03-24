#!/usr/bin/env node

const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { readAgentState, updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');
const { materializeAutoLiveState } = require('./lib/auto-live-policy.cjs');
const { getPolicyDecision } = require('./lib/execution-policy.cjs');
const { runRouteEvaluatorSkill } = require('./skill-route-evaluator.cjs');

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
    if (arg === '--status-only') {
      flags.statusOnly = true;
      continue;
    }
    if (arg === '--force') {
      flags.force = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      if (rest.length > 0) {
        flags[key] = rest.join('=');
      }
    }
  }
  return flags;
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

function buildSuggestion(decision, amountSats) {
  const recommendedAction = decision.recommendedAction || 'wait';
  const manualPrioritySkill = decision.recommendedSkillId
    ? {
        skillId: decision.recommendedSkillId,
        label: decision.recommendedSkillLabel || decision.recommendedSkillId,
        category: decision.recommendedSkillCategory || 'general',
        reason: decision.recommendedSkillReason || decision.reason || 'manual_skill_available',
        whyNow: decision.recommendedSkillWhyNow || decision.recommendedSkillReason || decision.reason || 'manual_skill_available',
        command: decision.recommendedSkillCommand || null,
        fallbackCommand: decision.recommendedSkillFallbackCommand || null,
        approvalRequired: Boolean(decision.recommendedSkillApprovalRequired),
        autoExecutable: Boolean(decision.recommendedSkillAutoExecutable),
        score: Number(decision.recommendedSkillScore || 0),
      }
    : null;

  if (recommendedAction === 'messaging_only') {
    return {
      recommendedAction,
      reason: decision.reason || 'pending_social_reply_available',
      recommendedCommand: 'npm run agent:messages -- --live --reply-pending --max-replies-per-cycle=1',
      commandClass: 'safe_messaging_reply',
      safetyLevel: 'safe_live_reply',
      estimatedCostClass: decision.estimatedCostClass || 'zero',
      fallbackCommand: 'npm run agent:messages -- --status-only',
      approvalRequired: false,
      manualPrioritySkill,
      autoLiveSkillId: decision.loopRecommendedSkillId || 'messaging_safe_replies',
      estimatedFeeSats: Number(decision.loopRecommendedSkillMetadata?.estimatedFeeSats || 0),
      fallbackSafeCommand: decision.loopRecommendedSkillFallbackCommand || 'npm run agent:messages -- --status-only',
      championshipGateEligible: decision.championshipGateEligible,
      championshipGateBlockReason: decision.championshipGateBlockReason,
    };
  }
  if (recommendedAction === 'quote_only') {
    return {
      recommendedAction,
      reason: decision.reason || 'monitor_defi_quote_only',
      recommendedCommand: `npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=${amountSats}`,
      commandClass: 'read_only_quote',
      safetyLevel: 'safe_read_only',
      estimatedCostClass: decision.estimatedCostClass || 'zero',
      fallbackCommand: 'npm run agent:status',
      approvalRequired: false,
      manualPrioritySkill,
      autoLiveSkillId: decision.loopRecommendedSkillId || 'defi_quote_monitor',
      estimatedFeeSats: Number(decision.loopRecommendedSkillMetadata?.estimatedFeeSats || 0),
      fallbackSafeCommand: decision.loopRecommendedSkillFallbackCommand || 'npm run agent:status',
      championshipGateEligible: decision.championshipGateEligible,
      championshipGateBlockReason: decision.championshipGateBlockReason,
    };
  }
  if (recommendedAction === 'defi_swap_execute') {
    return {
      recommendedAction,
      reason: decision.reason || 'defi_ready_but_manual_approval_required',
      recommendedCommand: `npm run agent:defi:sbtc-usdcx -- --live --approve-live --amount-sats=${amountSats}`,
      commandClass: 'manual_approval_required',
      safetyLevel: 'approval_required',
      estimatedCostClass: decision.estimatedCostClass || 'low',
      fallbackCommand: `npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=${amountSats}`,
      approvalRequired: true,
      manualPrioritySkill,
      autoLiveSkillId: decision.loopRecommendedSkillId || null,
      estimatedFeeSats: Number(decision.loopRecommendedSkillMetadata?.estimatedFeeSats || 0),
      fallbackSafeCommand: decision.loopRecommendedSkillFallbackCommand || `npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=${amountSats}`,
      championshipGateEligible: decision.championshipGateEligible,
      championshipGateBlockReason: decision.championshipGateBlockReason,
    };
  }
  return {
    recommendedAction: 'wait',
    reason: decision.reason || 'no_action_recommended',
    recommendedCommand: null,
    commandClass: 'status_only',
    safetyLevel: 'status_only',
    estimatedCostClass: decision.estimatedCostClass || 'zero',
    fallbackCommand: 'npm run agent:status',
    approvalRequired: false,
    manualPrioritySkill,
    autoLiveSkillId: decision.loopRecommendedSkillId || null,
    estimatedFeeSats: Number(decision.loopRecommendedSkillMetadata?.estimatedFeeSats || 0),
    fallbackSafeCommand: decision.loopRecommendedSkillFallbackCommand || 'npm run agent:status',
    championshipGateEligible: decision.championshipGateEligible,
    championshipGateBlockReason: decision.championshipGateBlockReason,
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const nowIso = new Date().toISOString();
  const statusOnly = parseBoolean(flags.statusOnly, false);
  const dryRun = flags.dryRun === undefined ? true : parseBoolean(flags.dryRun, true);
  const force = parseBoolean(flags.force, false);
  const amountSats = Number(flags['amount-sats'] || 3000);

  appendJsonLog('next_action_started', {
    statusOnly,
    dryRun,
    force,
    amountSats,
  });

  const currentState = readAgentState();
  let decision = null;

  if (
    statusOnly &&
    !force &&
    currentState.lastRouteEvaluationAt &&
    currentState.lastRecommendedAction
  ) {
    decision = {
      recommendedAction: currentState.lastRecommendedAction,
      reason: currentState.lastRecommendedReason,
      confidence: currentState.lastRecommendationConfidence,
      estimatedCostClass: currentState.routeEvaluatorStatus?.estimatedCostClass || 'zero',
      blockers: currentState.routeEvaluatorHistory?.slice(-1)[0]?.blockers || [],
      recommendedSkillId: currentState.skillBuilder?.lastRecommendedSkillId || null,
      recommendedSkillLabel: currentState.skillBuilder?.skillStates?.[currentState.skillBuilder?.lastRecommendedSkillId]?.id || currentState.skillBuilder?.lastRecommendedSkillId || null,
      recommendedSkillReason:
        currentState.skillBuilder?.skillStates?.[currentState.skillBuilder?.lastRecommendedSkillId]?.lastReason || null,
      recommendedSkillWhyNow:
        currentState.skillBuilder?.skillStates?.[currentState.skillBuilder?.lastRecommendedSkillId]?.lastReason || null,
      recommendedSkillCommand: currentState.skillBuilder?.lastRecommendedSkillCommand || null,
      recommendedSkillFallbackCommand: currentState.skillBuilder?.ranking?.[1]?.command || 'npm run agent:status',
      recommendedSkillApprovalRequired: Boolean(
        currentState.skillBuilder?.skillStates?.[currentState.skillBuilder?.lastRecommendedSkillId]?.manualApprovalRequired
      ),
      recommendedSkillAutoExecutable: Boolean(
        currentState.skillBuilder?.skillStates?.[currentState.skillBuilder?.lastRecommendedSkillId]?.autoExecutable
      ),
      recommendedSkillScore: Number(
        currentState.skillBuilder?.skillStates?.[currentState.skillBuilder?.lastRecommendedSkillId]?.finalScore || 0
      ),
      loopRecommendedSkillId: currentState.skillBuilder?.lastLoopRecommendedSkillId || null,
      loopRecommendedSkillCommand: currentState.skillBuilder?.lastLoopRecommendedCommand || null,
      loopRecommendedSkillFallbackCommand: null,
      loopRecommendedSkillMetadata: null,
      source: 'state_cache',
    };
  } else {
    const evaluation = await runRouteEvaluatorSkill({
      statusOnly,
      dryRun: true,
      force,
      'amount-sats': amountSats,
    });
    decision = {
      recommendedAction: evaluation.recommendedAction,
      reason: evaluation.reason,
      confidence: evaluation.confidence,
      estimatedCostClass: evaluation.estimatedCostClass,
      blockers: evaluation.blockers || [],
      nextBestAction: evaluation.nextBestAction,
      recommendedSkillId: evaluation.recommendedSkillId || null,
      recommendedSkillLabel: evaluation.recommendedSkillLabel || null,
      recommendedSkillCategory: evaluation.recommendedSkillCategory || null,
      recommendedSkillReason: evaluation.recommendedSkillReason || null,
      recommendedSkillWhyNow: evaluation.recommendedSkillWhyNow || evaluation.recommendedSkillReason || null,
      recommendedSkillCommand: evaluation.recommendedSkillCommand || null,
      recommendedSkillFallbackCommand: evaluation.recommendedSkillFallbackCommand || null,
      recommendedSkillApprovalRequired: Boolean(evaluation.recommendedSkillApprovalRequired),
      recommendedSkillAutoExecutable: Boolean(evaluation.recommendedSkillAutoExecutable),
      recommendedSkillScore: Number(evaluation.recommendedSkillScore || 0),
      loopRecommendedSkillId: evaluation.loopRecommendedSkillId || null,
      loopRecommendedSkillCommand: evaluation.loopRecommendedSkillCommand || null,
      loopRecommendedSkillFallbackCommand: evaluation.loopRecommendedSkillFallbackCommand || null,
      loopRecommendedSkillMetadata: evaluation.loopRecommendedSkillMetadata || null,
      championshipGateEligible: Boolean(evaluation.championshipGateEligible),
      championshipGateBlockReason: evaluation.championshipGateBlockReason || null,
      source: 'fresh_evaluation',
    };
  }

  const suggestion = buildSuggestion(decision, amountSats);
  const autoExecutionPolicy = getPolicyDecision(suggestion, {
    autoSafeActions: true,
    dryRun: false,
    state: currentState,
    nowIso,
  });
  const autoLiveState = materializeAutoLiveState(currentState, nowIso);

  const finalState = updateAgentState(current => {
    current.autoLive = {
      ...materializeAutoLiveState(current, nowIso),
      lastAutoBlockedReason: autoExecutionPolicy.autoLiveEligible ? null : autoExecutionPolicy.autoLiveBlockReason,
      policyVersion: autoExecutionPolicy.autoLivePolicyVersion,
    };
    current.lastNextActionSuggestion = sanitizeValue({
      ...suggestion,
      autoExecutableByStandardLoop: autoExecutionPolicy.authorized,
      autoExecutionBlockReason: autoExecutionPolicy.blockReason,
      autoExecutionPolicy: autoExecutionPolicy.policy,
      autoLiveEligible: autoExecutionPolicy.autoLiveEligible,
      autoLiveClass: autoExecutionPolicy.autoLiveClass,
      autoLiveBlockReason: autoExecutionPolicy.autoLiveBlockReason,
      autoLivePolicyVersion: autoExecutionPolicy.autoLivePolicyVersion,
      championshipGateEligible: suggestion.championshipGateEligible,
      championshipGateBlockReason: suggestion.championshipGateBlockReason,
      manualPriorityReason: suggestion.manualPrioritySkill?.reason || null,
      manualPriorityCommand: suggestion.manualPrioritySkill?.command || null,
      manualPriorityScore: suggestion.manualPrioritySkill?.score || 0,
      manualPriorityWhyNow: suggestion.manualPrioritySkill?.whyNow || null,
    });
    current.lastNextActionCommand = suggestion.recommendedCommand;
    current.lastNextActionAt = nowIso;
    return current;
  });

  writeAgentStatus({
    checkedAt: nowIso,
    nextAction: {
      recommendedAction: suggestion.recommendedAction,
      reason: suggestion.reason,
      recommendedCommand: suggestion.recommendedCommand,
      commandClass: suggestion.commandClass,
      safetyLevel: suggestion.safetyLevel,
      estimatedCostClass: suggestion.estimatedCostClass,
      fallbackCommand: suggestion.fallbackCommand,
      approvalRequired: suggestion.approvalRequired,
      autoExecutableByStandardLoop: autoExecutionPolicy.authorized,
      autoExecutionBlockReason: autoExecutionPolicy.blockReason,
      autoExecutionPolicy: autoExecutionPolicy.policy,
      autoLiveEligible: autoExecutionPolicy.autoLiveEligible,
      autoLiveClass: autoExecutionPolicy.autoLiveClass,
      autoLiveBlockReason: autoExecutionPolicy.autoLiveBlockReason,
      autoLivePolicyVersion: autoExecutionPolicy.autoLivePolicyVersion,
      championshipGateEligible: suggestion.championshipGateEligible,
      championshipGateBlockReason: suggestion.championshipGateBlockReason,
      manualPrioritySkill: sanitizeValue(suggestion.manualPrioritySkill),
      manualPriorityReason: suggestion.manualPrioritySkill?.reason || null,
      manualPriorityCommand: suggestion.manualPrioritySkill?.command || null,
      manualPriorityScore: suggestion.manualPrioritySkill?.score || 0,
      manualPriorityWhyNow: suggestion.manualPrioritySkill?.whyNow || null,
      source: decision.source,
    },
  });

  appendJsonLog('next_action_completed', sanitizeValue({
    recommendedAction: suggestion.recommendedAction,
    recommendedCommand: suggestion.recommendedCommand,
    commandClass: suggestion.commandClass,
    safetyLevel: suggestion.safetyLevel,
    autoExecutableByStandardLoop: autoExecutionPolicy.authorized,
    autoExecutionBlockReason: autoExecutionPolicy.blockReason,
    autoLiveEligible: autoExecutionPolicy.autoLiveEligible,
    autoLiveClass: autoExecutionPolicy.autoLiveClass,
    autoLiveBlockReason: autoExecutionPolicy.autoLiveBlockReason,
    autoLivePolicyVersion: autoExecutionPolicy.autoLivePolicyVersion,
    championshipGateEligible: suggestion.championshipGateEligible,
    championshipGateBlockReason: suggestion.championshipGateBlockReason,
    manualPrioritySkill: sanitizeValue(suggestion.manualPrioritySkill),
    manualPriorityReason: suggestion.manualPrioritySkill?.reason || null,
    manualPriorityCommand: suggestion.manualPrioritySkill?.command || null,
    manualPriorityScore: suggestion.manualPrioritySkill?.score || 0,
    manualPriorityWhyNow: suggestion.manualPrioritySkill?.whyNow || null,
    source: decision.source,
  }));

  const payload = {
    ok: true,
    helper: 'agent-next-action',
    statusOnly,
    dryRun,
    amountSats,
    recommendedAction: suggestion.recommendedAction,
    reason: suggestion.reason,
    recommendedCommand: suggestion.recommendedCommand,
    commandClass: suggestion.commandClass,
    safetyLevel: suggestion.safetyLevel,
    estimatedCostClass: suggestion.estimatedCostClass,
    fallbackCommand: suggestion.fallbackCommand,
    approvalRequired: suggestion.approvalRequired,
    manualPrioritySkill: sanitizeValue(suggestion.manualPrioritySkill),
    manualPriorityReason: suggestion.manualPrioritySkill?.reason || null,
    manualPriorityCommand: suggestion.manualPrioritySkill?.command || null,
    manualPriorityScore: suggestion.manualPrioritySkill?.score || 0,
    manualPriorityWhyNow: suggestion.manualPrioritySkill?.whyNow || null,
    autoExecutableByStandardLoop: autoExecutionPolicy.authorized,
    autoExecutionBlockReason: autoExecutionPolicy.blockReason,
    autoExecutionPolicy: autoExecutionPolicy.policy,
    autoLiveEligible: autoExecutionPolicy.autoLiveEligible,
    autoLiveClass: autoExecutionPolicy.autoLiveClass,
    autoLiveBlockReason: autoExecutionPolicy.autoLiveBlockReason,
    autoLivePolicyVersion: autoExecutionPolicy.autoLivePolicyVersion,
    championshipGateEligible: suggestion.championshipGateEligible,
    championshipGateBlockReason: suggestion.championshipGateBlockReason,
    source: decision.source,
    blockers: sanitizeValue(decision.blockers || []),
    autoLive: sanitizeValue(autoLiveState),
    state: finalState,
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
