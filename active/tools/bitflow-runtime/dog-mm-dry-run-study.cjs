#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv, buildChildEnv } = require('./runtime-env.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const EXECUTOR = path.resolve(__dirname, 'dog-mm-bitflow-swap-executor.cjs');
const OUTPUT_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'study');
const OUTPUT_JSON = path.resolve(OUTPUT_DIR, 'dog-mm-dry-run-study.json');
const OUTPUT_MD = path.resolve(OUTPUT_DIR, 'dog-mm-dry-run-study.md');

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

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function runScenario(index, scenario, sharedArgs) {
  const stateFile = path.resolve(OUTPUT_DIR, `scenario-${index + 1}.json`);
  const summaryFile = path.resolve(OUTPUT_DIR, `scenario-${index + 1}.md`);
  const childArgs = [
    EXECUTOR,
    '--json-only',
    '--amount-in',
    scenario.amountIn,
    '--amm-strategy',
    scenario.ammStrategy,
    '--state-file',
    stateFile,
    '--summary-file',
    summaryFile,
  ];

  if (sharedArgs.walletName) childArgs.push('--wallet-name', sharedArgs.walletName);
  if (sharedArgs.walletId) childArgs.push('--wallet-id', sharedArgs.walletId);
  if (sharedArgs.expectedAddress) childArgs.push('--expected-address', sharedArgs.expectedAddress);
  if (sharedArgs.inputTokenUsd) childArgs.push('--input-token-usd', sharedArgs.inputTokenUsd);
  if (sharedArgs.outputTokenUsd) childArgs.push('--output-token-usd', sharedArgs.outputTokenUsd);
  if (sharedArgs.stxUsd) childArgs.push('--stx-usd', sharedArgs.stxUsd);
  if (sharedArgs.inputTokenDecimals) childArgs.push('--input-token-decimals', sharedArgs.inputTokenDecimals);
  if (sharedArgs.outputTokenDecimals) childArgs.push('--output-token-decimals', sharedArgs.outputTokenDecimals);

  const result = spawnSync(process.execPath, childArgs, {
    cwd: ROOT,
    env: buildChildEnv(),
    encoding: 'utf8',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    return {
      scenario,
      ok: false,
      error: result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`,
    };
  }

  const payload = JSON.parse(result.stdout);
  return {
    scenario,
    ok: true,
    quoteAmountOut: payload.quote?.amountOut ?? null,
    minAmountOut: payload.quote?.minAmountOut ?? null,
    routeHops: payload.quote?.totalHops ?? null,
    fee: payload.transaction?.fee ?? null,
    feePerByte: payload.feeDiagnostics?.feePerByte ?? null,
    executionPathLength: payload.feeDiagnostics?.executionPathLength ?? null,
    netProfitUsd: payload.profitDiagnostics?.netProfitUsd ?? null,
    worstCaseNetProfitUsd: payload.profitDiagnostics?.worstCaseNetProfitUsd ?? null,
    netProfitBps: payload.profitDiagnostics?.netProfitBps ?? null,
    profitComplete: payload.profitDiagnostics?.complete ?? null,
    stateFile,
    summaryFile,
  };
}

function buildMarkdown(summary) {
  const lines = [
    '# DOG MM Dry Run Study',
    '',
    `- generated_at_utc: ${summary.generatedAtUtc}`,
    '',
    '## Scenarios',
    '',
  ];

  summary.results.forEach((result, index) => {
    lines.push(`### Scenario ${index + 1}`);
    lines.push('');
    lines.push(`- amount_in: ${result.scenario.amountIn}`);
    lines.push(`- amm_strategy: ${result.scenario.ammStrategy}`);
    lines.push(`- ok: ${result.ok}`);
    if (result.ok) {
      lines.push(`- quote_amount_out: ${result.quoteAmountOut}`);
      lines.push(`- min_amount_out: ${result.minAmountOut}`);
      lines.push(`- route_hops: ${result.routeHops}`);
      lines.push(`- fee: ${result.fee}`);
      lines.push(`- fee_per_byte: ${result.feePerByte}`);
      lines.push(`- net_profit_usd: ${result.netProfitUsd}`);
      lines.push(`- worst_case_net_profit_usd: ${result.worstCaseNetProfitUsd}`);
      lines.push(`- net_profit_bps: ${result.netProfitBps}`);
      lines.push(`- profit_complete: ${result.profitComplete}`);
    } else {
      lines.push(`- error: ${result.error}`);
    }
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

function main() {
  loadRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const amounts = parseList(args['amounts'] || process.env.DOG_MM_STUDY_AMOUNTS, '8000,13479,20000');
  const strategies = parseList(args['amm-strategies'] || process.env.DOG_MM_STUDY_AMM_STRATEGIES, 'best');

  const sharedArgs = {
    walletName: args['wallet-name'] || process.env.DOG_MM_WALLET_NAME || '',
    walletId: args['wallet-id'] || process.env.DOG_MM_WALLET_ID || '',
    expectedAddress: args['expected-address'] || process.env.DOG_MM_EXPECTED_ADDRESS || '',
    inputTokenUsd: args['input-token-usd'] || process.env.DOG_MM_INPUT_TOKEN_USD || '',
    outputTokenUsd: args['output-token-usd'] || process.env.DOG_MM_OUTPUT_TOKEN_USD || '',
    stxUsd: args['stx-usd'] || process.env.DOG_MM_STX_USD || '',
    inputTokenDecimals: args['input-token-decimals'] || process.env.DOG_MM_INPUT_TOKEN_DECIMALS || '',
    outputTokenDecimals: args['output-token-decimals'] || process.env.DOG_MM_OUTPUT_TOKEN_DECIMALS || '',
  };

  const scenarios = [];
  amounts.forEach(amountIn => {
    strategies.forEach(ammStrategy => {
      scenarios.push({ amountIn, ammStrategy });
    });
  });

  const results = scenarios.map((scenario, index) => runScenario(index, scenario, sharedArgs));
  const summary = {
    generatedAtUtc: new Date().toISOString(),
    scenarioCount: scenarios.length,
    results,
  };

  ensureDir(OUTPUT_JSON);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2));
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(summary));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(`DOG MM dry-run study failed: ${error.message}`);
  process.exit(1);
}
