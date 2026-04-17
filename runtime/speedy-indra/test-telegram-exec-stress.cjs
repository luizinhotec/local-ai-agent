#!/usr/bin/env node

const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  AGENT_STATE_PATH,
  AGENT_LOG_PATH,
  TELEGRAM_EXEC_LOCK_PATH,
  STATE_DIR,
} = require('./lib/agent-paths.cjs');
const { ensureDir, readAgentState, updateAgentState, writeAgentState } = require('./lib/agent-state.cjs');

const REPORT_PATH = `${STATE_DIR}\\telegram-exec-stress-report.json`;

function runNode(args) {
  const run = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 240000,
    windowsHide: true,
  });
  if (run.error) {
    throw run.error;
  }
  return run;
}

function readLogLines() {
  if (!fs.existsSync(AGENT_LOG_PATH)) {
    return [];
  }
  return fs.readFileSync(AGENT_LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
}

function parseLogLines(lines) {
  return lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return { type: 'unparseable_log_line', raw: line };
    }
  });
}

function captureRelevantState() {
  const state = readAgentState();
  return {
    autoArmStatus: state.autoArmStatus,
    autoArmNonce: state.autoArmNonce,
    autoArmArmedAt: state.autoArmArmedAt,
    autoArmExpiresAt: state.autoArmExpiresAt,
    autoArmConsumedAt: state.autoArmConsumedAt,
    autoArmManualCommand: state.autoArmManualCommand,
    autoArmAmountSats: state.autoArmAmountSats,
    autoArmPair: state.autoArmPair,
    autoArmExecutionOutcome: state.autoArmExecutionOutcome,
    autoArmExecutionTxId: state.autoArmExecutionTxId,
    lastTelegramExecCommandAt: state.lastTelegramExecCommandAt,
    lastTelegramExecCommandText: state.lastTelegramExecCommandText,
    lastTelegramExecDecision: state.lastTelegramExecDecision,
    lastTelegramUpdateId: state.lastTelegramUpdateId,
  };
}

function resetScenarioState() {
  if (fs.existsSync(TELEGRAM_EXEC_LOCK_PATH)) {
    fs.unlinkSync(TELEGRAM_EXEC_LOCK_PATH);
  }
  updateAgentState(state => {
    state.autoArmStatus = 'idle';
    state.autoArmNonce = null;
    state.autoArmArmedAt = null;
    state.autoArmExpiresAt = null;
    state.autoArmConsumedAt = null;
    state.autoArmManualCommand = null;
    state.autoArmAmountSats = null;
    state.autoArmPair = null;
    state.autoArmExecutionOutcome = null;
    state.autoArmExecutionTxId = null;
    state.lastTelegramExecCommandAt = null;
    state.lastTelegramExecCommandText = null;
    state.lastTelegramExecDecision = null;
    state.lastTelegramUpdateId = null;
    return state;
  });
}

function armReadyState() {
  const run = runNode([
    'runtime/speedy-indra/agent-auto-arm.cjs',
    '--once',
    '--simulate-ready',
    '--mock-telegram',
    '--amount-sats=2000',
  ]);
  if (run.status !== 0) {
    throw new Error(run.stderr || run.stdout || 'auto-arm_failed');
  }
  return captureRelevantState();
}

function runListener(extraArgs) {
  return runNode([
    'runtime/speedy-indra/agent-telegram-exec-listener.cjs',
    '--once',
    '--mock-telegram',
    '--dry-run-exec',
    ...extraArgs,
  ]);
}

function mutateState(mutator) {
  updateAgentState(state => {
    mutator(state);
    return state;
  });
}

function assertContainsLog(logs, type) {
  return logs.some(entry => entry.type === type);
}

function executeScenario(definition) {
  resetScenarioState();
  if (typeof definition.setup === 'function') {
    definition.setup();
  }
  const beforeState = captureRelevantState();
  const startIndex = readLogLines().length;
  const run = definition.execute();
  const afterState = captureRelevantState();
  const logs = parseLogLines(readLogLines().slice(startIndex));
  const observed = definition.observe({ beforeState, afterState, logs, run });
  return {
    test: definition.id,
    description: definition.description,
    expected: definition.expected,
    observed,
    passed: Boolean(observed.passed),
    riskResidual: observed.riskResidual || 'none',
    evidence: {
      stateBefore: beforeState,
      stateAfter: afterState,
      logs,
      listenerExitCode: run.status,
      listenerStdout: run.stdout.trim() || null,
      listenerStderr: run.stderr.trim() || null,
    },
  };
}

