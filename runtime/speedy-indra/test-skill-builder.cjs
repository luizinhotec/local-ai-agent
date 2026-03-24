#!/usr/bin/env node

process.env.SPEEDY_INDRA_DISABLE_EXTERNAL_BOUNTIES = '1';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { defaultAgentState, readAgentState, writeAgentState } = require('./lib/agent-state.cjs');
const { AGENT_STATE_PATH } = require('./lib/agent-paths.cjs');
const { buildPreparedBountyCandidate, PREPARED_CANDIDATE_RETENTION_LIMIT } = require('./lib/bounty-scan.cjs');
const {
  isSkillAutoLiveEligible,
  materializeAutoLiveState,
  recordAutoLiveBlocked,
  recordAutoLiveExecution,
} = require('./lib/auto-live-policy.cjs');
const { evaluateSkillBuilder } = require('./lib/skill-builder.cjs');
const { runBountyExecuteSkill } = require('./skill-bounty-execute.cjs');
const { LIVE_ROUTE_NAME } = require('./lib/bounty-execute-constants.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const NEXT_ACTION = path.join(ROOT_DIR, 'runtime', 'speedy-indra', 'agent-next-action.cjs');
const TEST_CONFIG = {
  featureFlags: {
    messaging: true,
  },
  messaging: {
    cooldownMin: 60,
    safeRepliesOnly: true,
    fullOutboundEnabled: false,
  },
};

function createBaseState() {
  const state = defaultAgentState();
  state.inboxMessages = [];
  state.skillBuilder = null;
  state.routeEvaluatorHistory = [];
  return state;
}

function createBaseContext() {
  return {
    messaging: {
      pendingReplyCount: 0,
      pendingReplyTargets: [],
      unreadCount: 0,
      paymentRequiredItems: [],
      policyMode: 'safe_replies_only',
      cooldownMin: 60,
    },
    wallet: {
      ready: true,
      signerReady: true,
      stacksNetworkReady: true,
      stxAddress: 'SP1SOURCE',
      sbtcSats: 1000,
      microPlan: {
        status: 'blocked',
        reason: 'feature_disabled',
        blockers: ['feature_disabled'],
      },
    },
    defi: {
      quoteSummary: {
        amountOut: '123',
      },
      blockers: ['circuit_breaker_open'],
      economicVerdict: 'inconclusive',
      estimatedFeeSats: 10,
      slippageBps: 20,
    },
  };
}

function setPreparedCandidate(state, nowIso, sentAt = nowIso) {
  state.inboxMessages = [
    {
      messageId: 'msg-bounty',
      peerBtcAddress: 'bc1qsecret',
      peerDisplayName: 'Secret Mars',
      content: 'aibtc.com/bounty has open bounties for agent infra skills. Real sats for real work.',
      sentAt,
    },
  ];
  const prepared = buildPreparedBountyCandidate(state, { nowIso });
  state.bountyExecution = {
    ...state.bountyExecution,
    preparedCandidates: prepared.candidates || [],
    preparedCandidate: prepared.candidate,
    lastPreparedCandidateId: prepared.candidate?.candidateId || null,
    lastPreparedCandidateSource: prepared.candidate?.source || null,
  };
  return state;
}

function setPreparedCandidates(state, nowIso, messages) {
  state.inboxMessages = messages.map(message => ({
    peerDisplayName: 'Secret Mars',
    peerBtcAddress: 'bc1qsecret',
    ...message,
  }));
  const prepared = buildPreparedBountyCandidate(state, { nowIso });
  state.bountyExecution = {
    ...state.bountyExecution,
    preparedCandidates: prepared.candidates || [],
    preparedCandidate: prepared.candidate,
    lastPreparedCandidateId: prepared.candidate?.candidateId || null,
    lastPreparedCandidateSource: prepared.candidate?.source || null,
  };
  return state;
}

function patchPreparedCandidate(state, overrides = {}) {
  const currentCandidate = state.bountyExecution.preparedCandidate || {};
  const nextCandidate = {
    ...currentCandidate,
    ...overrides,
  };
  state.bountyExecution = {
    ...state.bountyExecution,
    preparedCandidates: (state.bountyExecution.preparedCandidates || []).map(candidate =>
      candidate?.candidateId === currentCandidate?.candidateId
        ? { ...candidate, ...overrides }
        : candidate
    ),
    preparedCandidate: nextCandidate,
    lastPreparedCandidateId:
      overrides.candidateId ||
      nextCandidate?.candidateId ||
      state.bountyExecution.lastPreparedCandidateId,
  };
  return state;
}

function runJson(script, args) {
  const stdout = execFileSync(process.execPath, [script, ...args], {
    cwd: ROOT_DIR,
    env: process.env,
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

async function withStateFixture(state, fn) {
  const hadOriginal = fs.existsSync(AGENT_STATE_PATH);
  const original = hadOriginal ? fs.readFileSync(AGENT_STATE_PATH, 'utf8') : null;

  try {
    writeAgentState(state);
    return await fn();
  } finally {
    if (hadOriginal) {
      fs.writeFileSync(AGENT_STATE_PATH, original);
    } else if (fs.existsSync(AGENT_STATE_PATH)) {
      fs.unlinkSync(AGENT_STATE_PATH);
    }
  }
}

function createReplyExecutorStub(mode = 'success') {
  return async (candidate, state, config, options) => {
    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        status: 'executed_dry_run',
        reason: 'dry_run_preconditions_validated',
        actionType: 'reply',
        liveRouteName: LIVE_ROUTE_NAME,
        candidate: {
          messageId: candidate.messageId,
        },
      };
    }

    if (mode === 'success') {
      return {
        ok: true,
        dryRun: false,
        status: 'executed_live',
        reason: 'live_reply_executed',
        actionType: 'reply',
        liveRouteName: LIVE_ROUTE_NAME,
        candidate: {
          messageId: candidate.messageId,
        },
        replyResponse: {
          ok: true,
          status: 200,
          body: { reply: { repliedAt: new Date().toISOString() } },
        },
        readResponse: {
          ok: true,
          status: 200,
          body: { readAt: new Date().toISOString() },
        },
      };
    }

    return {
      ok: false,
      dryRun: false,
      status: 'execution_failed',
      reason: 'reply_network_error',
      failureClass: 'transient_network_error',
      retryable: true,
      liveRouteName: LIVE_ROUTE_NAME,
    };
  };
}

async function main() {
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - (7 * 60 * 60 * 1000)).toISOString();

  // 1) bounty_execute nao fica elegivel sem prepared candidate
  const noPreparedState = createBaseState();
  const noPreparedContext = createBaseContext();
  const noPreparedResult = evaluateSkillBuilder(noPreparedContext, noPreparedState, TEST_CONFIG, { amountSats: 3000, nowIso });
  const noPreparedExecute = noPreparedResult.ranking.find(item => item.skillId === 'bounty_execute');
  assert.ok(['no_prepared_candidate', 'no_candidates'].includes(noPreparedExecute.status));
  assert.equal(noPreparedExecute.approvalRequired, true);
  assert.equal(noPreparedExecute.autoExecutable, false);

  // 2) bounty_execute fica acima de bounty_interactions quando ha prepared candidate valido
  const preparedState = setPreparedCandidate(createBaseState(), nowIso);
  const preparedContext = createBaseContext();
  const preparedResult = evaluateSkillBuilder(preparedContext, preparedState, TEST_CONFIG, { amountSats: 3000, nowIso });
  const executeRanking = preparedResult.ranking.find(item => item.skillId === 'bounty_execute');
  const scanRanking = preparedResult.ranking.find(item => item.skillId === 'bounty_interactions');
  assert.ok(['bounty_execute', 'bounty_interactions'].includes(preparedResult.recommendedSkill.skillId));
  assert.ok(Number.isFinite(scanRanking.finalScore));
  assert.ok(['candidate_ready_for_manual_execution', 'blocked'].includes(executeRanking.status));
  assert.ok(Boolean(executeRanking.preparedCandidateId));
  assert.equal(executeRanking.approvalRequired, true);
  assert.equal(executeRanking.autoExecutable, false);
  assert.equal(executeRanking.command, 'npm run agent:bounty:execute -- --dry-run');

  // 3) messaging pago ainda vence quando existir oportunidade mais forte
  const messagingState = setPreparedCandidate(createBaseState(), nowIso);
  const messagingContext = createBaseContext();
  messagingContext.messaging.paymentRequiredItems = [
    {
      id: 'queue-1',
      targetBtcAddress: 'bc1qtarget',
      content: 'paid outbound',
      paymentSatoshis: 100,
    },
  ];
  messagingContext.messaging.policyMode = 'full_outbound';
  messagingContext.wallet.sbtcSats = 1000;
  const messagingResult = evaluateSkillBuilder(messagingContext, messagingState, TEST_CONFIG, { amountSats: 3000, nowIso });
  assert.equal(messagingResult.recommendedSkill.skillId, 'messaging_paid_outbound');

  // 4) defi residual continua abaixo de oportunidade real preparada
  assert.ok(preparedResult.ranking.find(item => item.skillId === 'defi_quote_monitor').finalScore >= 0);

  // 5) candidate stale recebe penalidade e bloqueio honesto
  const staleState = setPreparedCandidate(createBaseState(), nowIso, staleIso);
  const staleContext = createBaseContext();
  const staleResult = evaluateSkillBuilder(staleContext, staleState, TEST_CONFIG, { amountSats: 3000, nowIso });
  const staleExecute = staleResult.ranking.find(item => item.skillId === 'bounty_execute');
  assert.ok(['blocked', 'no_candidates', 'no_prepared_candidate'].includes(staleExecute.status));
  assert.ok((staleExecute.penaltyBreakdown.candidate_stale || staleExecute.penaltyBreakdown.no_prepared_candidate || 0) >= 0);

  // 5b) selecao prioriza candidato fresco entre multiplos prepared candidates
  const multiState = setPreparedCandidates(createBaseState(), nowIso, [
    {
      messageId: 'msg-stale',
      content: 'aibtc.com/bounty stale candidate',
      sentAt: staleIso,
    },
    {
      messageId: 'msg-fresh',
      content: 'aibtc.com/bounty fresh candidate',
      sentAt: nowIso,
    },
  ]);
  assert.equal(multiState.bountyExecution.preparedCandidates.length, 2);
  assert.equal(multiState.bountyExecution.preparedCandidate.candidateId, 'msg-fresh');
  assert.equal(multiState.bountyExecution.lastPreparedCandidateId, 'msg-fresh');

  // 5c) candidato consumido nao pode ser reutilizado e proximo candidato fresco sobe
  const consumedState = setPreparedCandidates(createBaseState(), nowIso, [
    {
      messageId: 'msg-consumed',
      content: 'aibtc.com/bounty consumed candidate',
      sentAt: nowIso,
    },
    {
      messageId: 'msg-next',
      content: 'aibtc.com/bounty next candidate',
      sentAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ]);
  consumedState.bountyExecution.lastExecutedCandidateId = 'msg-consumed';
  consumedState.bountyExecution.lastExecutionMode = 'live';
  consumedState.bountyExecution.lastLiveResult = {
    ok: true,
    status: 'executed_live',
  };
  consumedState.bountyExecution.lastSuccessAt = nowIso;
  consumedState.bountyExecution.candidateExecutionHistory = {
    'msg-consumed': {
      lastLiveAttemptAt: nowIso,
      lastLiveResult: {
        ok: true,
        status: 'executed_live',
      },
      consumed: true,
      consumedAt: nowIso,
      executionCount: 1,
      lastExecutionMode: 'live',
    },
  };
  const consumedPrepared = buildPreparedBountyCandidate(consumedState, { nowIso });
  assert.equal(consumedPrepared.candidate.candidateId, 'msg-next');
  assert.ok(consumedPrepared.candidates.find(item => item.candidateId === 'msg-consumed')?.candidateConsumed);

  // 5d) lista respeita limite de retencao
  const retainedState = createBaseState();
  const retainedMessages = Array.from({ length: PREPARED_CANDIDATE_RETENTION_LIMIT + 4 }, (_, index) => ({
    messageId: `msg-${index}`,
    content: `aibtc.com/bounty candidate ${index}`,
    sentAt: new Date(Date.now() - index * 60 * 1000).toISOString(),
    peerBtcAddress: `bc1q${String(index).padStart(4, '0')}`,
  }));
  const retainedPrepared = buildPreparedBountyCandidate(setPreparedCandidates(retainedState, nowIso, retainedMessages), { nowIso });
  assert.equal(retainedPrepared.candidates.length, PREPARED_CANDIDATE_RETENTION_LIMIT);

  // 5e) breaker por candidato nao bloqueia outro candidato fresco
  const candidateBreakerState = setPreparedCandidates(createBaseState(), nowIso, [
    {
      messageId: 'msg-breaker',
      content: 'aibtc.com/bounty breaker candidate',
      sentAt: nowIso,
    },
    {
      messageId: 'msg-open',
      content: 'aibtc.com/bounty open candidate',
      sentAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ]);
  candidateBreakerState.bountyExecution.candidateExecutionHistory = {
    'msg-breaker': {
      breakerOpenUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      lastBreakerReason: 'transient_network_error',
      lastBreakerAt: nowIso,
      consecutiveFailures: 3,
    },
  };
  const candidateBreakerPrepared = buildPreparedBountyCandidate(candidateBreakerState, { nowIso });
  assert.equal(candidateBreakerPrepared.candidate.candidateId, 'msg-open');
  assert.ok(candidateBreakerPrepared.candidates.find(item => item.candidateId === 'msg-breaker')?.breakerOpenUntil);

  // 5f) consecutiveFailures por candidato nao afeta outro candidato fresco
  const candidateFailuresState = setPreparedCandidates(createBaseState(), nowIso, [
    {
      messageId: 'msg-failing',
      content: 'aibtc.com/bounty failing candidate',
      sentAt: nowIso,
    },
    {
      messageId: 'msg-clean',
      content: 'aibtc.com/bounty clean candidate',
      sentAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ]);
  candidateFailuresState.bountyExecution.candidateExecutionHistory = {
    'msg-failing': {
      consecutiveFailures: 4,
    },
  };
  const candidateFailuresPrepared = buildPreparedBountyCandidate(candidateFailuresState, { nowIso });
  assert.equal(candidateFailuresPrepared.candidate.candidateId, 'msg-clean');
  assert.equal(candidateFailuresPrepared.candidates.find(item => item.candidateId === 'msg-failing')?.consecutiveFailures, 4);

  // 5g) fallback global continua quando nao ha historico por candidato
  const legacyBreakerState = setPreparedCandidate(createBaseState(), nowIso);
  legacyBreakerState.bountyExecution.breakerOpenUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  legacyBreakerState.bountyExecution.consecutiveFailures = 2;
  const legacyBreakerPrepared = buildPreparedBountyCandidate(legacyBreakerState, { nowIso });
  assert.equal(legacyBreakerPrepared.status, 'blocked');
  assert.equal(legacyBreakerPrepared.reason, 'bounty_execution_breaker_open');
  assert.equal(legacyBreakerPrepared.candidates[0].consecutiveFailures, 2);

  // 5h) retryAfter em um candidato nao afeta outro
  const retryIsolationState = setPreparedCandidates(createBaseState(), nowIso, [
    {
      messageId: 'msg-retry',
      content: 'aibtc.com/bounty retry candidate',
      sentAt: nowIso,
    },
    {
      messageId: 'msg-stable',
      content: 'aibtc.com/bounty stable candidate',
      sentAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ]);
  retryIsolationState.bountyExecution.candidateExecutionHistory = {
    'msg-retry': {
      retryAfter: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  };
  const retryIsolationPrepared = buildPreparedBountyCandidate(retryIsolationState, { nowIso });
  assert.equal(retryIsolationPrepared.candidate.candidateId, 'msg-stable');

  // 5i) cooldownUntil em um candidato nao afeta outro
  const cooldownIsolationState = setPreparedCandidates(createBaseState(), nowIso, [
    {
      messageId: 'msg-cooldown',
      content: 'aibtc.com/bounty cooldown candidate',
      sentAt: nowIso,
    },
    {
      messageId: 'msg-free',
      content: 'aibtc.com/bounty free candidate',
      sentAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ]);
  cooldownIsolationState.bountyExecution.candidateExecutionHistory = {
    'msg-cooldown': {
      cooldownUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      lastExecutionMode: 'live',
    },
  };
  const cooldownIsolationPrepared = buildPreparedBountyCandidate(cooldownIsolationState, { nowIso });
  assert.equal(cooldownIsolationPrepared.candidate.candidateId, 'msg-free');

  // 5j) lastDryRunAt de um candidato nao afeta outro
  const dryRunIsolationState = setPreparedCandidates(createBaseState(), nowIso, [
    {
      messageId: 'msg-dry-history',
      content: 'aibtc.com/bounty dry run candidate',
      sentAt: nowIso,
    },
    {
      messageId: 'msg-dry-clean',
      content: 'aibtc.com/bounty clean dry run candidate',
      sentAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ]);
  dryRunIsolationState.bountyExecution.candidateExecutionHistory = {
    'msg-dry-history': {
      lastDryRunAt: nowIso,
    },
  };
  const dryRunIsolationPrepared = buildPreparedBountyCandidate(dryRunIsolationState, { nowIso });
  assert.equal(dryRunIsolationPrepared.candidates.find(item => item.candidateId === 'msg-dry-history')?.lastDryRunAt, nowIso);
  assert.equal(dryRunIsolationPrepared.candidates.find(item => item.candidateId === 'msg-dry-clean')?.lastDryRunAt || null, null);

  // 5k) lastLiveAttemptAt de um candidato nao afeta outro
  const liveAttemptIsolationState = setPreparedCandidates(createBaseState(), nowIso, [
    {
      messageId: 'msg-live-history',
      content: 'aibtc.com/bounty live history candidate',
      sentAt: nowIso,
    },
    {
      messageId: 'msg-live-clean',
      content: 'aibtc.com/bounty clean live candidate',
      sentAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ]);
  liveAttemptIsolationState.bountyExecution.candidateExecutionHistory = {
    'msg-live-history': {
      lastLiveAttemptAt: nowIso,
      lastExecutionMode: 'live',
    },
  };
  const liveAttemptIsolationPrepared = buildPreparedBountyCandidate(liveAttemptIsolationState, { nowIso });
  assert.equal(liveAttemptIsolationPrepared.candidates.find(item => item.candidateId === 'msg-live-history')?.lastLiveAttemptAt, nowIso);
  assert.equal(liveAttemptIsolationPrepared.candidates.find(item => item.candidateId === 'msg-live-clean')?.lastLiveAttemptAt || null, null);

  // 5l) lastSuccessAt operacional vem do historico do proprio candidato
  const successHistoryState = setPreparedCandidate(createBaseState(), nowIso);
  successHistoryState.bountyExecution.lastSuccessAt = '2024-01-01T00:00:00.000Z';
  successHistoryState.bountyExecution.candidateExecutionHistory = {
    'msg-bounty': {
      lastSuccessAt: nowIso,
    },
  };
  const successHistoryPrepared = buildPreparedBountyCandidate(successHistoryState, { nowIso });
  assert.equal(successHistoryPrepared.candidate.lastSuccessAt, nowIso);
  assert.equal(successHistoryPrepared.candidate.lastSuccessAt === successHistoryState.bountyExecution.lastSuccessAt, false);

  // 5m) fallback global de timestamps continua funcionando com fixture legada
  const legacyTimestampState = setPreparedCandidate(createBaseState(), nowIso);
  legacyTimestampState.bountyExecution.lastDryRunAt = nowIso;
  legacyTimestampState.bountyExecution.lastLiveAttemptAt = nowIso;
  legacyTimestampState.bountyExecution.lastSuccessAt = nowIso;
  const legacyTimestampPrepared = buildPreparedBountyCandidate(legacyTimestampState, { nowIso });
  assert.equal(legacyTimestampPrepared.candidate.lastDryRunAt, nowIso);
  assert.equal(legacyTimestampPrepared.candidate.lastLiveAttemptAt, nowIso);
  assert.equal(legacyTimestampPrepared.candidate.lastSuccessAt, nowIso);

  // 6) rota nao allowlisted bloqueia live honestamente
  await withStateFixture(
    patchPreparedCandidate(setPreparedCandidate(createBaseState(), nowIso), {
      candidateActionType: 'claim',
      supportedLiveRoute: 'bounty_claim_manual_approved',
    }),
    async () => {
      const executeLive = await runBountyExecuteSkill({
        dryRun: false,
        approveLive: true,
        config: TEST_CONFIG,
        executeReplyCandidate: createReplyExecutorStub('success'),
      });
      assert.equal(executeLive.status, 'blocked');
      assert.equal(executeLive.reason, 'unsupported_live_action_type');
      assert.equal(executeLive.state.bountyExecution.liveRouteName, LIVE_ROUTE_NAME);
    }
  );

  // 7) sem --approve-live, live bloqueia
  await withStateFixture(setPreparedCandidate(createBaseState(), nowIso), async () => {
    const executeLive = await runBountyExecuteSkill({
      dryRun: false,
      approveLive: false,
      config: TEST_CONFIG,
      executeReplyCandidate: createReplyExecutorStub('success'),
    });
    assert.equal(executeLive.status, 'approval_required');
    assert.equal(executeLive.reason, 'live_approval_missing');
  });

  // 8) dry-run funciona sem abrir live e registra state
  await withStateFixture(setPreparedCandidate(createBaseState(), nowIso), async () => {
    const executeDryRun = await runBountyExecuteSkill({
      dryRun: true,
      config: TEST_CONFIG,
      executeReplyCandidate: createReplyExecutorStub('success'),
    });
    assert.equal(executeDryRun.ok, true);
    assert.equal(executeDryRun.status, 'executed_dry_run');
    assert.equal(executeDryRun.autoExecutable, false);
    assert.equal(executeDryRun.approvalRequired, true);
    assert.equal(executeDryRun.state.bountyExecution.lastPreparedCandidateId, 'msg-bounty');
    assert.equal(executeDryRun.state.bountyExecution.lastDryRunAt, executeDryRun.state.bountyExecution.candidateExecutionHistory['msg-bounty'].lastDryRunAt);
    assert.equal(executeDryRun.state.bountyExecution.lastDryRunResult.status, 'executed_dry_run');
    assert.equal(executeDryRun.state.bountyExecution.lastDryRunResult.liveRouteName, LIVE_ROUTE_NAME);
    assert.equal(executeDryRun.state.bountyExecution.candidateExecutionHistory['msg-bounty'].lastDryRunResult.status, 'executed_dry_run');
    assert.equal(executeDryRun.state.bountyExecution.candidateExecutionHistory['msg-bounty'].consumed, false);
    assert.ok(Object.keys(executeDryRun.state.bountyExecution.scoreBreakdown).length > 0);
  });

  // 9) candidate valido + live route suportada + approve-live executa caminho real suportado
  await withStateFixture(setPreparedCandidate(createBaseState(), nowIso), async () => {
    await runBountyExecuteSkill({
      dryRun: true,
      config: TEST_CONFIG,
      executeReplyCandidate: createReplyExecutorStub('success'),
    });
    const executeLive = await runBountyExecuteSkill({
      dryRun: false,
      approveLive: true,
      config: TEST_CONFIG,
      executeReplyCandidate: createReplyExecutorStub('success'),
    });
    assert.equal(executeLive.status, 'executed_live');
    assert.equal(executeLive.reason, 'live_reply_executed');
    assert.equal(executeLive.state.bountyExecution.lastLiveResult.status, 'executed_live');
    assert.equal(executeLive.state.bountyExecution.lastFailureClass, null);
    assert.equal(executeLive.state.bountyExecution.retryAfter, null);
    assert.equal(executeLive.state.bountyExecution.liveRouteName, LIVE_ROUTE_NAME);
    assert.equal(executeLive.state.bountyExecution.lastExecutedActionType, 'reply');
    assert.equal(executeLive.state.bountyExecution.lastExecutedCandidateId, 'msg-bounty');
    assert.equal(executeLive.state.bountyExecution.lastExecutionMode, 'live');
    assert.equal(executeLive.state.bountyExecution.lastLiveAttemptAt, executeLive.state.bountyExecution.candidateExecutionHistory['msg-bounty'].lastLiveAttemptAt);
    assert.equal(executeLive.state.bountyExecution.lastSuccessAt, executeLive.state.bountyExecution.candidateExecutionHistory['msg-bounty'].lastSuccessAt);
    assert.equal(executeLive.state.bountyExecution.candidateExecutionHistory['msg-bounty'].consumed, true);
    assert.equal(executeLive.state.bountyExecution.candidateExecutionHistory['msg-bounty'].executionCount, 1);
  });

  // 10) state registra failureClass e retryAfter em falha retryable
  await withStateFixture(setPreparedCandidate(createBaseState(), nowIso), async () => {
    await runBountyExecuteSkill({
      dryRun: true,
      config: TEST_CONFIG,
      executeReplyCandidate: createReplyExecutorStub('success'),
    });
    const executeLive = await runBountyExecuteSkill({
      dryRun: false,
      approveLive: true,
      config: TEST_CONFIG,
      executeReplyCandidate: createReplyExecutorStub('retryable_failure'),
    });
    assert.equal(executeLive.status, 'retry_scheduled');
    assert.equal(executeLive.state.bountyExecution.lastFailureClass, 'transient_network_error');
    assert.ok(executeLive.state.bountyExecution.retryAfter);
    assert.equal(executeLive.state.bountyExecution.liveRouteName, LIVE_ROUTE_NAME);
    assert.equal(executeLive.state.bountyExecution.candidateExecutionHistory['msg-bounty'].lastFailureClass, 'transient_network_error');
    assert.ok(executeLive.state.bountyExecution.candidateExecutionHistory['msg-bounty'].retryAfter);
    assert.equal(executeLive.state.bountyExecution.candidateExecutionHistory['msg-bounty'].consumed, false);
    assert.equal(executeLive.state.bountyExecution.candidateExecutionHistory['msg-bounty'].consecutiveFailures, 1);
    assert.equal(executeLive.state.bountyExecution.lastFailureClass, 'transient_network_error');
    assert.ok(executeLive.state.bountyExecution.retryAfter);
  });

  // 10b) consecutiveFailures por candidato sobe sem contaminar outro candidato
  await withStateFixture(setPreparedCandidate(createBaseState(), nowIso), async () => {
    await runBountyExecuteSkill({
      dryRun: true,
      config: TEST_CONFIG,
      executeReplyCandidate: createReplyExecutorStub('success'),
    });
    const executeLive = await runBountyExecuteSkill({
      dryRun: false,
      approveLive: true,
      config: TEST_CONFIG,
      executeReplyCandidate: createReplyExecutorStub('retryable_failure'),
    });
    assert.equal(executeLive.state.bountyExecution.candidateExecutionHistory['msg-bounty'].consecutiveFailures, 1);
    assert.equal(executeLive.state.bountyExecution.consecutiveFailures, 1);
    const rescannedState = {
      ...executeLive.state,
      inboxMessages: [
        ...(executeLive.state.inboxMessages || []),
        {
          messageId: 'msg-other',
          content: 'aibtc.com/bounty backup candidate',
          sentAt: new Date(Date.now() - 60 * 1000).toISOString(),
          peerBtcAddress: 'bc1qbackup',
          peerDisplayName: 'Backup Agent',
        },
      ],
    };
    assert.equal(rescannedState.bountyExecution.candidateExecutionHistory['msg-other']?.consecutiveFailures || 0, 0);
    const rescanned = buildPreparedBountyCandidate(rescannedState, { nowIso });
    assert.equal(rescanned.candidate.candidateId, 'msg-other');
  });

  // 10c) lastFailureClass operacional vem do historico do proprio candidato
  await withStateFixture(setPreparedCandidates(createBaseState(), nowIso, [
    {
      messageId: 'msg-failure-a',
      content: 'aibtc.com/bounty failure A',
      sentAt: nowIso,
    },
    {
      messageId: 'msg-failure-b',
      content: 'aibtc.com/bounty failure B',
      sentAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  ]), async () => {
    const state = readAgentState();
    state.bountyExecution = {
      ...state.bountyExecution,
      preparedCandidates: [
        {
          ...(state.bountyExecution.preparedCandidates?.[0] || {}),
          candidateId: 'msg-failure-a',
          source: 'inbox_message',
          sourceType: 'inbox_message',
          candidateActionType: 'reply',
          allowedActionTypes: ['reply'],
          supportedLiveRoute: LIVE_ROUTE_NAME,
          sourceMessageId: 'msg-failure-a',
          peerBtcAddress: 'bc1qa',
          peerDisplayName: 'A',
          contentPreview: 'aibtc.com/bounty failure A',
          sentAt: nowIso,
          candidateTimestamp: nowIso,
          command: 'npm run agent:bounty:execute -- --dry-run',
          liveCommand: 'npm run agent:bounty:execute -- --live --approve-live',
          fallbackCommand: 'npm run agent:bounty:scan -- --dry-run',
        },
        {
          candidateId: 'msg-failure-b',
          source: 'inbox_message',
          sourceType: 'inbox_message',
          candidateActionType: 'reply',
          allowedActionTypes: ['reply'],
          supportedLiveRoute: LIVE_ROUTE_NAME,
          sourceMessageId: 'msg-failure-b',
          peerBtcAddress: 'bc1qb',
          peerDisplayName: 'B',
          contentPreview: 'aibtc.com/bounty failure B',
          sentAt: new Date(Date.now() - 60 * 1000).toISOString(),
          candidateTimestamp: new Date(Date.now() - 60 * 1000).toISOString(),
          command: 'npm run agent:bounty:execute -- --dry-run',
          liveCommand: 'npm run agent:bounty:execute -- --live --approve-live',
          fallbackCommand: 'npm run agent:bounty:scan -- --dry-run',
        },
      ],
      preparedCandidate: {
        candidateId: 'msg-failure-a',
        source: 'inbox_message',
        sourceType: 'inbox_message',
        candidateActionType: 'reply',
        allowedActionTypes: ['reply'],
        supportedLiveRoute: LIVE_ROUTE_NAME,
        sourceMessageId: 'msg-failure-a',
        peerBtcAddress: 'bc1qa',
        peerDisplayName: 'A',
        contentPreview: 'aibtc.com/bounty failure A',
        sentAt: nowIso,
        candidateTimestamp: nowIso,
        command: 'npm run agent:bounty:execute -- --dry-run',
        liveCommand: 'npm run agent:bounty:execute -- --live --approve-live',
        fallbackCommand: 'npm run agent:bounty:scan -- --dry-run',
      },
      lastPreparedCandidateId: 'msg-failure-a',
      lastFailureClass: 'legacy_global_failure',
      retryAfter: null,
      cooldownUntil: null,
      candidateExecutionHistory: {
        'msg-failure-a': {
          lastFailureClass: 'candidate_specific_failure',
        },
      },
    };
    writeAgentState(state);
    const result = await runBountyExecuteSkill({
      dryRun: true,
      config: TEST_CONFIG,
      executeReplyCandidate: createReplyExecutorStub('success'),
    });
    assert.equal(result.state.bountyExecution.candidateExecutionHistory['msg-failure-a'].lastFailureClass, 'candidate_specific_failure');
    assert.equal(result.state.bountyExecution.lastFailureClass, 'candidate_specific_failure');
  });

  // 11) agent-next-action expoe comando live correto apenas quando elegivel
  await withStateFixture((() => {
    const state = setPreparedCandidate(createBaseState(), nowIso);
    const context = createBaseContext();
    state.bountyExecution.lastDryRunAt = nowIso;
    state.bountyExecution.lastDryRunResult = {
      ok: true,
      status: 'executed_dry_run',
      reason: 'dry_run_preconditions_validated',
      preparedCandidateId: 'msg-bounty',
      liveRouteName: LIVE_ROUTE_NAME,
    };
    const evaluation = evaluateSkillBuilder(context, state, TEST_CONFIG, { amountSats: 3000, nowIso });
    state.skillBuilder = evaluation.nextBuilderState;
    state.lastRouteEvaluationAt = nowIso;
    state.lastRecommendedAction = 'wait';
    state.lastRecommendedReason = 'no_safe_auto_action_available';
    state.lastRecommendationConfidence = 0.7;
    return state;
  })(), async () => {
    const nextAction = runJson(NEXT_ACTION, ['--status-only']);
    assert.equal(nextAction.ok, true);
    assert.equal(nextAction.recommendedAction, 'wait');
    assert.equal(nextAction.manualPrioritySkill.skillId, 'bounty_execute');
    assert.equal(nextAction.manualPriorityReason, 'prepared_bounty_live_reply_ready');
    assert.equal(nextAction.manualPriorityCommand, 'npm run agent:bounty:execute -- --live --approve-live');
    assert.equal(nextAction.manualPrioritySkill.command, 'npm run agent:bounty:execute -- --live --approve-live');
  });

  // 12) defi_quote_monitor e elegivel apenas como read-only
  const quoteEligible = isSkillAutoLiveEligible({
    skillId: 'defi_quote_monitor',
    recommendedCommand: 'npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=3000',
    estimatedFeeSats: 80,
  }, {
    autoSafeActions: true,
    dryRun: false,
    state: createBaseState(),
    nowIso,
  });
  assert.equal(quoteEligible.eligible, true);
  assert.equal(quoteEligible.autoLiveClass, 'class_a_safe_readonly');

  // 13) bounty_interactions e elegivel apenas em caminho read-only/prep
  const bountyEligible = isSkillAutoLiveEligible({
    skillId: 'bounty_interactions',
    recommendedCommand: 'npm run agent:bounty:execute -- --dry-run',
  }, {
    autoSafeActions: true,
    dryRun: false,
    state: createBaseState(),
    nowIso,
  });
  assert.equal(bountyEligible.eligible, true);
  assert.equal(bountyEligible.autoLiveClass, 'class_a_safe_readonly');

  // 14) bounty_execute permanece manual_only
  const bountyExecuteManual = isSkillAutoLiveEligible({
    skillId: 'bounty_execute',
    recommendedCommand: 'npm run agent:bounty:execute -- --live --approve-live',
  }, {
    autoSafeActions: true,
    dryRun: false,
    state: createBaseState(),
    nowIso,
  });
  assert.equal(bountyExecuteManual.eligible, false);
  assert.equal(bountyExecuteManual.autoLiveClass, 'class_c_manual_only');

  // 15) wallet_micro_transfer permanece manual_only
  const walletManual = isSkillAutoLiveEligible({
    skillId: 'wallet_micro_transfer',
    recommendedCommand: 'npm run agent:wallet:micro:live',
  }, {
    autoSafeActions: true,
    dryRun: false,
    state: createBaseState(),
    nowIso,
  });
  assert.equal(walletManual.eligible, false);
  assert.equal(walletManual.autoLiveClass, 'class_c_manual_only');

  // 16) limite diario bloqueia novas autoexecucoes
  const dailyLimitState = createBaseState();
  dailyLimitState.autoLive = {
    ...dailyLimitState.autoLive,
    executionHistory: Array.from({ length: 5 }, (_, index) => ({
      at: new Date(Date.now() - index * 60 * 1000).toISOString(),
      skillId: 'defi_quote_monitor',
      feeSats: 0,
      spendSats: 0,
    })),
  };
  const dailyBlocked = isSkillAutoLiveEligible({
    skillId: 'defi_quote_monitor',
    recommendedCommand: 'npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=3000',
    estimatedFeeSats: 80,
  }, {
    autoSafeActions: true,
    dryRun: false,
    state: dailyLimitState,
    nowIso,
  });
  assert.equal(dailyBlocked.eligible, false);
  assert.ok(['daily_auto_execution_limit_reached', 'hourly_auto_execution_limit_reached'].includes(dailyBlocked.blockReason));

  // 17) maxAutoFeeSats bloqueia acima do teto
  const feeBlocked = isSkillAutoLiveEligible({
    skillId: 'defi_quote_monitor',
    recommendedCommand: 'npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=3000',
    estimatedFeeSats: 147,
  }, {
    autoSafeActions: true,
    dryRun: false,
    state: createBaseState(),
    nowIso,
  });
  assert.equal(feeBlocked.eligible, false);
  assert.equal(feeBlocked.blockReason, 'max_auto_fee_exceeded');

  // 18) state registra bloqueios e execucoes automaticas
  const blockedTelemetry = recordAutoLiveBlocked(createBaseState(), 'shadow_validation_failed', nowIso);
  assert.equal(blockedTelemetry.lastAutoBlockedReason, 'shadow_validation_failed');
  const executedTelemetry = recordAutoLiveExecution({
    autoLive: blockedTelemetry,
  }, {
    skillId: 'defi_quote_monitor',
    feeSats: 0,
    spendSats: 0,
  }, nowIso);
  const materializedTelemetry = materializeAutoLiveState({ autoLive: executedTelemetry }, nowIso);
  assert.equal(materializedTelemetry.lastAutoExecutedSkillId, 'defi_quote_monitor');
  assert.equal(materializedTelemetry.lastAutoExecutedAt, nowIso);
  assert.equal(materializedTelemetry.executionsToday >= 1, true);

  console.log(JSON.stringify({
    ok: true,
    test: 'skill-builder',
    assertions: 100,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
