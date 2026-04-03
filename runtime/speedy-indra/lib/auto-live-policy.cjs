const POLICY_VERSION = 'auto_live_policy_v1';

const DEFAULT_POLICY = {
  version: POLICY_VERSION,
  maxAutoExecutionsPerHour: 2,
  maxAutoExecutionsPerDay: 5,
  maxAutoSpendSatsPerDay: 0,
  maxAutoFeeSats: 100,
  allowlistedAutoSkills: ['defi_quote_monitor', 'bounty_interactions', 'messaging_safe_replies_readonly'],
  denylistedAutoSkills: ['bounty_execute', 'wallet_micro_transfer', 'messaging_paid_outbound', 'defi_swap_execute'],
};

const RISK_CLASS_BY_SKILL = {
  defi_quote_monitor: 'class_a_safe_readonly',
  bounty_interactions: 'class_a_safe_readonly',
  messaging_safe_replies: 'class_b_prepare_only',
  messaging_paid_outbound: 'class_c_manual_only',
  wallet_micro_transfer: 'class_c_manual_only',
  bounty_execute: 'class_c_manual_only',
};

const SKILL_ALLOWLIST_ALIASES = {
  messaging_safe_replies: 'messaging_safe_replies_readonly',
};

const SAFE_COMMAND_PATTERNS_BY_SKILL = {
  defi_quote_monitor: [
    /^npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=\d+$/,
  ],
  bounty_interactions: [
    /^npm run agent:bounty:scan -- --dry-run$/,
    /^npm run agent:bounty:execute -- --dry-run$/,
  ],
  messaging_safe_replies: [
    /^npm run agent:messages -- --live --reply-pending --max-replies-per-cycle=1$/,
    /^npm run agent:messages -- --status-only$/,
  ],
};

function toPositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function getAutoLivePolicy() {
  return {
    ...DEFAULT_POLICY,
    allowlistedAutoSkills: [...DEFAULT_POLICY.allowlistedAutoSkills],
    denylistedAutoSkills: [...DEFAULT_POLICY.denylistedAutoSkills],
  };
}

function classifyActionRisk(skillEvaluation = {}) {
  const skillId = String(skillEvaluation.skillId || skillEvaluation.autoLiveSkillId || '').trim();
  return RISK_CLASS_BY_SKILL[skillId] || 'class_c_manual_only';
}

function normalizeExecutionHistory(entries) {
  return (Array.isArray(entries) ? entries : []).filter(entry => entry?.at);
}

function computeUsageFromState(state, nowIso) {
  const nowMs = Date.parse(nowIso || new Date().toISOString());
  const history = normalizeExecutionHistory(state?.autoLive?.executionHistory);
  const dayKey = new Date(nowMs).toISOString().slice(0, 10);
  let executionsToday = 0;
  let executionsLastHour = 0;
  let spendSatsToday = 0;

  for (const entry of history) {
    const atMs = Date.parse(entry.at);
    if (!Number.isFinite(atMs) || atMs > nowMs) continue;
    if (new Date(atMs).toISOString().slice(0, 10) === dayKey) {
      executionsToday += 1;
      spendSatsToday += toPositiveNumber(entry.spendSats, 0);
    }
    if ((nowMs - atMs) <= (60 * 60 * 1000)) {
      executionsLastHour += 1;
    }
  }

  return {
    executionsToday,
    executionsLastHour,
    spendSatsToday,
    executionHistory: history,
  };
}

function materializeAutoLiveState(state, nowIso = new Date().toISOString()) {
  const usage = computeUsageFromState(state, nowIso);
  const current = state?.autoLive || {};
  return {
    executionsToday: usage.executionsToday,
    executionsLastHour: usage.executionsLastHour,
    spendSatsToday: usage.spendSatsToday,
    lastAutoExecutedSkillId: current.lastAutoExecutedSkillId || null,
    lastAutoExecutedAt: current.lastAutoExecutedAt || null,
    lastAutoBlockedReason: current.lastAutoBlockedReason || null,
    policyVersion: POLICY_VERSION,
    executionHistory: usage.executionHistory,
  };
}

function isAllowlistedSkill(skillId, policy) {
  if (!skillId) return false;
  return policy.allowlistedAutoSkills.includes(skillId) || policy.allowlistedAutoSkills.includes(SKILL_ALLOWLIST_ALIASES[skillId]);
}

function hasDangerousFlags(command) {
  const commandString = String(command || '');
  return (
    commandString.includes('--approve-live') ||
    /\bagent:defi:sbtc-usdcx\b/.test(commandString) ||
    /\bagent:wallet:micro:live\b/.test(commandString) ||
    (/\b--live\b/.test(commandString) && !/\bagent:messages\b/.test(commandString))
  );
}

function isReadonlyOrPrepareCommand(command) {
  const commandString = String(command || '');
  if (!commandString) return false;
  if (commandString.includes('--approve-live')) return false;
  return (
    commandString.includes('--status-only') ||
    commandString.includes('--dry-run') ||
    /\bagent:defi:dryrun\b/.test(commandString)
  );
}

function matchesAllowlistedPattern(skillId, command) {
  const patterns = SAFE_COMMAND_PATTERNS_BY_SKILL[skillId] || [];
  return patterns.some(pattern => pattern.test(String(command || '')));
}

