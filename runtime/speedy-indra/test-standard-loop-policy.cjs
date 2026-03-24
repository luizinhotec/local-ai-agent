#!/usr/bin/env node

const assert = require('assert');
const { __test } = require('./lib/execution-policy.cjs');

function main() {
  const messagingAllowed = __test.getPolicyDecision(
    {
      autoLiveSkillId: 'messaging_safe_replies',
      recommendedAction: 'messaging_only',
      recommendedCommand: 'npm run agent:messages -- --live --reply-pending --max-replies-per-cycle=1',
      safetyLevel: 'safe_live_reply',
      approvalRequired: false,
      fallbackCommand: 'npm run agent:messages -- --status-only',
    },
    {
      autoSafeActions: true,
      dryRun: false,
    }
  );
  assert.equal(messagingAllowed.authorized, true);
  assert.equal(messagingAllowed.commandToExecute, 'npm run agent:messages -- --status-only');
  assert.equal(messagingAllowed.autoLiveClass, 'class_b_prepare_only');

  const quoteAllowed = __test.getPolicyDecision(
    {
      autoLiveSkillId: 'defi_quote_monitor',
      recommendedAction: 'quote_only',
      recommendedCommand: 'npm run agent:defi:dryrun -- --pair=sbtc-usdcx --amount-sats=3000',
      safetyLevel: 'safe_read_only',
      approvalRequired: false,
      estimatedFeeSats: 80,
    },
    {
      autoSafeActions: true,
      dryRun: false,
    }
  );
  assert.equal(quoteAllowed.authorized, true);

  const defiBlocked = __test.getPolicyDecision(
    {
      autoLiveSkillId: 'defi_swap_execute',
      recommendedAction: 'defi_swap_execute',
      recommendedCommand: 'npm run agent:defi:sbtc-usdcx -- --live --approve-live --amount-sats=3000',
      safetyLevel: 'approval_required',
      approvalRequired: true,
    },
    {
      autoSafeActions: true,
      dryRun: false,
    }
  );
  assert.equal(defiBlocked.authorized, false);
  assert.ok(['dangerous_command_blocked', 'approval_required', 'defi_swap_execute_never_auto_executed'].includes(defiBlocked.blockReason));

  const unknownBlocked = __test.getPolicyDecision(
    {
      autoLiveSkillId: 'unknown_skill',
      recommendedAction: 'mystery_action',
      recommendedCommand: 'npm run agent:status',
      safetyLevel: 'safe_read_only',
      approvalRequired: false,
    },
    {
      autoSafeActions: true,
      dryRun: false,
    }
  );
  assert.equal(unknownBlocked.authorized, false);
  assert.equal(unknownBlocked.blockReason, 'unknown_recommended_action');

  const dangerousBlocked = __test.getPolicyDecision(
    {
      autoLiveSkillId: 'defi_quote_monitor',
      recommendedAction: 'messaging_only',
      recommendedCommand: 'npm run agent:defi:sbtc-usdcx -- --live --approve-live --amount-sats=3000',
      safetyLevel: 'safe_live_reply',
      approvalRequired: false,
      fallbackCommand: 'npm run agent:messages -- --status-only',
    },
    {
      autoSafeActions: true,
      dryRun: false,
    }
  );
  assert.equal(dangerousBlocked.authorized, false);
  assert.ok(['dangerous_command_blocked', 'no_safe_shadow_command_available'].includes(dangerousBlocked.blockReason));

  const nonAllowlistedBlocked = __test.getPolicyDecision(
    {
      autoLiveSkillId: 'defi_quote_monitor',
      recommendedAction: 'quote_only',
      recommendedCommand: 'npm run agent:defi:preview -- --pair=sbtc-usdcx --amount-sats=3000',
      safetyLevel: 'safe_read_only',
      approvalRequired: false,
    },
    {
      autoSafeActions: true,
      dryRun: false,
    }
  );
  assert.equal(nonAllowlistedBlocked.authorized, false);
  assert.ok(['command_not_allowlisted', 'no_safe_shadow_command_available'].includes(nonAllowlistedBlocked.blockReason));

  console.log(JSON.stringify({
    ok: true,
    test: 'standard-loop-policy',
    assertions: 6,
  }, null, 2));
}

main();
