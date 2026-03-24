#!/usr/bin/env node

const assert = require('assert');
const { DEFAULT_COMPETITIVE_POLICY, resolveCompetitivePolicy } = require('./lib/competitive-policy.cjs');

function main() {
  const defaultResolved = resolveCompetitivePolicy({
    routeEvaluator: {
      policyDefaults: DEFAULT_COMPETITIVE_POLICY,
      policyOverrides: {},
    },
  }, 'sbtc-usdcx');

  assert.equal(defaultResolved.source, 'default');
  assert.equal(defaultResolved.routeOverrideActive, false);
  assert.equal(defaultResolved.decision.minOutputRatio, 0.97);
  assert.equal(defaultResolved.decision.maxEstimatedFeeSats, 500);
  assert.equal(defaultResolved.decision.maxFeePerByte, 1000);
  assert.equal(defaultResolved.decision.maxRouteHops, 2);
  assert.equal(defaultResolved.watchGate.maxEstimatedFeeSats, 200);
  assert.equal(defaultResolved.championshipGate.maxEstimatedFeeSats, 300);

  const overrideResolved = resolveCompetitivePolicy({
    routeEvaluator: {
      policyDefaults: DEFAULT_COMPETITIVE_POLICY,
      policyOverrides: {
        'sbtc-usdcx': {
          decision: {
            minOutputRatio: 0.9665,
          },
          watchGate: {
            maxEstimatedFeeSats: 180,
          },
        },
      },
    },
  }, 'sbtc-usdcx');

  assert.equal(overrideResolved.source, 'route_override');
  assert.equal(overrideResolved.routeOverrideActive, true);
  assert.equal(overrideResolved.decision.minOutputRatio, 0.9665);
  assert.equal(overrideResolved.decision.maxEstimatedFeeSats, 500);
  assert.equal(overrideResolved.watchGate.maxEstimatedFeeSats, 180);
  assert.equal(overrideResolved.championshipGate.maxEstimatedFeeSats, 300);

  console.log(JSON.stringify({
    ok: true,
    test: 'competitive-policy',
    assertions: 13,
  }, null, 2));
}

main();
