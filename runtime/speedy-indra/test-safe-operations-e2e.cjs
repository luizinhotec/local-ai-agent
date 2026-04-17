#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const NEXT_ACTION = path.join(ROOT_DIR, 'runtime', 'speedy-indra', 'agent-next-action.cjs');
const STANDARD_LOOP = path.join(ROOT_DIR, 'runtime', 'speedy-indra', 'agent-standard-loop.cjs');
const SAFE_AUDIT = path.join(ROOT_DIR, 'runtime', 'speedy-indra', 'agent-safe-audit.cjs');

function runNode(script, args = [], envOverrides = {}) {
  const stdout = execFileSync(process.execPath, [script, ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ENABLE_MESSAGING: 'true',
      ENABLE_MESSAGING_SAFE_REPLIES_ONLY: 'true',
      ENABLE_MESSAGING_FULL_OUTBOUND: 'false',
      ...envOverrides,
    },
    encoding: 'utf8',
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

function main() {
  const nextAction = runNode(NEXT_ACTION, ['--dry-run', '--amount-sats=3000', '--force']);
  assert.equal(nextAction.ok, true);
  assert.ok(['messaging_only', 'quote_only', 'defi_swap_execute', 'wait'].includes(nextAction.recommendedAction));
  assert.equal(typeof nextAction.autoExecutableByStandardLoop, 'boolean');
  assert.equal(typeof nextAction.autoExecutionBlockReason, 'string');

  const loopDryRun = runNode(STANDARD_LOOP, ['--once', '--dry-run', '--amount-sats=3000']);
  assert.equal(loopDryRun.ok, true);
  assert.equal(loopDryRun.actionExecuted, false);
  assert.equal(loopDryRun.actionReason, 'dry_run_loop');

  const safeAudit = runNode(SAFE_AUDIT);
  assert.equal(safeAudit.ok, true);
  assert.equal(safeAudit.flags.enableMessaging, true);
  assert.equal(safeAudit.flags.safeRepliesOnly, true);
  assert.equal(safeAudit.flags.fullOutboundEnabled, false);
  assert.equal(safeAudit.messaging.policyMode, 'safe_replies_only');

  console.log(JSON.stringify({
    ok: true,
    test: 'safe-operations-e2e',
    assertions: 9,
  }, null, 2));
}

main();