function deriveSafeCommand(skillId, riskClass, skillEvaluation) {
  const command = skillEvaluation.recommendedCommand || skillEvaluation.command || null;
  const fallbackCommand = skillEvaluation.fallbackCommand || skillEvaluation.fallbackSafeCommand || null;
  if (riskClass === 'class_a_safe_readonly' && isReadonlyOrPrepareCommand(command)) {
    return command;
  }
  if (riskClass === 'class_b_prepare_only') {
    if (matchesAllowlistedPattern(skillId, command) && !hasDangerousFlags(command)) return command;
    if (isReadonlyOrPrepareCommand(command)) return command;
    if (matchesAllowlistedPattern(skillId, fallbackCommand) && !hasDangerousFlags(fallbackCommand)) return fallbackCommand;
    if (isReadonlyOrPrepareCommand(fallbackCommand)) return fallbackCommand;
  }
  return null;
}

function isSkillAutoLiveEligible(skillEvaluation = {}, context = {}) {
  const nowIso = context.nowIso || new Date().toISOString();
  const policy = getAutoLivePolicy();
  const autoLiveState = materializeAutoLiveState(context.state, nowIso);
  const skillId = String(skillEvaluation.skillId || skillEvaluation.autoLiveSkillId || '').trim();
  const riskClass = classifyActionRisk({ ...skillEvaluation, skillId });
  const estimatedFeeSats = toPositiveNumber(
    skillEvaluation.estimatedFeeSats ?? skillEvaluation.metadata?.estimatedFeeSats,
    0
  );
  const estimatedSpendSats = toPositiveNumber(
    skillEvaluation.estimatedSpendSats ?? skillEvaluation.metadata?.estimatedSpendSats,
    0
  );
  const safeCommand = deriveSafeCommand(skillId, riskClass, skillEvaluation);

  const base = {
    eligible: false,
    skillId,
    autoLiveClass: riskClass,
    autoLivePolicyVersion: policy.version,
    blockReason: null,
    commandToExecute: safeCommand,
    shadowCommand: safeCommand,
    executeAfterShadow: false,
    estimatedFeeSats,
    estimatedSpendSats,
    executionsToday: autoLiveState.executionsToday,
    executionsLastHour: autoLiveState.executionsLastHour,
  };

  if (!context.autoSafeActions) return { ...base, blockReason: 'auto_safe_actions_disabled' };
  if (context.dryRun) return { ...base, blockReason: 'dry_run_loop' };
  if (!skillId) return { ...base, blockReason: 'missing_auto_live_skill_id' };
  if (policy.denylistedAutoSkills.includes(skillId)) return { ...base, blockReason: 'skill_denylisted' };
  if (!isAllowlistedSkill(skillId, policy)) return { ...base, blockReason: 'skill_not_allowlisted' };
  if (riskClass === 'class_c_manual_only') return { ...base, blockReason: 'manual_only_risk_class' };
  if (autoLiveState.executionsToday >= policy.maxAutoExecutionsPerDay) return { ...base, blockReason: 'daily_auto_execution_limit_reached' };
  if (autoLiveState.executionsLastHour >= policy.maxAutoExecutionsPerHour) return { ...base, blockReason: 'hourly_auto_execution_limit_reached' };
  if (estimatedFeeSats > policy.maxAutoFeeSats) return { ...base, blockReason: 'max_auto_fee_exceeded' };
  if (estimatedSpendSats > 0 && policy.maxAutoSpendSatsPerDay <= 0) return { ...base, blockReason: 'auto_spend_not_allowed' };
  if ((autoLiveState.spendSatsToday || 0) + estimatedSpendSats > policy.maxAutoSpendSatsPerDay && estimatedSpendSats > 0) {
    return { ...base, blockReason: 'daily_auto_spend_limit_reached' };
  }
  if (!safeCommand) return { ...base, blockReason: 'no_safe_shadow_command_available' };
  if (hasDangerousFlags(safeCommand)) return { ...base, blockReason: 'dangerous_command_blocked' };
  if (!matchesAllowlistedPattern(skillId, safeCommand)) return { ...base, blockReason: 'command_not_allowlisted' };
  if (
    !isReadonlyOrPrepareCommand(safeCommand) &&
    !(riskClass === 'class_b_prepare_only' && matchesAllowlistedPattern(skillId, safeCommand))
  ) {
    return { ...base, blockReason: 'unsafe_command_classification' };
  }

  return {
    ...base,
    eligible: true,
    blockReason: 'safe_auto_shadow_execution_allowed',
    commandToExecute: safeCommand,
    shadowCommand: safeCommand,
    executeAfterShadow: false,
  };
}

function recordAutoLiveBlocked(currentState, blockReason, nowIso = new Date().toISOString()) {
  const next = materializeAutoLiveState(currentState, nowIso);
  next.lastAutoBlockedReason = blockReason || null;
  next.policyVersion = POLICY_VERSION;
  return next;
}

function recordAutoLiveExecution(currentState, execution, nowIso = new Date().toISOString()) {
  const next = materializeAutoLiveState(currentState, nowIso);
  next.executionHistory = [
    ...next.executionHistory,
    {
      at: nowIso,
      skillId: execution.skillId || null,
      feeSats: toPositiveNumber(execution.feeSats, 0),
      spendSats: toPositiveNumber(execution.spendSats, 0),
    },
  ].slice(-100);
  const refreshed = materializeAutoLiveState({ autoLive: next }, nowIso);
  refreshed.lastAutoExecutedSkillId = execution.skillId || null;
  refreshed.lastAutoExecutedAt = nowIso;
  refreshed.lastAutoBlockedReason = null;
  refreshed.policyVersion = POLICY_VERSION;
  return refreshed;
}

module.exports = {
  POLICY_VERSION,
  getAutoLivePolicy,
  classifyActionRisk,
  isSkillAutoLiveEligible,
  materializeAutoLiveState,
  recordAutoLiveBlocked,
  recordAutoLiveExecution,
  __test: {
    computeUsageFromState,
    hasDangerousFlags,
    isReadonlyOrPrepareCommand,
    matchesAllowlistedPattern,
  },
};
