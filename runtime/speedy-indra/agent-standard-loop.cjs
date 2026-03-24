#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const { acquireLock } = require('./lib/agent-lock.cjs');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { readAgentState, updateAgentState, writeAgentStatus, writeWatchdog } = require('./lib/agent-state.cjs');
const { recordAutoLiveBlocked, recordAutoLiveExecution } = require('./lib/auto-live-policy.cjs');
const { sleep } = require('./lib/agent-runtime.cjs');
const { getPolicyDecision, sanitizeValue } = require('./lib/execution-policy.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const NEXT_ACTION_SCRIPT = path.join(ROOT_DIR, 'runtime', 'speedy-indra', 'agent-next-action.cjs');
const STANDARD_LOOP_LOCK_PATH = path.join(ROOT_DIR, 'state', 'speedy-indra', 'agent-standard-loop.lock');
const COMMAND_TIMEOUT_MS = 120000;

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseArgs(argv) {
  const parsed = {
    once: argv.includes('--once'),
    intervalSeconds: 60,
    amountSats: 3000,
    autoSafeActions: true,
    dryRun: argv.includes('--dry-run'),
  };

  for (const arg of argv) {
    if (!arg.startsWith('--') || arg === '--once' || arg === '--dry-run') {
      continue;
    }
    const [key, ...rest] = arg.slice(2).split('=');
    const value = rest.join('=');
    if (key === 'interval-seconds') parsed.intervalSeconds = Number(value || 60);
    if (key === 'amount-sats') parsed.amountSats = Number(value || 3000);
    if (key === 'auto-safe-actions') parsed.autoSafeActions = parseBoolean(value, true);
  }

  return parsed;
}

function runCommand(commandLine, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(commandLine, {
      cwd: ROOT_DIR,
      shell: true,
      windowsHide: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        child.kill();
      }
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('close', code => {
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut: false,
      });
    });

    child.on('error', error => {
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut: false,
        error: error.message,
      });
    });

    timer.unref?.();
  });
}

function tryParseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function tryParseEmbeddedJson(stdout) {
  if (!stdout) return null;
  const firstBrace = stdout.indexOf('{');
  if (firstBrace < 0) return null;
  try {
    return JSON.parse(stdout.slice(firstBrace));
  } catch {
    return null;
  }
}

