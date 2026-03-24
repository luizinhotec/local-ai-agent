const assert = require('assert');
const { evaluateBlsmScenario, buildBaseSnapshot } = require('./lib/blsm-engine.cjs');

function buildFixture(overrides = {}) {
  return {
    nowIso: '2026-03-23T00:00:00.000Z',
    poolId: 'SM1FK.pool',
    walletAddress: 'SP123',
    strategyShape: 'spot',
    marketState: 'VOLATILE',
    currentPrice: 70437,
    referencePrice: 73558.031964,
    exposureUsd: 23.282979,
    position: {
      expectedBinId: '103',
      maxDeviation: '2',
      xAmount: '19021',
      yAmount: '9890354',
    },
    poolMetadata: {
      signedActiveBinId: '103',
    },
    gas: {
      swap: { usdNow: 0.097058 },
      lpAdd: { usdNow: 0.01224 },
      close: { usdNow: null },
    },
    poolSnapshot: {
      active_bin: 108,
    },
    ...overrides,
  };
}

function main() {
  const cappedSnapshot = buildBaseSnapshot(
    buildFixture({
      position: {
        expectedBinId: '103',
        maxDeviation: '999',
        xAmount: '19021',
        yAmount: '9890354',
      },
    })
  );
  assert.equal(cappedSnapshot.maxDeviation, 50);
  assert.equal(cappedSnapshot.maxBinsPerSide, 50);
  assert.equal(cappedSnapshot.maxTotalBins, 100);
  assert.equal(cappedSnapshot.rangeLowerBinId, 53);
  assert.equal(cappedSnapshot.rangeUpperBinId, 153);

  const status = evaluateBlsmScenario(buildFixture(), { mode: 'status-only' });
  assert.equal(status.mode, 'status-only');
  assert.equal(status.status.pool_id, 'SM1FK.pool');
  assert.ok(['HOLD', 'WATCH', 'RECENTER', 'BLOCK'].includes(status.status.recommended_action));
  assert.equal(status.currentEvaluation.max_bins_per_side, 50);
  assert.equal(status.currentEvaluation.max_total_bins, 100);

  const dryRun = evaluateBlsmScenario(buildFixture(), { mode: 'dry-run', strategyShape: 'curve' });
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.dryRun.simulated_shape, 'curve');
  assert.equal(typeof dryRun.dryRun.should_execute, 'boolean');

  const comparison = evaluateBlsmScenario(buildFixture(), { mode: 'compare-shapes' });
  assert.equal(comparison.mode, 'compare-shapes');
  assert.equal(comparison.comparison.results.length, 3);
  assert.ok(['spot', 'curve', 'bid_ask'].includes(comparison.comparison.best_shape_by_net_return));

  console.log(JSON.stringify({ ok: true, tested: ['status-only', 'dry-run', 'compare-shapes'] }, null, 2));
}

main();
