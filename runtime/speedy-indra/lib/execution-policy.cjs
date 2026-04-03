const { isSkillAutoLiveEligible } = require('./auto-live-policy.cjs');

function inferAutoLiveSkillId(suggestion = {}) {
  if (suggestion?.autoLiveSkillId) return suggestion.autoLiveSkillId;
  if (suggestion?.skillId) return suggestion.skillId;
  switch (String(suggestion?.recommendedAction || '')) {
    case 'messaging_only':
      return 'messaging_safe_replies';
    case 'quote_only':
      return 'defi_quote_monitor';
    case 'defi_swap_execute':
      return 'defi_swap_execute';
    default:
      return null;
  }
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

function getPolicyDecision(suggestion, options = {}) {
  const recommendedAction = String(suggestion?.recommendedAction || 'wait');
  const recommendedCommand = suggestion?.recommendedCommand ? String(suggestion.recommendedCommand) : null;
  const safetyLevel = String(suggestion?.safetyLevel || '');
  const approvalRequired = Boolean(suggestion?.approvalRequired);
  const normalizedSuggestion = {
    ...suggestion,
    autoLiveSkillId: inferAutoLiveSkillId(suggestion),
  };
  const autoLiveDecision = isSkillAutoLiveEligible(normalizedSuggestion, {
    autoSafeActions: options.autoSafeActions,
    dryRun: options.dryRun,
    state: options.state,
    nowIso: options.nowIso,
  });

  const base = {
    recommendedAction,
    proposedCommand: recommendedCommand,
    safetyLevel,
    approvalRequired,
    authorized: autoLiveDecision.eligible,
    authorizedAction: null,
    commandToExecute: autoLiveDecision.commandToExecute || null,
    shadowCommand: autoLiveDecision.shadowCommand || null,
    executeAfterShadow: Boolean(autoLiveDecision.executeAfterShadow),
    blockReason: autoLiveDecision.blockReason,
    policy: 'standard_loop_execution_policy_v1',
    autoLiveEligible: autoLiveDecision.eligible,
    autoLiveClass: autoLiveDecision.autoLiveClass,
    autoLiveBlockReason: autoLiveDecision.blockReason,
    autoLivePolicyVersion: autoLiveDecision.autoLivePolicyVersion,
    autoLiveSkillId: autoLiveDecision.skillId || normalizedSuggestion.autoLiveSkillId || null,
    estimatedFeeSats: autoLiveDecision.estimatedFeeSats || 0,
    estimatedSpendSats: autoLiveDecision.estimatedSpendSats || 0,
  };

  if (recommendedAction === 'wait') {
    return {
      ...base,
      authorized: false,
      blockReason: 'wait_recommended',
      autoLiveEligible: false,
      autoLiveBlockReason: 'wait_recommended',
    };
  }
  if (options.dryRun) {
    return {
      ...base,
      authorized: false,
      blockReason: 'dry_run_loop',
      autoLiveEligible: false,
      autoLiveBlockReason: 'dry_run_loop',
    };
  }
  if (!['messaging_only', 'quote_only', 'defi_swap_execute', 'wait'].includes(recommendedAction)) {
    return {
      ...base,
      authorized: false,
      blockReason: 'unknown_recommended_action',
      autoLiveEligible: false,
      autoLiveBlockReason: 'unknown_recommended_action',
    };
  }
  if (!recommendedCommand) {
    return {
      ...base,
      authorized: false,
      blockReason: 'no_recommended_command',
      autoLiveEligible: false,
      autoLiveBlockReason: 'no_recommended_command',
    };
  }
  if (
    ['quote_only', 'defi_swap_execute'].includes(recommendedAction) &&
    suggestion?.championshipGateEligible === false &&
    suggestion?.championshipGateBlockReason
  ) {
    return {
      ...base,
      authorized: false,
      blockReason: suggestion.championshipGateBlockReason,
      autoLiveEligible: false,
      autoLiveBlockReason: suggestion.championshipGateBlockReason,
    };
  }
  if (approvalRequired) {
    return {
      ...base,
      authorized: false,
      blockReason: 'approval_required',
      autoLiveEligible: false,
      autoLiveBlockReason: 'approval_required',
    };
  }
  if (recommendedAction === 'defi_swap_execute') {
    return {
      ...base,
      authorized: false,
      blockReason: 'defi_swap_execute_never_auto_executed',
      autoLiveEligible: false,
      autoLiveBlockReason: 'defi_swap_execute_never_auto_executed',
    };
  }
  if (!autoLiveDecision.eligible) {
    return base;
  }

  return {
    ...base,
    authorizedAction: recommendedAction,
    commandToExecute: autoLiveDecision.commandToExecute || recommendedCommand,
    shadowCommand: autoLiveDecision.shadowCommand || recommendedCommand,
  };
}

module.exports = {
  getPolicyDecision,
  sanitizeValue,
  __test: {
    getPolicyDecision,
  },
};
