#!/usr/bin/env node

const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { readAgentState, updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');
const { buildPreparedBountyCandidate, scanBountyCandidatesFromState } = require('./lib/bounty-scan.cjs');

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
    if (arg === '--status-only') {
      flags.statusOnly = true;
      continue;
    }
    if (arg === '--force') {
      flags.force = true;
      continue;
    }
  }
  return flags;
}

function deriveCandidateFoundReason(source) {
  return source === 'external_bounty'
    ? 'external_bounty_candidate_found'
    : 'bounty_candidate_found_in_inbox';
}

function derivePreparedReason(baseReason, source) {
  if (source !== 'external_bounty') return baseReason;
  if (baseReason === 'prepared_bounty_candidate_ready') {
    return 'external_prepared_bounty_candidate_ready';
  }
  return baseReason;
}

async function runBountyInteractionsSkill(options = {}) {
  const state = readAgentState();
  const nowIso = new Date().toISOString();
  const statusOnly = parseBoolean(options.statusOnly, false);
  const dryRun = options.dryRun === undefined ? true : parseBoolean(options.dryRun, true);
  const result = scanBountyCandidatesFromState(state);
  const prepared = buildPreparedBountyCandidate(state, { nowIso });
  const preparedCandidateSource = prepared.candidate?.source || null;
  const selectedCandidateRewardSats = Number(prepared.candidate?.rewardSats || 0);
  const effectiveResult = prepared.candidate
    ? {
        ...result,
        reason: deriveCandidateFoundReason(preparedCandidateSource),
      }
    : {
        ...result,
        eligible: false,
        status: 'no_candidates',
        reason: 'no_operational_bounty_candidates',
        usefulSignalFound: false,
        lastCandidateCount: 0,
      };

  const nextState = updateAgentState(current => {
    current.bountyExecution = {
      ...current.bountyExecution,
      preparedCandidates: prepared.candidates || [],
      preparedCandidate: prepared.candidate,
      lastPreparedCandidateId: prepared.candidate?.candidateId || null,
      lastPreparedCandidateSource: prepared.candidate?.source || null,
      lastEvaluationAt: nowIso,
      lastStatus: prepared.status,
      lastReason: prepared.reason,
      lastBlockedReason: prepared.blockers?.[0] || null,
      lastManualCommand: prepared.candidate?.command || 'npm run agent:bounty:scan -- --dry-run',
      approvalRequired: true,
      autoExecutable: false,
    };
    return current;
  });

  appendJsonLog('bounty_scan_completed', sanitizeValue({
    ok: true,
    statusOnly,
    dryRun,
    status: effectiveResult.status,
    eligible: effectiveResult.eligible,
    lastCandidateCount: effectiveResult.lastCandidateCount,
    usefulSignalFound: effectiveResult.usefulSignalFound,
    preparedCandidateId: prepared.candidate?.candidateId || null,
    preparedCandidateSource,
    selectedCandidateRewardSats,
    preparedCandidateCount: Array.isArray(prepared.candidates) ? prepared.candidates.length : 0,
    preparedStatus: prepared.status,
    preparedReason: derivePreparedReason(prepared.reason, preparedCandidateSource),
  }));

  writeAgentStatus({
    checkedAt: nowIso,
    bounty: sanitizeValue({
      status: effectiveResult.status,
      eligible: effectiveResult.eligible,
      reason: effectiveResult.reason,
      lastCandidateCount: effectiveResult.lastCandidateCount,
      usefulSignalFound: effectiveResult.usefulSignalFound,
      command: effectiveResult.command,
      fallbackCommand: effectiveResult.fallbackCommand,
      preparedCandidateId: prepared.candidate?.candidateId || null,
      preparedCandidateSource,
      selectedCandidateRewardSats,
      preparedCandidateCount: Array.isArray(prepared.candidates) ? prepared.candidates.length : 0,
      preparedStatus: prepared.status,
      preparedReason: derivePreparedReason(prepared.reason, preparedCandidateSource),
    }),
  });

  return {
    ok: true,
    skill: 'bounty-interactions',
    statusOnly,
    dryRun,
    ...sanitizeValue(effectiveResult),
    preparedCandidateId: prepared.candidate?.candidateId || null,
    preparedCandidateSource,
    selectedCandidateRewardSats,
    preparedCandidateCount: Array.isArray(prepared.candidates) ? prepared.candidates.length : 0,
    preparedCandidates: sanitizeValue(prepared.candidates || []),
    preparedStatus: prepared.status,
    preparedReason: derivePreparedReason(prepared.reason, preparedCandidateSource),
    state: nextState,
  };
}

if (require.main === module) {
  runBountyInteractionsSkill(parseArgs(process.argv.slice(2)))
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
  runBountyInteractionsSkill,
  scanBountyCandidatesFromState,
};
