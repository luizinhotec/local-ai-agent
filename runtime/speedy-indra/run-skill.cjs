#!/usr/bin/env node

const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { readAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');
const { runHeartbeatSkill } = require('./skills/skill-heartbeat.cjs');
const { runMessagingSkill } = require('./skill-messaging.cjs');
const { runIdentitySkill } = require('./skill-identity.cjs');
const { runBtcL1ToSbtcReadinessSkill } = require('./skill-btc-l1-to-sbtc-readiness.cjs');
const { runBtcL1ToUsdcRouterSkill } = require('./skill-btc-l1-to-usdc-router.cjs');
const { runBtcL1ToUsdcxRouterSkill } = require('./skill-btc-l1-to-usdcx-router.cjs');
const { runRouteEvaluatorSkill } = require('./skill-route-evaluator.cjs');
const { runWalletActionsSkill } = require('./skill-wallet-actions.cjs');
const { runDefiSimpleSkill } = require('./skill-defi-simple.cjs');
const { runBountyInteractionsSkill } = require('./skill-bounty-interactions.cjs');
const { runBountyExecuteSkill } = require('./skill-bounty-execute.cjs');
const { runBlsmSkill } = require('./skill-blsm.cjs');

function parseArgs(argv) {
  const positionals = [];
  const flags = {};

  for (const arg of argv) {
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (arg === '--live') {
      flags.dryRun = false;
      continue;
    }
    if (arg === '--force') {
      flags.force = true;
      continue;
    }
    if (arg === '--status-only') {
      flags.statusOnly = true;
      continue;
    }
    if (arg === '--approve-live') {
      flags.approveLive = true;
      continue;
    }
    if (arg === '--micro') {
      flags.micro = true;
      continue;
    }
    if (arg === '--reply-pending') {
      flags.replyPending = true;
      continue;
    }
    if (arg === '--pay-required') {
      flags.payRequired = true;
      continue;
    }
    if (arg === '--seed-allowlist') {
      flags.seedAllowlist = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      if (rest.length > 0) {
        flags[key] = rest.join('=');
        continue;
      }
    }
    positionals.push(arg);
  }

  return {
    skill: positionals[0] || 'heartbeat',
    flags,
  };
}

function notImplementedSkill(skill, config) {
  const state = readAgentState();
  const payload = {
    ok: true,
    skill,
    implemented: false,
    enabled:
      skill === 'messaging'
        ? config.featureFlags.messaging
        : skill === 'identity'
        ? config.featureFlags.identity
        : skill === 'wallet'
        ? config.featureFlags.walletActions
        : skill === 'defi'
        ? config.featureFlags.defiSimple
        : false,
    reason: 'scheduled_for_future_phase',
    state,
  };
  writeAgentStatus({
    checkedAt: new Date().toISOString(),
    placeholderSkill: payload,
  });
  return payload;
}

async function main() {
  const { skill, flags } = parseArgs(process.argv.slice(2));
  const config = loadAgentConfig();

  let result;
  if (skill === 'heartbeat') {
    result = await runHeartbeatSkill(flags);
  } else if (skill === 'messaging') {
    result = await runMessagingSkill(flags);
  } else if (skill === 'identity') {
    result = await runIdentitySkill(flags);
  } else if (skill === 'btc-l1-readiness') {
    result = await runBtcL1ToSbtcReadinessSkill(flags);
  } else if (skill === 'btc-l1-to-usdc') {
    result = await runBtcL1ToUsdcRouterSkill(flags);
  } else if (skill === 'btc-l1-to-usdcx') {
    result = await runBtcL1ToUsdcxRouterSkill(flags);
  } else if (skill === 'route-evaluator') {
    result = await runRouteEvaluatorSkill(flags);
  } else if (skill === 'wallet') {
    result = await runWalletActionsSkill(flags);
  } else if (skill === 'defi') {
    result = await runDefiSimpleSkill(flags);
  } else if (skill === 'bounty' || skill === 'bounty-interactions') {
    result = await runBountyInteractionsSkill(flags);
  } else if (skill === 'bounty-execute') {
    result = await runBountyExecuteSkill(flags);
  } else if (skill === 'blsm') {
    result = await runBlsmSkill(flags);
  } else {
    throw new Error(`unknown skill: ${skill}`);
  }

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
