const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { readAgentState, updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');

const API_BASE_URL = 'https://aibtc.com';
const DEFAULT_DESCRIPTION =
  'AI agent operated through Codex and AIBTC MCP on Stacks and Bitcoin mainnet, prepared for safe operator-approved automation.';

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (['signature', 'mnemonic', 'walletPassword'].includes(key)) {
      sanitized[key] = item ? '[REDACTED]' : item;
      continue;
    }
    sanitized[key] = sanitizeValue(item);
  }
  return sanitized;
}

function buildIdentityChecklist({ verifyResult, agentResult, levelsResult, challengeDocsResult, identityResult }) {
  const completed = [];
  const missing = [];
  const verifyBody = verifyResult.body || {};
  const agent = verifyBody.agent || agentResult.body?.agent || {};
  const level = verifyBody.level;

  if (verifyResult.ok && verifyBody.registered) {
    completed.push('agent_registered');
  } else {
    missing.push('agent_registration');
  }

  if (level === 2) {
    completed.push('genesis_unlocked');
  } else {
    missing.push('genesis_claim');
  }

  if (agent.description) {
    completed.push('public_description_present');
  } else {
    missing.push('public_description_missing');
  }

  if (agent.owner) {
    completed.push('owner_handle_present');
  }

  if (agent.erc8004AgentId) {
    completed.push('erc8004_identity_registered');
  } else {
    missing.push('erc8004_identity_registration');
  }

  if (agent.caip19) {
    completed.push('caip19_ready');
  } else {
    missing.push('caip19_missing');
  }

  if (challengeDocsResult.ok) {
    completed.push('profile_update_surface_available');
  } else {
    missing.push('profile_update_surface_unavailable');
  }

  if (levelsResult.ok) {
    completed.push('levels_surface_available');
  }

  if (identityResult.ok && identityResult.body?.agentId) {
    completed.push('identity_endpoint_available');
  } else if (!identityResult.ok) {
    missing.push('identity_endpoint_unavailable_or_rate_limited');
  }

  const recommendedActions = [];
  if (!agent.description || agent.description === DEFAULT_DESCRIPTION) {
    recommendedActions.push({
      code: 'review_profile_description',
      safe: true,
      approvalRequired: false,
      action: 'review public description before next profile sync',
    });
  }
  if (!agent.erc8004AgentId) {
    recommendedActions.push({
      code: 'erc8004_registration_pending',
      safe: false,
      approvalRequired: true,
      action: 'register on-chain identity via ERC-8004 when wallet flow is approved',
    });
  }
  if (!agent.caip19) {
    recommendedActions.push({
      code: 'metadata_uri_pending',
      safe: false,
      approvalRequired: true,
      action: 'prepare CAIP-19 / metadata URI after ERC-8004 identity exists',
    });
  }

  return {
    completed,
    missing,
    recommendedActions,
  };
}

async function runIdentitySkill(options = {}) {
  const config = loadAgentConfig();
  const nowIso = new Date().toISOString();
  const statusOnly = options.statusOnly === true;
  const dryRun = options.dryRun !== false;

  appendJsonLog('identity_skill_started', {
    dryRun,
    statusOnly,
  });

  const verifyResult = await fetchJson(`${API_BASE_URL}/api/verify/${encodeURIComponent(config.stxAddress)}`);
  const agentResult = await fetchJson(`${API_BASE_URL}/api/agents/${encodeURIComponent(config.btcAddress)}`);
  const levelsResult = await fetchJson(`${API_BASE_URL}/api/levels`);
  const challengeDocsResult = await fetchJson(`${API_BASE_URL}/api/challenge`);
  const identityResult = await fetchJson(`${API_BASE_URL}/api/identity/${encodeURIComponent(config.stxAddress)}`);

  const checklist = buildIdentityChecklist({
    verifyResult,
    agentResult,
    levelsResult,
    challengeDocsResult,
    identityResult,
  });

  const verifyBody = verifyResult.body || {};
  const agent = verifyBody.agent || agentResult.body?.agent || {};

  const finalState = updateAgentState(current => {
    current.lastIdentityCheckAt = nowIso;
    current.completedIdentitySteps = checklist.completed;
    current.missingIdentitySteps = checklist.missing;
    current.identityStatus = {
      implemented: true,
      ready: Boolean(agent.erc8004AgentId),
      status: verifyResult.ok ? 'checked' : 'degraded',
      registered: Boolean(verifyBody.registered),
      erc8004AgentId: agent.erc8004AgentId || null,
      caip19: agent.caip19 || null,
      owner: agent.owner || null,
      description: agent.description || null,
      challengeUpdateAvailable: challengeDocsResult.ok,
      approvalRequiredForWrites: true,
    };
    current.progressionStatus = {
      implemented: true,
      status: verifyResult.ok ? 'checked' : 'degraded',
      level: verifyBody.level ?? null,
      levelName: verifyBody.levelName || null,
      nextLevel: verifyBody.nextLevel || null,
      checkInCount: agent.checkInCount || 0,
      lastActiveAt: agent.lastActiveAt || null,
      achievementsUnlocked: {
        communicatorLikelyReady: current.repliedMessages > 0,
        senderPending: true,
        connectorPending: true,
      },
    };
    current.skills.identity = {
      ...current.skills.identity,
      enabled: config.featureFlags.identity,
      lastRunAt: nowIso,
      lastSuccessAt: verifyResult.ok ? nowIso : current.skills.identity.lastSuccessAt,
      lastFailureAt: verifyResult.ok ? current.skills.identity.lastFailureAt : nowIso,
      lastSkipReason: statusOnly ? 'status_only' : null,
      lastOutcome: verifyResult.ok ? 'completed' : 'failed',
      lastAttemptMode: dryRun ? 'dry_run' : 'live',
      lastStatusCode: verifyResult.status,
      errorCount: verifyResult.ok ? current.skills.identity.errorCount : current.skills.identity.errorCount + 1,
    };
    return current;
  });

  const payload = {
    ok: verifyResult.ok,
    skill: 'identity',
    dryRun,
    statusOnly,
    audit: {
      verify: sanitizeValue(verifyResult),
      agent: sanitizeValue(agentResult),
      levels: sanitizeValue(levelsResult),
      challengeDocs: sanitizeValue(challengeDocsResult),
      identityEndpoint: sanitizeValue(identityResult),
    },
    checklist,
    state: finalState,
  };

  writeAgentStatus({
    checkedAt: nowIso,
    identity: finalState.skills.identity,
    identityStatus: finalState.identityStatus,
    progressionStatus: finalState.progressionStatus,
  });

  appendJsonLog('identity_skill_completed', {
    ok: payload.ok,
    dryRun,
    level: finalState.progressionStatus.level,
    erc8004AgentId: finalState.identityStatus.erc8004AgentId,
    missingIdentitySteps: finalState.missingIdentitySteps,
  });

  return payload;
}

module.exports = {
  runIdentitySkill,
};
