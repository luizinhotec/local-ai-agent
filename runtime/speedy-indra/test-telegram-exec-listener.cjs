#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { readAgentState, updateAgentState } = require('./lib/agent-state.cjs');

function runNode(args) {
  const run = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  });
  if (run.error) {
    throw run.error;
  }
  return run;
}

function resetAutoArmState() {
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
    return state;
  });
}

function main() {
  resetAutoArmState();

  const armRun = runNode([
    'runtime/speedy-indra/agent-auto-arm.cjs',
    '--once',
    '--simulate-ready',
    '--mock-telegram',
    '--amount-sats=2000',
  ]);

  if (armRun.status !== 0) {
    throw new Error(`auto-arm test failed: ${armRun.stderr || armRun.stdout}`);
  }

  const armedState = readAgentState();
  if (armedState.autoArmStatus !== 'armed' || !armedState.autoArmNonce) {
    throw new Error('auto-arm did not persist armed state');
  }

  const invalidRun = runNode([
    'runtime/speedy-indra/agent-telegram-exec-listener.cjs',
    '--once',
    '--mock-telegram',
    '--dry-run-exec',
    '--simulate-message=EXEC WRONG1',
  ]);
  if (invalidRun.status !== 0) {
    throw new Error(`invalid nonce test failed: ${invalidRun.stderr || invalidRun.stdout}`);
  }

  const afterInvalid = readAgentState();
  if (afterInvalid.lastTelegramExecDecision !== 'invalid_nonce') {
    throw new Error(`expected invalid_nonce decision, got ${afterInvalid.lastTelegramExecDecision}`);
  }

  const validRun = runNode([
    'runtime/speedy-indra/agent-telegram-exec-listener.cjs',
    '--once',
    '--mock-telegram',
    '--dry-run-exec',
    '--mock-revalidation-pass',
    `--simulate-message=EXEC ${armedState.autoArmNonce}`,
  ]);
  if (validRun.status !== 0) {
    throw new Error(`valid exec test failed: ${validRun.stderr || validRun.stdout}`);
  }

  const firedState = readAgentState();
  if (firedState.autoArmStatus !== 'fired') {
    throw new Error(`expected fired state, got ${firedState.autoArmStatus}`);
  }

  const replayRun = runNode([
    'runtime/speedy-indra/agent-telegram-exec-listener.cjs',
    '--once',
    '--mock-telegram',
    '--dry-run-exec',
    `--simulate-message=EXEC ${armedState.autoArmNonce}`,
  ]);
  if (replayRun.status !== 0) {
    throw new Error(`replay test failed: ${replayRun.stderr || replayRun.stdout}`);
  }

  const replayState = readAgentState();
  if (replayState.lastTelegramExecDecision !== 'already_consumed') {
    throw new Error(`expected already_consumed decision, got ${replayState.lastTelegramExecDecision}`);
  }

  console.log(JSON.stringify({
    ok: true,
    armedNonce: armedState.autoArmNonce,
    finalStatus: firedState.autoArmStatus,
    executionOutcome: firedState.autoArmExecutionOutcome,
    replayDecision: replayState.lastTelegramExecDecision,
  }, null, 2));
}

main();