async function runOneCycle(options) {
  const cycleStartedAt = new Date().toISOString();
  appendJsonLog('standard_loop_cycle_started', {
    once: options.once,
    dryRun: options.dryRun,
    autoSafeActions: options.autoSafeActions,
    amountSats: options.amountSats,
  });

  const nextActionCommand = `"${process.execPath}" "${NEXT_ACTION_SCRIPT}" --dry-run --amount-sats=${options.amountSats} --force`;
  const decisionRun = await runCommand(nextActionCommand, COMMAND_TIMEOUT_MS);
  const decisionJson = tryParseJson(decisionRun.stdout);

  if (!decisionRun.ok || !decisionJson?.ok) {
    const reason = decisionJson?.error || decisionRun.error || decisionRun.stderr || 'next_action_failed';
    appendJsonLog('standard_loop_action_skipped', {
      reason,
      stage: 'decision',
      stdout: decisionRun.stdout,
      stderr: decisionRun.stderr,
    });
    const failedState = updateAgentState(current => {
      current.lastStandardLoopRunAt = cycleStartedAt;
      current.lastStandardLoopAction = 'decision_failed';
      current.lastStandardLoopDecision = sanitizeValue({
        ok: false,
        reason,
      });
      current.standardLoopCycles += 1;
      return current;
    });
    writeWatchdog({
      status: 'failed',
      updatedAt: cycleStartedAt,
      error: reason,
      staleAfterSec: Math.max(120, options.intervalSeconds * 3),
    });
    appendJsonLog('standard_loop_cycle_completed', {
      ok: false,
      reason,
      actionExecuted: false,
    });
    return {
      ok: false,
      reason,
      decision: decisionJson,
      state: failedState,
    };
  }

  appendJsonLog('standard_loop_decision', sanitizeValue({
    recommendedAction: decisionJson.recommendedAction,
    recommendedCommand: decisionJson.recommendedCommand,
    safetyLevel: decisionJson.safetyLevel,
    estimatedCostClass: decisionJson.estimatedCostClass,
    approvalRequired: decisionJson.approvalRequired,
  }));

  const executionGate = getPolicyDecision(decisionJson, {
    ...options,
    state: readAgentState(),
    nowIso: cycleStartedAt,
  });
  let actionRun = null;
  let actionExecuted = false;
  let actionReason = executionGate.blockReason;
  let executedCommand = null;
  let shadowValidation = null;

  appendJsonLog('standard_loop_execution_policy', sanitizeValue({
    recommendedAction: decisionJson.recommendedAction,
    authorizedAction: executionGate.authorizedAction,
    proposedCommand: executionGate.proposedCommand,
    commandToExecute: executionGate.commandToExecute,
    approvalRequired: decisionJson.approvalRequired,
    authorized: executionGate.authorized,
    blockReason: executionGate.blockReason,
    policy: executionGate.policy,
    autoLiveEligible: executionGate.autoLiveEligible,
    autoLiveClass: executionGate.autoLiveClass,
    autoLivePolicyVersion: executionGate.autoLivePolicyVersion,
  }));

  if (executionGate.authorized) {
    executedCommand = executionGate.commandToExecute;
    if (!executedCommand) {
      actionReason = 'policy_authorized_without_command';
      appendJsonLog('standard_loop_action_skipped', {
        reason: actionReason,
        recommendedAction: decisionJson.recommendedAction,
        proposedCommand: executionGate.proposedCommand,
      });
    } else {
      shadowValidation = await runCommand(executionGate.shadowCommand || executedCommand, COMMAND_TIMEOUT_MS);
      const shadowPayload = tryParseEmbeddedJson(shadowValidation.stdout);
      const shadowOk = shadowValidation.ok && shadowPayload?.ok !== false;

      if (!shadowOk) {
        actionReason = 'shadow_validation_failed';
        appendJsonLog('standard_loop_action_skipped', sanitizeValue({
          reason: actionReason,
          recommendedAction: decisionJson.recommendedAction,
          authorizedAction: executionGate.authorizedAction,
          proposedCommand: executionGate.proposedCommand,
          shadowCommand: executionGate.shadowCommand,
          shadowPayload: sanitizeValue(shadowPayload),
          stdout: shadowValidation.stdout,
          stderr: shadowValidation.stderr,
        }));
      } else {
        actionRun = executionGate.executeAfterShadow
          ? await runCommand(executedCommand, COMMAND_TIMEOUT_MS)
          : shadowValidation;
        const actionPayload = tryParseEmbeddedJson(actionRun.stdout);
        actionExecuted =
          actionRun.ok &&
          !actionPayload?.skipped &&
          (actionPayload?.executed === undefined || Boolean(actionPayload.executed));
        actionReason = actionRun.ok
          ? actionPayload?.reason || (actionExecuted ? 'auto_safe_action_completed' : 'auto_safe_action_skipped')
          : 'auto_safe_action_failed';
        appendJsonLog('standard_loop_action_executed', sanitizeValue({
          recommendedAction: decisionJson.recommendedAction,
          authorizedAction: executionGate.authorizedAction,
          proposedCommand: executionGate.proposedCommand,
          executedCommand,
          shadowCommand: executionGate.shadowCommand,
          ok: actionRun.ok,
          code: actionRun.code,
          actionExecuted,
          actionReason,
          actionPayload: sanitizeValue(actionPayload),
          stdout: actionRun.stdout,
          stderr: actionRun.stderr,
        }));
      }
    }
  } else {
    appendJsonLog('standard_loop_action_skipped', {
      reason: executionGate.blockReason,
      recommendedAction: decisionJson.recommendedAction,
      authorizedAction: executionGate.authorizedAction,
      proposedCommand: executionGate.proposedCommand,
      executedCommand: null,
      safetyLevel: decisionJson.safetyLevel,
    });
  }

  const finalState = updateAgentState(current => {
    current.autoLive = actionExecuted
      ? recordAutoLiveExecution(current, {
          skillId: executionGate.autoLiveSkillId,
          feeSats: executionGate.estimatedFeeSats,
          spendSats: executionGate.estimatedSpendSats,
        }, cycleStartedAt)
      : recordAutoLiveBlocked(current, actionReason || executionGate.autoLiveBlockReason, cycleStartedAt);
    current.lastStandardLoopRunAt = cycleStartedAt;
    current.lastStandardLoopAction = actionExecuted ? decisionJson.recommendedAction : 'skipped';
    current.lastStandardLoopAuthorizedAction = executionGate.authorizedAction;
    current.lastStandardLoopProposedCommand = executionGate.proposedCommand;
    current.lastStandardLoopExecutedCommand = actionExecuted ? executedCommand : null;
    current.lastStandardLoopBlockReason = actionExecuted ? null : actionReason;
    current.lastStandardLoopDecision = sanitizeValue({
      recommendedAction: decisionJson.recommendedAction,
      authorizedAction: executionGate.authorizedAction,
      proposedCommand: executionGate.proposedCommand,
      executedCommand: actionExecuted ? executedCommand : null,
      safetyLevel: decisionJson.safetyLevel,
      estimatedCostClass: decisionJson.estimatedCostClass,
      approvalRequired: decisionJson.approvalRequired,
      autoLiveEligible: executionGate.autoLiveEligible,
      autoLiveClass: executionGate.autoLiveClass,
      autoLiveBlockReason: executionGate.autoLiveBlockReason,
      autoLivePolicyVersion: executionGate.autoLivePolicyVersion,
      actionExecuted,
      actionReason,
    });
    current.standardLoopCycles += 1;
    if (actionExecuted) {
      current.standardLoopAutoActionsCount += 1;
    }
    return current;
  });

  writeAgentStatus({
    checkedAt: new Date().toISOString(),
    standardLoop: {
      lastRunAt: finalState.lastStandardLoopRunAt,
      lastAction: finalState.lastStandardLoopAction,
      lastAuthorizedAction: finalState.lastStandardLoopAuthorizedAction,
      lastProposedCommand: finalState.lastStandardLoopProposedCommand,
      lastExecutedCommand: finalState.lastStandardLoopExecutedCommand,
      lastBlockReason: finalState.lastStandardLoopBlockReason,
      lastDecision: finalState.lastStandardLoopDecision,
      cycles: finalState.standardLoopCycles,
      autoActions: finalState.standardLoopAutoActionsCount,
      autoLive: finalState.autoLive,
    },
  });
  writeWatchdog({
    status: 'completed',
    updatedAt: new Date().toISOString(),
    staleAfterSec: Math.max(120, options.intervalSeconds * 3),
    action: finalState.lastStandardLoopAction,
  });
  appendJsonLog('standard_loop_cycle_completed', {
    ok: true,
    recommendedAction: decisionJson.recommendedAction,
    authorizedAction: executionGate.authorizedAction,
    actionExecuted,
    actionReason,
  });

  return {
    ok: true,
    decision: decisionJson,
    actionExecuted,
    actionReason,
    actionRun: sanitizeValue(actionRun),
    state: finalState,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lock = acquireLock({
    lockPath: STANDARD_LOOP_LOCK_PATH,
    staleAfterMs: Math.max(120, options.intervalSeconds * 3) * 1000,
    processName: 'speedy-indra-standard-loop',
  });

  appendJsonLog('standard_loop_started', {
    once: options.once,
    dryRun: options.dryRun,
    intervalSeconds: options.intervalSeconds,
    amountSats: options.amountSats,
    autoSafeActions: options.autoSafeActions,
    lockId: lock.metadata.lockId,
  });

  const releaseLock = () => {
    try {
      lock.release();
    } catch {
      // no-op
    }
  };

  process.on('SIGINT', () => {
    appendJsonLog('standard_loop_stopped', { signal: 'SIGINT' });
    releaseLock();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    appendJsonLog('standard_loop_stopped', { signal: 'SIGTERM' });
    releaseLock();
    process.exit(0);
  });

  try {
    do {
      const result = await runOneCycle(options);
      lock.refresh();
      if (options.once) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      await sleep(options.intervalSeconds * 1000);
    } while (true);
  } finally {
    appendJsonLog('standard_loop_exited', {
      once: options.once,
      lastAction: readAgentState().lastStandardLoopAction,
    });
    releaseLock();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
