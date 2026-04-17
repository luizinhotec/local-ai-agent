#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv, buildChildEnv } = require('../runtime-env.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SAFE_WRAPPER = path.resolve(__dirname, '..', 'dog-mm-safe-wrapper.cjs');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-notional-study.json');
const STUDY_DIR = path.resolve(STATE_DIR, 'notional-study');

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function parseList(value, fallback) {
  const source = value || fallback;
  return String(source)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function toFiniteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function findFirst(rows, predicate) {
  for (const row of rows) {
    if (predicate(row)) {
      return row;
    }
  }
  return null;
}

function summarizeScenario(level, amountIn, payload) {
  const plan = payload?.plan || {};
  const validation = payload?.validation || {};
  const profit = plan?.profitDiagnostics || {};
  const feeDiagnostics = plan?.feeDiagnostics || {};
  const grossEdgeUsd =
    toFiniteNumber(profit.expectedOutputUsd) !== null && toFiniteNumber(profit.inputUsd) !== null
      ? round(toFiniteNumber(profit.expectedOutputUsd) - toFiniteNumber(profit.inputUsd))
      : null;

  return {
    ok: true,
    notionalLevel: level.label,
    multiplier: level.multiplier,
    amountIn,
    inputUsd: toFiniteNumber(profit.inputUsd),
    expectedOutputUsd: toFiniteNumber(profit.expectedOutputUsd),
    minOutputUsd: toFiniteNumber(profit.minOutputUsd),
    networkFeeUsd: toFiniteNumber(profit.networkFeeUsd),
    netProfitUsd: toFiniteNumber(profit.netProfitUsd),
    worstCaseNetProfitUsd: toFiniteNumber(profit.worstCaseNetProfitUsd),
    netProfitBps: toFiniteNumber(profit.netProfitBps),
    validation: validation.ok ? 'PASS' : 'BLOCKED',
    validationPassed: validation.ok === true,
    decision: plan.decision || 'UNKNOWN',
    decisionReason: plan.decisionReason || 'unknown',
    feeAsPercentOfInput: toFiniteNumber(profit.feeAsPercentOfInput),
    feeAsPercentOfExpectedOutput: toFiniteNumber(profit.feeAsPercentOfExpectedOutput),
    feeAsPercentOfGrossEdge: toFiniteNumber(profit.feeAsPercentOfGrossProfit),
    feeMicroStx: toFiniteNumber(feeDiagnostics.feeMicroStx),
    feePerByte: toFiniteNumber(feeDiagnostics.feePerByte),
    routeHops: toFiniteNumber(plan.quote?.totalHops),
    paperMode: plan.paperMode === true,
    wouldBroadcast: plan.wouldBroadcast === true,
    broadcastAllowed: payload?.policy?.allowBroadcast === true,
    stateFile: plan?.stateFile || null,
    summaryFile: plan?.summaryFile || null,
    grossEdgeUsd,
  };
}

function runScenario(index, baseAmountIn, level, sharedArgs) {
  const amountIn = String(Math.max(1, Math.round(baseAmountIn * level.multiplier)));
  const stateFile = path.resolve(STUDY_DIR, `notional-${index + 1}-${level.label}.json`);
  const summaryFile = path.resolve(STUDY_DIR, `notional-${index + 1}-${level.label}.md`);
  const childArgs = [
    SAFE_WRAPPER,
    '--json-only',
    '--amount-in',
    amountIn,
    '--max-amount-in',
    amountIn,
    '--state-file',
    stateFile,
    '--summary-file',
    summaryFile,
  ];

  for (const [key, value] of Object.entries(sharedArgs)) {
    if (value !== undefined && value !== null && value !== '') {
      childArgs.push(`--${key}`, String(value));
    }
  }

  const result = spawnSync(process.execPath, childArgs, {
    cwd: ROOT,
    env: buildChildEnv(),
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    return {
      ok: false,
      notionalLevel: level.label,
      multiplier: level.multiplier,
      amountIn,
      error: result.error.message,
    };
  }

  try {
    const payload = JSON.parse(result.stdout || '{}');
    return summarizeScenario(level, amountIn, payload);
  } catch (error) {
    return {
      ok: false,
      notionalLevel: level.label,
      multiplier: level.multiplier,
      amountIn,
      error:
        (result.stderr || result.stdout || error.message || `exit ${result.status}`).trim(),
    };
  }
}

function buildConclusion(results, breakEvenThresholdUsd) {
  const successful = results.filter(result => result.ok);
  const ranked = [...successful].sort((left, right) => {
    const leftWorst = left.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY;
    const rightWorst = right.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY;
    if (rightWorst !== leftWorst) return rightWorst - leftWorst;
    const leftNet = left.netProfitUsd ?? Number.NEGATIVE_INFINITY;
    const rightNet = right.netProfitUsd ?? Number.NEGATIVE_INFINITY;
    if (rightNet !== leftNet) return rightNet - leftNet;
    return left.multiplier - right.multiplier;
  });

  const sortedBySize = [...successful].sort((left, right) => left.multiplier - right.multiplier);

  const bestNet = [...successful].sort(
    (left, right) => (right.netProfitUsd ?? Number.NEGATIVE_INFINITY) - (left.netProfitUsd ?? Number.NEGATIVE_INFINITY)
  )[0] || null;
  const bestWorstCase = [...successful].sort(
    (left, right) =>
      (right.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY) -
      (left.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY)
  )[0] || null;

  const nearBreakEven = findFirst(
    sortedBySize,
    row => Math.abs(row.netProfitUsd ?? Number.POSITIVE_INFINITY) <= breakEvenThresholdUsd
  );
  const firstPositiveNet = findFirst(sortedBySize, row => (row.netProfitUsd ?? Number.NEGATIVE_INFINITY) > 0);
  const firstNonNegativeWorstCase = findFirst(
    sortedBySize,
    row => (row.worstCaseNetProfitUsd ?? Number.NEGATIVE_INFINITY) >= 0
  );

  return {
    breakEvenThresholdUsd,
    bestNetProfitUsd: bestNet
      ? { notionalLevel: bestNet.notionalLevel, amountIn: bestNet.amountIn, value: bestNet.netProfitUsd }
      : null,
    bestWorstCaseNetProfitUsd: bestWorstCase
      ? {
          notionalLevel: bestWorstCase.notionalLevel,
          amountIn: bestWorstCase.amountIn,
          value: bestWorstCase.worstCaseNetProfitUsd,
        }
      : null,
    firstNearBreakEven: nearBreakEven
      ? { notionalLevel: nearBreakEven.notionalLevel, amountIn: nearBreakEven.amountIn, value: nearBreakEven.netProfitUsd }
      : null,
    firstPositiveNetProfit: firstPositiveNet
      ? { notionalLevel: firstPositiveNet.notionalLevel, amountIn: firstPositiveNet.amountIn, value: firstPositiveNet.netProfitUsd }
      : null,
    firstNonNegativeWorstCaseNetProfit: firstNonNegativeWorstCase
      ? {
          notionalLevel: firstNonNegativeWorstCase.notionalLevel,
          amountIn: firstNonNegativeWorstCase.amountIn,
          value: firstNonNegativeWorstCase.worstCaseNetProfitUsd,
        }
      : null,
    promisingRangeExists: Boolean(firstPositiveNet || firstNonNegativeWorstCase),
    ranking: ranked.map(row => ({
      notionalLevel: row.notionalLevel,
      amountIn: row.amountIn,
      netProfitUsd: row.netProfitUsd,
      worstCaseNetProfitUsd: row.worstCaseNetProfitUsd,
      decision: row.decision,
      decisionReason: row.decisionReason,
    })),
  };
}

function printScenario(result) {
  console.log('');
  console.log(`notional_level: ${result.notionalLevel}`);
  console.log(`amount_in: ${result.amountIn}`);
  if (!result.ok) {
    console.log(`status: ERROR`);
    console.log(`error: ${result.error}`);
    return;
  }
  console.log(`input_usd: ${result.inputUsd ?? 'n/a'}`);
  console.log(`expected_output_usd: ${result.expectedOutputUsd ?? 'n/a'}`);
  console.log(`min_output_usd: ${result.minOutputUsd ?? 'n/a'}`);
  console.log(`network_fee_usd: ${result.networkFeeUsd ?? 'n/a'}`);
  console.log(`net_profit_usd: ${result.netProfitUsd ?? 'n/a'}`);
  console.log(`worst_case_net_profit_usd: ${result.worstCaseNetProfitUsd ?? 'n/a'}`);
  console.log(`net_profit_bps: ${result.netProfitBps ?? 'n/a'}`);
  console.log(`validation: ${result.validation}`);
  console.log(`decision: ${result.decision}`);
  console.log(`decision_reason: ${result.decisionReason}`);
  console.log(`fee_as_percent_of_input: ${result.feeAsPercentOfInput ?? 'n/a'}`);
  console.log(`fee_as_percent_of_expected_output: ${result.feeAsPercentOfExpectedOutput ?? 'n/a'}`);
  console.log(`fee_as_percent_of_gross_edge: ${result.feeAsPercentOfGrossEdge ?? 'n/a'}`);
}

function printConclusion(conclusion) {
  console.log('');
  console.log('DOG-MM NOTIONAL STUDY SUMMARY');
  console.log(
    `best_net_profit_usd: ${
      conclusion.bestNetProfitUsd
        ? `${conclusion.bestNetProfitUsd.value} @ ${conclusion.bestNetProfitUsd.notionalLevel}`
        : 'n/a'
    }`
  );
  console.log(
    `best_worst_case_net_profit_usd: ${
      conclusion.bestWorstCaseNetProfitUsd
        ? `${conclusion.bestWorstCaseNetProfitUsd.value} @ ${conclusion.bestWorstCaseNetProfitUsd.notionalLevel}`
        : 'n/a'
    }`
  );
  console.log(
    `first_near_break_even: ${
      conclusion.firstNearBreakEven
        ? `${conclusion.firstNearBreakEven.notionalLevel} (${conclusion.firstNearBreakEven.value})`
        : 'none'
    }`
  );
  console.log(
    `first_positive_net_profit: ${
      conclusion.firstPositiveNetProfit
        ? `${conclusion.firstPositiveNetProfit.notionalLevel} (${conclusion.firstPositiveNetProfit.value})`
        : 'none'
    }`
  );
  console.log(
    `first_non_negative_worst_case_net_profit: ${
      conclusion.firstNonNegativeWorstCaseNetProfit
        ? `${conclusion.firstNonNegativeWorstCaseNetProfit.notionalLevel} (${conclusion.firstNonNegativeWorstCaseNetProfit.value})`
        : 'none'
    }`
  );
  console.log(`promising_range_exists: ${conclusion.promisingRangeExists ? 'yes' : 'no'}`);
  console.log('');
  console.log('RANKING');
  if (conclusion.ranking.length === 0) {
    console.log('1. no successful scenarios');
  } else {
    conclusion.ranking.forEach((row, index) => {
      console.log(
        `${index + 1}. ${row.notionalLevel} | net_profit_usd=${row.netProfitUsd ?? 'n/a'} | worst_case_net_profit_usd=${row.worstCaseNetProfitUsd ?? 'n/a'} | decision=${row.decision}`
      );
    });
  }
}

function main() {
  loadRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const baseAmountIn = Math.max(
    1,
    Math.round(
      toFiniteNumber(args['base-amount-in'], toFiniteNumber(process.env.DOG_MM_AMOUNT_IN, 13479))
    )
  );
  const levels = parseList(
    args.levels || process.env.DOG_MM_NOTIONAL_STUDY_LEVELS,
    '1,2,5,10,20,50,100'
  ).map(value => {
    const multiplier = toFiniteNumber(value, null);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(`Invalid notional multiplier: ${value}`);
    }
    return {
      label: `${value}x`,
      multiplier,
    };
  });

  const breakEvenThresholdUsd = toFiniteNumber(
    args['break-even-threshold-usd'],
    toFiniteNumber(process.env.DOG_MM_NOTIONAL_BREAK_EVEN_THRESHOLD_USD, 0.05)
  );

  const sharedArgs = {
    'wallet-name': args['wallet-name'] || process.env.DOG_MM_WALLET_NAME || '',
    'wallet-id': args['wallet-id'] || process.env.DOG_MM_WALLET_ID || '',
    'expected-address': args['expected-address'] || process.env.DOG_MM_EXPECTED_ADDRESS || '',
    'input-token': args['input-token'] || process.env.DOG_MM_INPUT_TOKEN || '',
    'output-token': args['output-token'] || process.env.DOG_MM_OUTPUT_TOKEN || '',
    'amm-strategy': args['amm-strategy'] || process.env.DOG_MM_AMM_STRATEGY || 'best',
    'input-token-usd': args['input-token-usd'] || process.env.DOG_MM_INPUT_TOKEN_USD || '',
    'output-token-usd': args['output-token-usd'] || process.env.DOG_MM_OUTPUT_TOKEN_USD || '',
    'stx-usd': args['stx-usd'] || process.env.DOG_MM_STX_USD || '',
    'input-token-decimals': args['input-token-decimals'] || process.env.DOG_MM_INPUT_TOKEN_DECIMALS || '',
    'output-token-decimals': args['output-token-decimals'] || process.env.DOG_MM_OUTPUT_TOKEN_DECIMALS || '',
    'slippage-tolerance': args['slippage-tolerance'] || process.env.DOG_MM_SLIPPAGE_TOLERANCE || '',
  };

  const results = levels.map((level, index) => runScenario(index, baseAmountIn, level, sharedArgs));
  const conclusion = buildConclusion(results, breakEvenThresholdUsd);
  const study = {
    generatedAtUtc: new Date().toISOString(),
    baseAmountIn,
    breakEvenThresholdUsd,
    paperModeExpected: true,
    broadcastAllowedExpected: false,
    levels,
    results,
    conclusion,
  };

  ensureDir(OUTPUT_JSON);
  fs.mkdirSync(STUDY_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(study, null, 2)}\n`);

  console.log('DOG-MM NOTIONAL STUDY');
  console.log(`base_amount_in: ${baseAmountIn}`);
  console.log(`levels: ${levels.map(level => level.label).join(', ')}`);
  console.log(`paper_mode_expected: yes`);
  console.log(`broadcast_allowed_expected: no`);

  results.forEach(printScenario);
  printConclusion(conclusion);
  console.log('');
  console.log(`study_json: ${OUTPUT_JSON}`);
}

try {
  main();
} catch (error) {
  console.error(`DOG-MM notional study failed: ${error.message}`);
  process.exit(1);
}