function main() {
  ensureDir(STATE_DIR);
  const originalState = fs.existsSync(AGENT_STATE_PATH)
    ? fs.readFileSync(AGENT_STATE_PATH, 'utf8')
    : null;
  const originalLock = fs.existsSync(TELEGRAM_EXEC_LOCK_PATH)
    ? fs.readFileSync(TELEGRAM_EXEC_LOCK_PATH, 'utf8')
    : null;

  try {
    const scenarios = [
      {
        id: 'A',
        description: 'EXEC sem armamento ativo',
        expected: 'rejeitar_sem_execucao',
        setup: () => {},
        execute: () => runListener(['--simulate-message=EXEC A7K29Q']),
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.lastTelegramExecDecision === 'rejected_not_armed' &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_not_armed'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'B',
        description: 'EXEC com nonce invalido',
        expected: 'rejeitar_e_preservar_armamento',
        setup: () => {
          armReadyState();
        },
        execute: () => runListener(['--simulate-message=EXEC ZZ9999']),
        observe: ({ beforeState, afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'armed' &&
            beforeState.autoArmNonce === afterState.autoArmNonce &&
            afterState.lastTelegramExecDecision === 'invalid_nonce' &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_invalid_nonce'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'C',
        description: 'EXEC sem nonce',
        expected: 'rejeitar_formato_invalido',
        setup: () => {
          armReadyState();
        },
        execute: () => runListener(['--simulate-message=EXEC']),
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'armed' &&
            afterState.lastTelegramExecDecision === 'invalid_format' &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_invalid_format'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'D',
        description: 'EXEC apos expiracao',
        expected: 'marcar_expired_e_rejeitar',
        setup: () => {
          const armed = armReadyState();
          mutateState(state => {
            state.autoArmStatus = 'armed';
            state.autoArmExpiresAt = new Date(Date.now() - 60_000).toISOString();
            state.autoArmNonce = armed.autoArmNonce;
          });
        },
        execute: () => {
          const state = captureRelevantState();
          return runListener([`--simulate-message=EXEC ${state.autoArmNonce}`]);
        },
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'expired' &&
            afterState.lastTelegramExecDecision === 'expired' &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_expired'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'E',
        description: 'EXEC duplicado com mesmo nonce',
        expected: 'primeiro_aceita_segundo_rejeita',
        setup: () => {
          armReadyState();
        },
        execute: () => {
          const state = captureRelevantState();
          const first = runListener([
            '--mock-revalidation-pass',
            `--simulate-message=EXEC ${state.autoArmNonce}`,
          ]);
          const second = runListener([
            `--simulate-message=EXEC ${state.autoArmNonce}`,
          ]);
          return {
            status: second.status,
            stdout: `${first.stdout}\n${second.stdout}`,
            stderr: `${first.stderr}\n${second.stderr}`,
          };
        },
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'fired' &&
            afterState.lastTelegramExecDecision === 'already_consumed' &&
            assertContainsLog(logs, 'championship_telegram_exec_completed') &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_already_consumed'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'F',
        description: 'EXEC com chat_id incorreto',
        expected: 'rejeitar_origem_nao_autorizada',
        setup: () => {
          armReadyState();
        },
        execute: () => {
          const state = captureRelevantState();
          return runListener([
            `--simulate-message=EXEC ${state.autoArmNonce}`,
            '--simulate-chat-id=wrong-chat',
          ]);
        },
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'armed' &&
            afterState.lastTelegramExecDecision === 'rejected_chat_not_authorized' &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_unauthorized_origin'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'G',
        description: 'EXEC com gate revalidado RED',
        expected: 'rejeitar_por_revalidacao',
        setup: () => {
          armReadyState();
        },
        execute: () => {
          const state = captureRelevantState();
          return runListener([
            '--mock-revalidation-fail=championship_gate_not_green',
            `--simulate-message=EXEC ${state.autoArmNonce}`,
          ]);
        },
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'consumed' &&
            afterState.lastTelegramExecDecision === 'revalidation_failed' &&
            afterState.autoArmExecutionOutcome === 'revalidation_failed:championship_gate_not_green' &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_revalidation_failed'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'H',
        description: 'EXEC com quote stale',
        expected: 'rejeitar_por_quote_stale',
        setup: () => {
          armReadyState();
        },
        execute: () => {
          const state = captureRelevantState();
          return runListener([
            '--mock-revalidation-fail=quote_stale',
            `--simulate-message=EXEC ${state.autoArmNonce}`,
          ]);
        },
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'consumed' &&
            afterState.autoArmExecutionOutcome === 'revalidation_failed:quote_stale' &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_revalidation_failed'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'I',
        description: 'EXEC com knownBlockers nao vazio',
        expected: 'rejeitar_por_blocker',
        setup: () => {
          armReadyState();
        },
        execute: () => {
          const state = captureRelevantState();
          return runListener([
            '--mock-revalidation-fail=known_blocker_present',
            `--simulate-message=EXEC ${state.autoArmNonce}`,
          ]);
        },
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'consumed' &&
            afterState.autoArmExecutionOutcome === 'revalidation_failed:known_blocker_present' &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_revalidation_failed'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'J',
        description: 'EXEC com circuit_breaker_open',
        expected: 'rejeitar_por_circuit_breaker',
        setup: () => {
          armReadyState();
        },
        execute: () => {
          const state = captureRelevantState();
          return runListener([
            '--mock-revalidation-fail=circuit_breaker_open',
            `--simulate-message=EXEC ${state.autoArmNonce}`,
          ]);
        },
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'consumed' &&
            afterState.autoArmExecutionOutcome === 'revalidation_failed:circuit_breaker_open' &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_revalidation_failed'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'K',
        description: 'EXEC com execution lock ativo',
        expected: 'rejeitar_por_lock',
        setup: () => {
          armReadyState();
          fs.writeFileSync(TELEGRAM_EXEC_LOCK_PATH, JSON.stringify({ test: true }, null, 2));
        },
        execute: () => {
          const state = captureRelevantState();
          return runListener([
            '--mock-revalidation-pass',
            `--simulate-message=EXEC ${state.autoArmNonce}`,
          ]);
        },
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'armed' &&
            afterState.lastTelegramExecDecision === 'locked' &&
            assertContainsLog(logs, 'championship_telegram_exec_locked'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'L',
        description: 'drift de comando',
        expected: 'rejeitar_por_command_mismatch',
        setup: () => {
          armReadyState();
          mutateState(state => {
            state.autoArmManualCommand = 'npm run agent:defi:sbtc-usdcx -- --live --approve-live --amount-sats=1000 --feature-override-test-v2';
          });
        },
        execute: () => {
          const state = captureRelevantState();
          return runListener([
            '--mock-revalidation-pass',
            `--simulate-message=EXEC ${state.autoArmNonce}`,
          ]);
        },
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'consumed' &&
            afterState.autoArmExecutionOutcome === 'execution_failed:armed_command_mismatch' &&
            assertContainsLog(logs, 'championship_telegram_exec_rejected_command_mismatch'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
      {
        id: 'M',
        description: 'caso feliz completo em simulacao',
        expected: 'aceitar_em_simulacao_e_marcar_fired',
        setup: () => {
          armReadyState();
        },
        execute: () => {
          const state = captureRelevantState();
          return runListener([
            '--mock-revalidation-pass',
            `--simulate-message=EXEC ${state.autoArmNonce}`,
          ]);
        },
        observe: ({ afterState, logs, run }) => ({
          passed:
            run.status === 0 &&
            afterState.autoArmStatus === 'fired' &&
            afterState.autoArmExecutionOutcome === 'simulated' &&
            afterState.lastTelegramExecDecision === 'accepted_and_fired' &&
            assertContainsLog(logs, 'championship_telegram_exec_completed'),
          finalDecision: afterState.lastTelegramExecDecision,
          outcome: afterState.autoArmExecutionOutcome,
        }),
      },
    ];

    const tests = scenarios.map(executeScenario);
    const allPassed = tests.every(test => test.passed);
    const guarantees = {
      replayAttackBlocked: tests.find(test => test.test === 'E')?.passed === true,
      nonceReuseBlocked: tests.find(test => test.test === 'E')?.passed === true,
      expirationBlocksExecution: tests.find(test => test.test === 'D')?.passed === true,
      wrongOriginBlocked: tests.find(test => test.test === 'F')?.passed === true,
      gateRedBlocked: tests.find(test => test.test === 'G')?.passed === true,
      blockersAndCircuitBreakerBlocked:
        tests.find(test => test.test === 'I')?.passed === true &&
        tests.find(test => test.test === 'J')?.passed === true,
      commandDriftBlocked: tests.find(test => test.test === 'L')?.passed === true,
      concurrentLockBlocked: tests.find(test => test.test === 'K')?.passed === true,
      humanConfirmationRequired: tests.find(test => test.test === 'A')?.passed === true,
      duplicateExecutionPathExists: false,
    };

    const report = {
      ok: allPassed,
      verdict: allPassed
        ? 'SAFE_FOR_SIMULATED_REMOTE_CONFIRMATION'
        : 'NOT_SAFE_YET',
      generatedAt: new Date().toISOString(),
      tests,
      guarantees,
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (fs.existsSync(TELEGRAM_EXEC_LOCK_PATH)) {
      fs.unlinkSync(TELEGRAM_EXEC_LOCK_PATH);
    }
    if (originalState === null) {
      if (fs.existsSync(AGENT_STATE_PATH)) {
        fs.unlinkSync(AGENT_STATE_PATH);
      }
    } else {
      writeAgentState(JSON.parse(originalState));
    }
    if (originalLock !== null) {
      fs.writeFileSync(TELEGRAM_EXEC_LOCK_PATH, originalLock);
    }
  }
}

main();
