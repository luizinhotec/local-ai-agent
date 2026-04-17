#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { __test } = require('./skill-messaging.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const RUN_SKILL = path.join(ROOT_DIR, 'runtime', 'speedy-indra', 'run-skill.cjs');

function buildConfig(overrides = {}) {
  return {
    featureFlags: {
      messaging: false,
      ...overrides.featureFlags,
    },
    messaging: {
      safeRepliesOnly: true,
      fullOutboundEnabled: false,
      maxRepliesPerCycle: 1,
      cooldownMin: 60,
      ...overrides.messaging,
    },
  };
}

function runCli(args, envOverrides = {}) {
  const stdout = execFileSync(process.execPath, [RUN_SKILL, ...args], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...envOverrides,
    },
    encoding: 'utf8',
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

function main() {
  const disabledPolicy = __test.resolveMessagingPolicy(buildConfig());
  assert.equal(disabledPolicy.enabled, false);
  assert.equal(disabledPolicy.policyMode, 'disabled');
  assert.equal(disabledPolicy.reason, 'feature_disabled');

  const safePolicy = __test.resolveMessagingPolicy(
    buildConfig({
      featureFlags: { messaging: true },
      messaging: { safeRepliesOnly: true, fullOutboundEnabled: false },
    })
  );
  assert.equal(safePolicy.enabled, true);
  assert.equal(safePolicy.valid, true);
  assert.equal(safePolicy.policyMode, 'safe_replies_only');
  assert.equal(safePolicy.outboundAllowed, false);

  const ambiguousPolicy = __test.resolveMessagingPolicy(
    buildConfig({
      featureFlags: { messaging: true },
      messaging: { safeRepliesOnly: false, fullOutboundEnabled: false },
    })
  );
  assert.equal(ambiguousPolicy.valid, false);
  assert.equal(ambiguousPolicy.reason, 'messaging_policy_ambiguous_fail_closed');

  const allowedCandidates = __test.selectReplyCandidates(
    {
      body: {
        inbox: {
          messages: [
            {
              messageId: 'msg-1',
              fromAddress: 'SP123',
              peerBtcAddress: 'bc1qallowed',
              peerDisplayName: 'Allowed Agent',
              content: 'ping',
              sentAt: '2026-03-21T00:00:00.000Z',
              paymentSatoshis: 100,
            },
          ],
          replies: {},
        },
      },
    },
    { lastReplyTargets: [] },
    buildConfig({
      featureFlags: { messaging: true },
      messaging: { safeRepliesOnly: true, fullOutboundEnabled: false, maxRepliesPerCycle: 1 },
    }),
    { maxRepliesPerCycle: 1 }
  );
  assert.equal(allowedCandidates.candidates.length, 1);
  assert.equal(allowedCandidates.skippedReason, null);

  const noEligibleCandidates = __test.selectReplyCandidates(
    {
      body: {
        inbox: {
          messages: [
            {
              messageId: 'msg-2',
              fromAddress: 'SP234',
              peerBtcAddress: 'bc1qblocked',
              peerDisplayName: 'Blocked Agent',
              content: 'hello',
              sentAt: '2026-03-21T00:00:00.000Z',
              paymentSatoshis: 100,
              repliedAt: '2026-03-21T01:00:00.000Z',
            },
          ],
          replies: {
            'msg-2': {
              messageId: 'msg-2',
            },
          },
        },
      },
    },
    { lastReplyTargets: [] },
    buildConfig({
      featureFlags: { messaging: true },
      messaging: { safeRepliesOnly: true, fullOutboundEnabled: false, maxRepliesPerCycle: 1 },
    }),
    { maxRepliesPerCycle: 1 }
  );
  assert.equal(noEligibleCandidates.candidates.length, 0);
  assert.equal(noEligibleCandidates.skippedReason, 'no_reply_candidate');

  const disabledCli = runCli(
    ['messaging', '--live', '--reply-pending', '--max-replies-per-cycle=1'],
    {
      ENABLE_MESSAGING: 'false',
      ENABLE_MESSAGING_SAFE_REPLIES_ONLY: 'true',
      ENABLE_MESSAGING_FULL_OUTBOUND: 'false',
    }
  );
  assert.equal(disabledCli.skipped, true);
  assert.equal(disabledCli.reason, 'feature_disabled');

  const safeBlockedOutboundCli = runCli(
    ['messaging', '--dry-run', '--enqueue-target=bc1qqaxq5vxszt0lzmr9gskv4lcx7jzrg772s4vxpp', '--content=blocked outbound test'],
    {
      ENABLE_MESSAGING: 'true',
      ENABLE_MESSAGING_SAFE_REPLIES_ONLY: 'true',
      ENABLE_MESSAGING_FULL_OUTBOUND: 'false',
    }
  );
  assert.equal(safeBlockedOutboundCli.ok, true);
  assert.equal(safeBlockedOutboundCli.policyMode, 'safe_replies_only');
  assert.equal(safeBlockedOutboundCli.queueResults.length, 0);
  assert.equal(safeBlockedOutboundCli.state.skills.messaging.lastSkipReason, 'safe_replies_only_outbound_blocked');
  assert.equal(safeBlockedOutboundCli.state.skills.messaging.lastActionType, 'outbound');

  console.log(
    JSON.stringify(
      {
        ok: true,
        test: 'messaging-safe-mode',
        assertions: 7,
      },
      null,
      2
    )
  );
}

main();
