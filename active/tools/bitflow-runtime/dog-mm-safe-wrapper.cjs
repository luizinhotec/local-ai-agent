#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv, buildChildEnv } = require('./runtime-env.cjs');
const {
  computeProfitDiagnostics,
  resolveCorePrices,
} = require('./diagnostics/price-feed.cjs');
const {
  evaluateDecision,
} = require('./policy/decision-engine.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const EXECUTOR = path.resolve(__dirname, 'dog-mm-bitflow-swap-executor.cjs');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const STATE_FILE = path.resolve(STATE_DIR, 'bitflow-last-swap-plan.json');
const OPS_LOG_FILE = path.resolve(STATE_DIR, 'dog-mm-ops-log.jsonl');
const PRICE_CACHE_FILE = path.resolve(STATE_DIR, 'core-prices-cache.json');

const FILTERED_EXECUTOR_LINES = new Set([
  'profit_complete:',
  'input_usd:',
  'expected_output_usd:',
  'min_output_usd:',
  'network_fee_usd:',
  'net_profit_usd:',
  'worst_case_net_profit_usd:',
  'net_profit_bps:',
  'profit_missing_fields:',
]);

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseEnum(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function loadPolicy(args) {
  return {
    paperMode: true,
    maxAmountIn: parseNumber(args['max-amount-in'] ?? process.env.DOG_MM_SAFE_MAX_AMOUNT_IN, 20000),
    maxSlippageTolerance: parseNumber(
      args['max-slippage-tolerance'] ?? process.env.DOG_MM_SAFE_MAX_SLIPPAGE_TOLERANCE,
      3
    ),
    maxFee: parseNumber(args['max-fee'] ?? process.env.DOG_MM_SAFE_MAX_FEE, 500000),
    maxRouteHops: parseNumber(args['max-route-hops'] ?? process.env.DOG_MM_SAFE_MAX_ROUTE_HOPS, 2),
    minOutputRatio: parseNumber(args['min-output-ratio'] ?? process.env.DOG_MM_SAFE_MIN_OUTPUT_RATIO, 0.97),
    maxFeePerByte: parseNumber(args['max-fee-per-byte'] ?? process.env.DOG_MM_SAFE_MAX_FEE_PER_BYTE, 0),
    allowBroadcast: false,
    profitEnforcement: parseEnum(
      args['profit-enforcement'] ?? process.env.DOG_MM_PROFIT_ENFORCEMENT,
      ['off', 'warn', 'block'],
      'warn'
    ),
    minNetProfitUsd: parseNumber(args['min-net-profit-usd'] ?? process.env.DOG_MM_MIN_NET_PROFIT_USD, 0),
    minWorstCaseNetProfitUsd: parseNumber(
      args['min-worst-case-net-profit-usd'] ?? process.env.DOG_MM_MIN_WORST_CASE_NET_PROFIT_USD,
      0
    ),
    minNetProfitBps: parseNumber(args['min-net-profit-bps'] ?? process.env.DOG_MM_MIN_NET_PROFIT_BPS, 0),
    maxFeeAsPercentOfGrossProfit: parseNumber(
      args['max-fee-as-percent-of-gross-profit'] ?? process.env.DOG_MM_MAX_FEE_AS_PERCENT_OF_GROSS_PROFIT,
      100
    ),
    minExpectedNetUsd: parseNumber(
      args['min-expected-net-usd'] ?? process.env.DOG_MM_DECISION_MIN_EXPECTED_NET_USD,
      0.10
    ),
    minWorstCaseNetUsd: parseNumber(
      args['min-worst-case-net-usd'] ?? process.env.DOG_MM_DECISION_MIN_WORST_CASE_NET_USD,
      0
    ),
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    if (key === 'broadcast') {
      parsed.broadcast = true;
      continue;
    }
    if (key === 'json-only') {
      parsed['json-only'] = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function appendForwardedArg(childArgs, args, key) {
  if (args[key] !== undefined) {
    childArgs.push(`--${key}`, String(args[key]));
  }
}

function filterExecutorOutput(output) {
  if (!output) return '';
  return output
    .split(/\r?\n/)
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      for (const prefix of FILTERED_EXECUTOR_LINES) {
        if (trimmed.startsWith(prefix)) return false;
      }
      return true;
    })
    .join('\n');
}

function runExecutor(args, options = {}) {
  const silent = options.silent === true;
  const childArgs = [EXECUTOR];

  [
    'amount-in',
    'slippage-tolerance',
    'wallet-name',
    'wallet-id',
    'expected-address',
    'input-token',
    'output-token',
    'amm-strategy',
    'preferred-amm',
    'wallet-password',
    'swap-parameters-type',
    'input-token-decimals',
    'output-token-decimals',
    'input-token-usd',
    'output-token-usd',
    'stx-usd',
    'state-file',
    'summary-file',
    'provider',
  ].forEach(key => appendForwardedArg(childArgs, args, key));

  loadPolicy(args);

  const result = spawnSync(process.execPath, childArgs, {
    cwd: ROOT,
    stdio: 'pipe',
    env: buildChildEnv(),
    encoding: 'utf8',
  });

  const stdout = filterExecutorOutput(result.stdout || '');
  const stderr = result.stderr || '';
  if (!silent && stdout) {
    process.stdout.write(stdout.endsWith('\n') ? stdout : `${stdout}\n`);
  }
  if (!silent && stderr) {
    process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
  }

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Executor exited with code ${result.status}`);
  }
}

function resolveStateFile(args) {
  return args['state-file'] ? path.resolve(args['state-file']) : STATE_FILE;
}

function readPlan(stateFile) {
  if (!fs.existsSync(stateFile)) {
    throw new Error(`State file not found: ${stateFile}`);
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, ''));
}

function writePlan(plan, stateFile) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(plan, null, 2));
}

async function hydrateProfitDiagnostics(plan) {
  const existingProfit = plan.profitDiagnostics || {};
  const resolvedPrices = await resolveCorePrices({
    inputToken: plan.inputToken,
    outputToken: plan.outputToken,
    amountIn: plan.amountIn,
    amountOut: plan.quote?.amountOut,
    inputTokenDecimals:
      existingProfit.inputTokenDecimals ??
      plan.swap?.postConditions?.[0]?.token_decimals ??
      process.env.DOG_MM_INPUT_TOKEN_DECIMALS,
    outputTokenDecimals:
      existingProfit.outputTokenDecimals ??
      plan.swap?.postConditions?.[1]?.token_decimals ??
      process.env.DOG_MM_OUTPUT_TOKEN_DECIMALS,
    inputTokenUsd:
      existingProfit.inputTokenUsd ?? process.env.DOG_MM_INPUT_TOKEN_USD ?? null,
    outputTokenUsd:
      existingProfit.outputTokenUsd ?? process.env.DOG_MM_OUTPUT_TOKEN_USD ?? null,
    stxUsd:
      existingProfit.stxUsd ?? process.env.DOG_MM_STX_USD ?? null,
    cacheFile: PRICE_CACHE_FILE,
    timeoutMs: parseNumber(process.env.DOG_MM_PRICE_TIMEOUT_MS, 4000),
    userAgent: 'local-ai-agent/dog-mm-safe-wrapper',
  });

  const profitDiagnostics = computeProfitDiagnostics({
    amountIn: plan.amountIn,
    amountOut: plan.quote?.amountOut,
    minAmountOut: plan.quote?.minAmountOut,
    feeMicroStx: plan.feeDiagnostics?.feeMicroStx,
    feeStx: plan.feeDiagnostics?.feeStx,
    inputTokenDecimals:
      existingProfit.inputTokenDecimals ??
      plan.swap?.postConditions?.[0]?.token_decimals ??
      process.env.DOG_MM_INPUT_TOKEN_DECIMALS,
    outputTokenDecimals:
      existingProfit.outputTokenDecimals ??
      plan.swap?.postConditions?.[1]?.token_decimals ??
      process.env.DOG_MM_OUTPUT_TOKEN_DECIMALS,
    inputTokenUsd: resolvedPrices.inputTokenUsd,
    outputTokenUsd: resolvedPrices.outputTokenUsd,
    stxUsd: resolvedPrices.stxUsd,
  });

  plan.profitDiagnostics = {
    ...existingProfit,
    ...profitDiagnostics,
    complete: profitDiagnostics.complete === true,
    missingFields: profitDiagnostics.missingFields,
    corePriceFeed: {
      complete: resolvedPrices.complete,
      btcUsd: resolvedPrices.btcUsd,
      stxUsd: resolvedPrices.stxUsd,
      fetchedAtUtc: resolvedPrices.fetchedAtUtc,
      sources: resolvedPrices.sources,
      warnings: resolvedPrices.warnings,
    },
  };

  return plan;
}

function applyDecision(plan, validation, policy) {
  const result = evaluateDecision({
    profitComplete: plan.profitDiagnostics?.complete === true,
    netProfitUsd: plan.profitDiagnostics?.netProfitUsd,
    worstCaseNetProfitUsd: plan.profitDiagnostics?.worstCaseNetProfitUsd,
    validationPassed: validation.ok,
    outputRatio: validation.metrics.outputRatio,
    feePerByte: validation.metrics.feePerByte,
    routeHops: validation.metrics.routeHops,
    thresholds: {
      minExpectedNetUsd: policy.minExpectedNetUsd,
      minWorstCaseNetUsd: policy.minWorstCaseNetUsd,
      policyMinOutputRatio: policy.minOutputRatio,
      policyMaxFeePerByte: policy.maxFeePerByte,
      policyMaxRouteHops: policy.maxRouteHops,
    },
  });

  plan.paperMode = true;
  plan.wouldBroadcast = result.decision === 'EXECUTE';
  plan.decision = result.decision;
  plan.decisionReason = result.reason;
  plan.decisionThresholds = result.thresholds;
  plan.decisionMetrics = result.metrics;
  plan.minExpectedNetUsd = result.thresholds.minExpectedNetUsd;
  plan.minWorstCaseNetUsd = result.thresholds.minWorstCaseNetUsd;

  return result;
}

function evaluateProfitDiagnostics(plan, policy, errors, warnings) {
  const profit = plan.profitDiagnostics || {};
  const available = {
    netProfitUsd: parseOptionalNumber(profit.netProfitUsd),
    worstCaseNetProfitUsd: parseOptionalNumber(profit.worstCaseNetProfitUsd),
    netProfitBps: parseOptionalNumber(profit.netProfitBps),
    feeAsPercentOfGrossProfit: parseOptionalNumber(profit.feeAsPercentOfGrossProfit),
  };

  const profitIssues = [];

  if (profit.complete === false) {
    profitIssues.push(
      `profitDiagnostics incomplete${Array.isArray(profit.missingFields) && profit.missingFields.length > 0 ? ` (missing: ${profit.missingFields.join(', ')})` : ''}`
    );
  }

  if (available.netProfitUsd !== null && available.netProfitUsd <= policy.minNetProfitUsd) {
    profitIssues.push(`netProfitUsd ${available.netProfitUsd} is at or below threshold ${policy.minNetProfitUsd}`);
  }

  if (
    available.worstCaseNetProfitUsd !== null &&
    available.worstCaseNetProfitUsd <= policy.minWorstCaseNetProfitUsd
  ) {
    profitIssues.push(
      `worstCaseNetProfitUsd ${available.worstCaseNetProfitUsd} is at or below threshold ${policy.minWorstCaseNetProfitUsd}`
    );
  }

  if (available.netProfitBps !== null && available.netProfitBps < policy.minNetProfitBps) {
    profitIssues.push(`netProfitBps ${available.netProfitBps} is below threshold ${policy.minNetProfitBps}`);
  }

  if (
    available.feeAsPercentOfGrossProfit !== null &&
    available.feeAsPercentOfGrossProfit > policy.maxFeeAsPercentOfGrossProfit
  ) {
    profitIssues.push(
      `feeAsPercentOfGrossProfit ${available.feeAsPercentOfGrossProfit} exceeds threshold ${policy.maxFeeAsPercentOfGrossProfit}`
    );
  }

  if (policy.profitEnforcement === 'block') {
    errors.push(...profitIssues);
  } else if (policy.profitEnforcement === 'warn') {
    warnings.push(...profitIssues);
  }

  return {
    issues: profitIssues,
    metrics: available,
  };
}

function validatePlan(plan, policy) {
  const errors = [];
  const warnings = [];

  const amountIn = Number(plan.amountIn);
  const slippageTolerance = Number(plan.slippageTolerance);
  const fee = Number(plan.transaction?.fee ?? 0);
  const routeHops = Number(plan.quote?.totalHops ?? 0);
  const quoteAmountOut = Number(plan.quote?.amountOut ?? 0);
  const quoteMinAmountOut = Number(plan.quote?.minAmountOut ?? 0);
  const outputRatio = quoteAmountOut > 0 ? quoteMinAmountOut / quoteAmountOut : 0;
  const feePerByte = Number(plan.feeDiagnostics?.feePerByte ?? 0);
  const executionPathLength = Number(plan.feeDiagnostics?.executionPathLength ?? 0);

  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    errors.push(`Invalid amountIn: ${plan.amountIn}`);
  } else if (amountIn > policy.maxAmountIn) {
    errors.push(`amountIn ${amountIn} exceeds maxAmountIn ${policy.maxAmountIn}`);
  }

  if (!Number.isFinite(slippageTolerance) || slippageTolerance < 0) {
    errors.push(`Invalid slippageTolerance: ${plan.slippageTolerance}`);
  } else if (slippageTolerance > policy.maxSlippageTolerance) {
    errors.push(`slippageTolerance ${slippageTolerance} exceeds maxSlippageTolerance ${policy.maxSlippageTolerance}`);
  }

  if (!Number.isFinite(fee) || fee <= 0) {
    errors.push(`Invalid fee: ${plan.transaction?.fee}`);
  } else if (fee > policy.maxFee) {
    errors.push(`fee ${fee} exceeds maxFee ${policy.maxFee}`);
  }

  if (!Number.isFinite(routeHops) || routeHops <= 0) {
    errors.push(`Invalid routeHops: ${plan.quote?.totalHops}`);
  } else if (routeHops > policy.maxRouteHops) {
    errors.push(`routeHops ${routeHops} exceeds maxRouteHops ${policy.maxRouteHops}`);
  }

  if (!Number.isFinite(outputRatio) || outputRatio <= 0) {
    errors.push(`Invalid output ratio: quoteMinAmountOut=${quoteMinAmountOut}, quoteAmountOut=${quoteAmountOut}`);
  } else if (outputRatio < policy.minOutputRatio) {
    errors.push(`outputRatio ${outputRatio.toFixed(6)} is below minOutputRatio ${policy.minOutputRatio}`);
  }

  if (policy.maxFeePerByte > 0 && Number.isFinite(feePerByte) && feePerByte > policy.maxFeePerByte) {
    errors.push(`feePerByte ${feePerByte.toFixed(2)} exceeds maxFeePerByte ${policy.maxFeePerByte}`);
  }

  const profit = evaluateProfitDiagnostics(plan, policy, errors, warnings);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    profitIssues: profit.issues,
    metrics: {
      amountIn,
      slippageTolerance,
      fee,
      routeHops,
      quoteAmountOut,
      quoteMinAmountOut,
      outputRatio,
      feePerByte,
      executionPathLength,
      netProfitUsd: profit.metrics.netProfitUsd,
      worstCaseNetProfitUsd: profit.metrics.worstCaseNetProfitUsd,
      netProfitBps: profit.metrics.netProfitBps,
      feeAsPercentOfGrossProfit: profit.metrics.feeAsPercentOfGrossProfit,
    },
  };
}

function logCycleEvent(plan, validation, policy) {
  fs.mkdirSync(path.dirname(OPS_LOG_FILE), { recursive: true });

  const nextAction = validation.ok
    ? 'continue_observe_decide_cycle'
    : 'remain_dry_run_and_recalibrate';

  const record = {
    loggedAt: new Date().toISOString(),
    track: 'DOG MM Agent',
    type: 'agent_cycle_evaluated',
    details: {
      timestamp: new Date().toISOString(),
      walletName: plan.wallet?.name || '',
      amountIn: plan.amountIn,
      routeHops: plan.quote?.totalHops ?? null,
      executionPathLength: plan.feeDiagnostics?.executionPathLength ?? null,
      fee: plan.transaction?.fee ?? null,
      feePerByte: plan.feeDiagnostics?.feePerByte ?? null,
      expectedOutput: plan.quote?.amountOut ?? null,
      minOutput: plan.quote?.minAmountOut ?? null,
      inputUsd: plan.profitDiagnostics?.inputUsd ?? null,
      expectedOutputUsd: plan.profitDiagnostics?.expectedOutputUsd ?? null,
      minOutputUsd: plan.profitDiagnostics?.minOutputUsd ?? null,
      networkFeeUsd: plan.profitDiagnostics?.networkFeeUsd ?? null,
      netProfitEstimatedUsd: plan.profitDiagnostics?.netProfitUsd ?? null,
      worstCaseNetProfitEstimatedUsd: plan.profitDiagnostics?.worstCaseNetProfitUsd ?? null,
      validationFinal: validation.ok ? 'PASS' : 'BLOCKED',
      decision: plan.decision ?? null,
      decisionReason: plan.decisionReason ?? null,
      paperMode: plan.paperMode === true,
      wouldBroadcast: plan.wouldBroadcast === true,
      minExpectedNetUsd: plan.minExpectedNetUsd ?? null,
      minWorstCaseNetUsd: plan.minWorstCaseNetUsd ?? null,
      blockingReasons: validation.errors,
      warningReasons: validation.warnings,
      policy: {
        maxFee: policy.maxFee,
        maxFeePerByte: policy.maxFeePerByte,
        maxRouteHops: policy.maxRouteHops,
        minOutputRatio: policy.minOutputRatio,
        profitEnforcement: policy.profitEnforcement,
        minExpectedNetUsd: policy.minExpectedNetUsd,
        minWorstCaseNetUsd: policy.minWorstCaseNetUsd,
      },
      loopModel: {
        observe: {
          feeDiagnostics: plan.feeDiagnostics || null,
          profitDiagnosticsComplete: plan.profitDiagnostics?.complete ?? null,
        },
        decide: {
          warnings: validation.warnings,
          errors: validation.errors,
        },
        act: {
          mode: plan.broadcast ? 'broadcast' : 'dry_run',
          executed: false,
        },
        reflect: {
          nextAction,
        },
      },
    },
  };

  fs.appendFileSync(OPS_LOG_FILE, `${JSON.stringify(record)}\n`);
}

function printSummary(plan, validation, policy) {
  console.log('');
  console.log('=== DOG-MM SAFE WRAPPER SUMMARY ===');
  console.log(`wallet_name: ${plan.wallet?.name}`);
  console.log(`sender_address: ${plan.wallet?.address}`);
  console.log(`input_token: ${plan.inputToken}`);
  console.log(`output_token: ${plan.outputToken}`);
  console.log(`amount_in: ${validation.metrics.amountIn}`);
  console.log(`quote_amount_out: ${validation.metrics.quoteAmountOut}`);
  console.log(`quote_min_amount_out: ${validation.metrics.quoteMinAmountOut}`);
  console.log(`output_ratio: ${validation.metrics.outputRatio.toFixed(6)}`);
  console.log(`slippage_tolerance: ${validation.metrics.slippageTolerance}`);
  console.log(`route_hops: ${validation.metrics.routeHops}`);
  console.log(`fee: ${validation.metrics.fee}`);
  console.log(`fee_per_byte: ${validation.metrics.feePerByte.toFixed(2)}`);
  console.log(`tx_bytes: ${plan.feeDiagnostics?.txBytes ?? 'n/a'}`);
  console.log(`post_condition_count: ${plan.feeDiagnostics?.postConditionCount ?? 'n/a'}`);
  console.log(`typed_parameter_count: ${plan.feeDiagnostics?.typedParameterCount ?? 'n/a'}`);
  console.log(`execution_path_length: ${plan.feeDiagnostics?.executionPathLength ?? 'n/a'}`);
  console.log(`profit_complete: ${plan.profitDiagnostics?.complete === true ? 'yes' : 'no'}`);
  console.log(`input_usd: ${plan.profitDiagnostics?.inputUsd ?? 'n/a'}`);
  console.log(`expected_output_usd: ${plan.profitDiagnostics?.expectedOutputUsd ?? 'n/a'}`);
  console.log(`min_output_usd: ${plan.profitDiagnostics?.minOutputUsd ?? 'n/a'}`);
  console.log(`network_fee_usd: ${plan.profitDiagnostics?.networkFeeUsd ?? 'n/a'}`);
  console.log(`net_profit_usd: ${validation.metrics.netProfitUsd ?? 'n/a'}`);
  console.log(`worst_case_net_profit_usd: ${validation.metrics.worstCaseNetProfitUsd ?? 'n/a'}`);
  console.log(`net_profit_bps: ${validation.metrics.netProfitBps ?? 'n/a'}`);
  console.log(`decision: ${plan.decision ?? 'n/a'}`);
  console.log(`decision_reason: ${plan.decisionReason ?? 'n/a'}`);
  console.log(`paper_mode: ${plan.paperMode === true ? 'yes' : 'no'}`);
  console.log(`would_broadcast: ${plan.wouldBroadcast === true ? 'yes' : 'no'}`);
  console.log(`fee_as_percent_of_gross_profit: ${validation.metrics.feeAsPercentOfGrossProfit ?? 'n/a'}`);
  console.log(`txid: ${plan.transaction?.txid}`);
  console.log(`policy_max_fee: ${policy.maxFee}`);
  console.log(`policy_max_route_hops: ${policy.maxRouteHops}`);
  console.log(`policy_min_output_ratio: ${policy.minOutputRatio}`);
  console.log(`policy_max_fee_per_byte: ${policy.maxFeePerByte}`);
  console.log(`policy_profit_enforcement: ${policy.profitEnforcement}`);
  console.log(`broadcast_allowed: ${policy.allowBroadcast ? 'yes' : 'no'}`);
  console.log(`validation: ${validation.ok ? 'PASS' : 'BLOCKED'}`);

  if (validation.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of validation.warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (!validation.ok) {
    console.log('');
    console.log('Reasons:');
    for (const error of validation.errors) {
      console.log(`- ${error}`);
    }
  }
}

async function main() {
  loadRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const policy = loadPolicy(args);
  const jsonOnly = Boolean(args['json-only']);
  const stateFile = resolveStateFile(args);

  if (args.broadcast && !policy.allowBroadcast) {
    console.error('Broadcast is blocked by safety policy in dog-mm-safe-wrapper.cjs');
    process.exit(1);
  }

  runExecutor(args, { silent: jsonOnly });

  const plan = await hydrateProfitDiagnostics(readPlan(stateFile));
  const validation = validatePlan(plan, policy);
  applyDecision(plan, validation, policy);
  writePlan(plan, stateFile);
  if (!jsonOnly) {
    printSummary(plan, validation, policy);
  }
  logCycleEvent(plan, validation, policy);

  if (jsonOnly) {
    process.stdout.write(
      `${JSON.stringify(
        {
          generatedAtUtc: new Date().toISOString(),
          plan,
          validation,
          policy,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (!validation.ok) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`DOG-MM safe wrapper failed: ${error.message}`);
  process.exit(1);
});
