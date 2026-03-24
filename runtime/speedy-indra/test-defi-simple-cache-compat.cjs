#!/usr/bin/env node

const assert = require('assert');
const { __test } = require('./skill-defi-simple.cjs');

function createCachedPlan(overrides = {}) {
  return {
    generatedAtUtc: '2026-03-22T20:47:00.000Z',
    wallet: {
      address: 'SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT',
    },
    inputToken: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token',
    outputToken: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx',
    amountIn: '650',
    quote: {
      amountOut: '443564',
      minAmountOut: '430257',
      routePath: [
        'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token',
        'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx',
      ],
      executionPath: [
        {
          expected_bin_id: 32,
          x_in: '650',
          y_out: '443564',
        },
      ],
      totalHops: 1,
      executionDetails: {
        fee_rate: '0.003',
        hop_details: [
          {
            price_impact_bps: -15,
          },
        ],
      },
    },
    profitDiagnostics: {
      networkFeeUsd: 0.084,
      inputTokenUsd: 68000,
      corePriceFeed: {
        btcUsd: 68000,
        stxUsd: 0.23,
      },
    },
    feeDiagnostics: {
      feeMicroStx: 320000,
      feePerByte: 490,
    },
    decision: 'SKIP',
    decisionReason: 'worst_case_profit_below_threshold',
    ...overrides,
  };
}

function createAssessment(cachedPlan, amountSats) {
  return __test.assessCachedPlanCompatibility(cachedPlan, {
    pair: 'sbtc-usdcx',
    amountSats,
    stxAddress: 'SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT',
    nowMs: Date.parse('2026-03-22T20:48:00.000Z'),
  });
}

function createPlan(quoteSummary, cachedPlan, blockers = []) {
  return __test.buildPlan(
    {
      defiSimple: {
        requireApprovalForLive: true,
        maxInputSats: 10000,
        maxSlippageBps: 300,
        maxFeeSats: 500,
      },
    },
    'sbtc-usdcx',
    650,
    {
      ok: true,
      wallet: {
        id: 'wallet-1',
        stxAddress: 'SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT',
      },
    },
    {
      sbtcSats: 10000,
      usdcxBaseUnits: 0,
      stxMicroStx: 1000000,
    },
    {
      ok: true,
      executorPasswordReady: true,
    },
    {
      ok: true,
    },
    quoteSummary,
    cachedPlan,
    blockers
  );
}

function main() {
  const incompatibleCache = createCachedPlan({
    amountIn: '13479',
    decision: 'INCONCLUSIVE',
    decisionReason: 'validation_failed',
    quote: {
      amountOut: '9177378',
      minAmountOut: '8902057',
      routePath: ['bad-route'],
      executionPath: [{ expected_bin_id: 31 }],
      totalHops: 1,
      executionDetails: {
        fee_rate: '0.003',
        hop_details: [{ price_impact_bps: -37 }],
      },
    },
    profitDiagnostics: {
      networkFeeUsd: 0.306,
      inputTokenUsd: 68000,
      corePriceFeed: {
        btcUsd: 68000,
        stxUsd: 0.23,
      },
    },
    feeDiagnostics: {
      feeMicroStx: 1052296,
      feePerByte: 1713.8371335504885,
    },
  });

  const liveRoute = {
    amount_out: '443564',
    min_amount_out: '430257',
    route_path: [
      'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token',
      'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx',
    ],
    execution_path: [
      {
        expected_bin_id: 32,
        x_in: '650',
        y_out: '443564',
      },
    ],
    total_hops: 1,
    execution_details: {
      fee_rate: '0.003',
      hop_details: [{ price_impact_bps: -15 }],
    },
  };

  const incompatibleAssessment = createAssessment(incompatibleCache, 650);
  assert.equal(incompatibleAssessment.compatible, false);
  assert.equal(incompatibleAssessment.rejectReason, 'amount_mismatch');

  const liveSummary = __test.buildQuoteSummary(
    liveRoute,
    { ok: true, status: 200 },
    incompatibleAssessment,
    650
  );
  assert.equal(liveSummary.quoteSource, 'bitflow_live_quote');
  assert.equal(liveSummary.amountOut, '443564');
  assert.equal(liveSummary.estimatedFeeSats, null);
  assert.equal(liveSummary.cacheCompatible, false);

  const livePlan = createPlan(liveSummary, incompatibleCache, ['estimated_fee_unavailable']);
  assert.equal(livePlan.cachedContext, null);
  assert.equal(livePlan.cacheStatus.compatible, false);
  assert.equal(livePlan.cacheStatus.rejectReason, 'amount_mismatch');

  const incompatibleFallbackSummary = __test.buildQuoteSummary(
    null,
    { ok: false, status: 502 },
    incompatibleAssessment,
    650
  );
  assert.equal(incompatibleFallbackSummary.quoteSource, 'bitflow_quote_unavailable');
  assert.equal(incompatibleFallbackSummary.amountOut, null);
  assert.equal(incompatibleFallbackSummary.minAmountOut, null);
  assert.equal(incompatibleFallbackSummary.executionPath.length, 0);
  assert.equal(incompatibleFallbackSummary.estimatedFeeSats, null);

  const compatibleCache = createCachedPlan();
  const compatibleAssessment = createAssessment(compatibleCache, 650);
  assert.equal(compatibleAssessment.compatible, true);

  const compatibleFallbackSummary = __test.buildQuoteSummary(
    null,
    { ok: false, status: 502 },
    compatibleAssessment,
    650
  );
  assert.equal(compatibleFallbackSummary.quoteSource, 'bitflow_cached_plan_compatible');
  assert.equal(compatibleFallbackSummary.amountOut, '443564');
  assert.equal(
    compatibleFallbackSummary.estimatedFeeSats,
    __test.deriveFeeEstimateSats(compatibleCache)
  );

  console.log(JSON.stringify({
    ok: true,
    test: 'defi-simple-cache-compat',
    assertions: 14,
  }, null, 2));
}

main();
