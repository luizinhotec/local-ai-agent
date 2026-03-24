const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');
const { resolveCorePrices } = require(path.join(
  __dirname,
  '..',
  '..',
  'active',
  'tools',
  'bitflow-runtime',
  'diagnostics',
  'price-feed.cjs'
));

const HIRO_API = 'https://api.hiro.so';
const BITFLOW_QUOTE_URL = 'https://bff.bitflowapis.finance/api/quotes/v1/quote/multi';
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const BITFLOW_EXECUTOR_PATH = path.join(ROOT_DIR, 'active', 'tools', 'bitflow-runtime', 'dog-mm-bitflow-swap-executor.cjs');
const CACHED_PLAN_PATH = path.join(ROOT_DIR, 'active', 'state', 'dog-mm', 'bitflow-last-swap-plan.json');
const EXECUTOR_STATE_PATH = path.join(ROOT_DIR, 'state', 'speedy-indra', 'bitflow-live-last-swap.json');
const EXECUTOR_SUMMARY_PATH = path.join(ROOT_DIR, 'state', 'speedy-indra', 'bitflow-live-last-swap.md');
const SUPPORTED_PAIR = 'sbtc-usdcx';
const SBTC_CONTRACT = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token';
const USDCX_CONTRACT = 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx';
const QUOTE_FRESHNESS_SEC = 300;
const FAILURE_CIRCUIT_THRESHOLD = 3;

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (['signature', 'walletPassword', 'mnemonic', 'wif', 'hex', 'stderr', 'stdout'].includes(key)) {
      sanitized[key] = item ? '[REDACTED]' : item;
      continue;
    }
    sanitized[key] = sanitizeValue(item);
  }
  return sanitized;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getWalletCatalogPath() {
  return path.join(process.env.USERPROFILE || '', '.aibtc', 'wallets.json');
}

function findWalletMatch(config) {
  const catalog = readJsonIfExists(getWalletCatalogPath());
  if (!catalog?.wallets?.length) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'wallet_catalog_missing',
    };
  }
  const matches = catalog.wallets
    .filter(wallet => wallet.address === config.stxAddress || wallet.btcAddress === config.btcAddress)
    .sort((left, right) => {
      const leftDate = new Date(left.lastUsed || left.createdAt || 0).getTime();
      const rightDate = new Date(right.lastUsed || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    });
  if (matches.length === 0) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'wallet_not_found_in_catalog',
    };
  }
  const wallet = matches[0];
  return {
    ok: true,
    status: 'ready',
    wallet: {
      id: wallet.id,
      name: wallet.name,
      stxAddress: wallet.address || null,
      btcAddress: wallet.btcAddress || null,
      taprootAddress: wallet.taprootAddress || null,
      network: wallet.network || null,
      createdAt: wallet.createdAt || null,
      lastUsed: wallet.lastUsed || null,
    },
  };
}

function findTokenBalance(fungibleTokens, needle) {
  const lowerNeedle = needle.toLowerCase();
  for (const [key, value] of Object.entries(fungibleTokens || {})) {
    if (key.toLowerCase().includes(lowerNeedle)) {
      return {
        tokenKey: key,
        balance: Number(value?.balance || 0),
      };
    }
  }
  return {
    tokenKey: null,
    balance: 0,
  };
}

async function checkStacksBalances(stxAddress) {
  if (!stxAddress) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'missing_stx_address',
    };
  }
  try {
    const response = await fetchJson(`${HIRO_API}/extended/v1/address/${encodeURIComponent(stxAddress)}/balances`);
    if (!response.ok) {
      return {
        ok: false,
        status: 'degraded',
        reason: 'stacks_balance_lookup_failed',
        response,
      };
    }
    const stx = response.body?.stx || {};
    const fungibleTokens = response.body?.fungible_tokens || {};
    const sbtc = findTokenBalance(fungibleTokens, '.sbtc-token');
    const usdcx = findTokenBalance(fungibleTokens, '.usdcx');
    return {
      ok: true,
      status: 'ready',
      stxAddress,
      stxMicroStx: Number(stx.balance || 0),
      sbtcSats: sbtc.balance,
      usdcxBaseUnits: usdcx.balance,
      tokenKeys: {
        sbtc: sbtc.tokenKey,
        usdcx: usdcx.tokenKey,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 'degraded',
      reason: 'stacks_balance_lookup_failed',
      error: error.message,
    };
  }
}

async function checkNetworkStatus() {
  try {
    const response = await fetchJson(`${HIRO_API}/v2/info`);
    return {
      ok: response.ok,
      status: response.ok ? 'ready' : 'degraded',
      burnBlockHeight: response.body?.burn_block_height ?? null,
      stacksTipHeight: response.body?.stacks_tip_height ?? null,
      responseStatus: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'degraded',
      reason: 'stacks_network_probe_failed',
      error: error.message,
    };
  }
}

function resolveWalletPassword() {
  return process.env.AIBTC_WALLET_PASSWORD || process.env.DOG_MM_WALLET_PASSWORD || '';
}

function checkSignerReadiness(walletMatch) {
  if (!walletMatch.ok) {
    return {
      ok: false,
      status: 'not_ready',
      reason: walletMatch.reason,
      executorPasswordReady: false,
    };
  }
  const walletPassword = resolveWalletPassword();
  const mnemonic = process.env.AIBTC_HEARTBEAT_MNEMONIC || process.env.CLIENT_MNEMONIC || '';
  if (!walletPassword && !mnemonic) {
    return {
      ok: false,
      status: 'locked',
      reason: 'wallet_password_missing',
      executorPasswordReady: false,
    };
  }
  return {
    ok: true,
    status: 'ready',
    source: mnemonic ? 'env_mnemonic' : 'wallet_keystore',
    executorPasswordReady: Boolean(walletPassword),
  };
}

async function fetchBitflowQuote(amountSats, slippageBps) {
  return fetchJson(BITFLOW_QUOTE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input_token: SBTC_CONTRACT,
      output_token: USDCX_CONTRACT,
      amount_in: String(amountSats),
      amm_strategy: 'best',
      slippage_tolerance: Number((slippageBps / 100).toFixed(2)),
    }),
  });
}

function normalizeContractId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function toFiniteNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCachedPlanPair(cachedPlan) {
  const inputToken = normalizeContractId(cachedPlan?.inputToken);
  const outputToken = normalizeContractId(cachedPlan?.outputToken);
  if (!inputToken || !outputToken) return null;
  return `${inputToken}->${outputToken}`;
}

function assessCachedPlanCompatibility(cachedPlan, context = {}) {
  if (!cachedPlan || typeof cachedPlan !== 'object') {
    return {
      available: false,
      compatible: false,
      rejectReason: 'missing_context',
      ageSec: null,
      generatedAtUtc: null,
      plan: null,
    };
  }

  const generatedAtUtc = cachedPlan.generatedAtUtc || null;
  const generatedAtMs = generatedAtUtc ? Date.parse(generatedAtUtc) : NaN;
  const ageSec = Number.isFinite(generatedAtMs)
    ? Math.max(0, Math.round((context.nowMs - generatedAtMs) / 1000))
    : null;
  const inputToken = normalizeContractId(cachedPlan.inputToken);
  const outputToken = normalizeContractId(cachedPlan.outputToken);
  const cachedAmountIn = Number(cachedPlan.amountIn);
  const cachedWalletAddress = normalizeContractId(
    cachedPlan.wallet?.address || cachedPlan.wallet?.stxAddress || null
  );
  const expectedWalletAddress = normalizeContractId(context.stxAddress);
  const expectedPair = normalizeContractId(
    context.pair === SUPPORTED_PAIR ? `${SBTC_CONTRACT}->${USDCX_CONTRACT}` : context.pair
  );
  const cachedPair = getCachedPlanPair(cachedPlan);

  let rejectReason = null;
  if (!generatedAtUtc || ageSec === null) {
    rejectReason = 'missing_context';
  } else if (ageSec > QUOTE_FRESHNESS_SEC) {
    rejectReason = 'stale_cache';
  } else if (!inputToken || !outputToken) {
    rejectReason = 'missing_context';
  } else if (cachedPair !== expectedPair) {
    rejectReason = 'pair_mismatch';
  } else if (!Number.isFinite(cachedAmountIn) || cachedAmountIn !== Number(context.amountSats)) {
    rejectReason = 'amount_mismatch';
  } else if (
    cachedWalletAddress &&
    expectedWalletAddress &&
    cachedWalletAddress !== expectedWalletAddress
  ) {
    rejectReason = 'wallet_mismatch';
  } else if (
    inputToken !== normalizeContractId(SBTC_CONTRACT) ||
    outputToken !== normalizeContractId(USDCX_CONTRACT)
  ) {
    rejectReason = 'asset_mismatch';
  }

  return {
    available: true,
    compatible: rejectReason === null,
    rejectReason,
    ageSec,
    generatedAtUtc,
    plan: rejectReason === null ? cachedPlan : null,
  };
}

function deriveFeeEstimateSats(cachedPlan) {
  const networkFeeUsd = cachedPlan?.profitDiagnostics?.networkFeeUsd;
  const btcUsd = cachedPlan?.profitDiagnostics?.corePriceFeed?.btcUsd || cachedPlan?.profitDiagnostics?.inputTokenUsd;
  if (!Number.isFinite(networkFeeUsd) || !Number.isFinite(btcUsd) || btcUsd <= 0) {
    return null;
  }
  return Math.round((networkFeeUsd / btcUsd) * 100_000_000);
}

function deriveFeeEstimateMicroStx(cachedPlan) {
  const feeMicroStx = Number(cachedPlan?.feeDiagnostics?.feeMicroStx);
  return Number.isFinite(feeMicroStx) ? feeMicroStx : null;
}

function estimateSatsFromMicroStx(feeMicroStx, priceContext) {
  const stxUsd =
    Number(priceContext?.profitDiagnostics?.corePriceFeed?.stxUsd) ||
    Number(priceContext?.profitDiagnostics?.stxUsd) ||
    Number(priceContext?.stxUsd) ||
    null;
  const btcUsd =
    Number(priceContext?.profitDiagnostics?.corePriceFeed?.btcUsd) ||
    Number(priceContext?.profitDiagnostics?.inputTokenUsd) ||
    Number(priceContext?.btcUsd) ||
    null;
  if (!Number.isFinite(feeMicroStx) || !Number.isFinite(stxUsd) || !Number.isFinite(btcUsd) || btcUsd <= 0) {
    return null;
  }
  const feeStx = feeMicroStx / 1_000_000;
  return Math.round(((feeStx * stxUsd) / btcUsd) * 100_000_000);
}

function buildQuoteSummary(selectedRoute, quoteResponse, cacheAssessment, amountSats) {
  const compatibleCachedPlan = cacheAssessment?.compatible ? cacheAssessment.plan : null;
  const useLiveQuote = Boolean(quoteResponse.ok && selectedRoute);
  const useCompatibleCachedQuote = Boolean(!useLiveQuote && !quoteResponse.ok && compatibleCachedPlan?.quote);
  const fallbackQuote = useCompatibleCachedQuote ? compatibleCachedPlan.quote : null;
  const summary = {
    amountIn: String(amountSats),
    amountOut: useLiveQuote ? selectedRoute?.amount_out || null : fallbackQuote?.amountOut || null,
    minAmountOut: useLiveQuote ? selectedRoute?.min_amount_out || null : fallbackQuote?.minAmountOut || null,
    routePath: useLiveQuote ? selectedRoute?.route_path || [] : fallbackQuote?.routePath || [],
    executionPath: useLiveQuote ? selectedRoute?.execution_path || [] : fallbackQuote?.executionPath || [],
    totalHops: useLiveQuote ? selectedRoute?.total_hops || null : fallbackQuote?.totalHops || null,
    feeRate:
      useLiveQuote
        ? selectedRoute?.execution_details?.fee_rate || null
        : fallbackQuote?.executionDetails?.fee_rate || null,
    priceImpactBps:
      (useLiveQuote
        ? selectedRoute?.execution_details?.hop_details?.[0]?.price_impact_bps
        : fallbackQuote?.executionDetails?.hop_details?.[0]?.price_impact_bps) ??
      null,
    quoteSource: useLiveQuote
      ? 'bitflow_live_quote'
      : useCompatibleCachedQuote
      ? 'bitflow_cached_plan_compatible'
      : 'bitflow_quote_unavailable',
    responseStatus: quoteResponse.status,
    fetchedAt: new Date().toISOString(),
    cacheAvailable: Boolean(cacheAssessment?.available),
    cacheCompatible: Boolean(cacheAssessment?.compatible),
    cacheRejectReason: cacheAssessment?.compatible ? null : cacheAssessment?.rejectReason || null,
    cacheAgeSec: cacheAssessment?.ageSec ?? null,
    cacheGeneratedAtUtc: cacheAssessment?.generatedAtUtc || null,
    feeSource: compatibleCachedPlan ? 'cached_plan_compatible' : 'unavailable',
    feeComputationReason: compatibleCachedPlan ? 'cached_profit_diagnostics' : 'fee_unavailable',
    feeConfidence: compatibleCachedPlan ? 'medium' : 'none',
    rawFeeInputs: compatibleCachedPlan
      ? sanitizeValue({
          feeMicroStx: deriveFeeEstimateMicroStx(compatibleCachedPlan),
          networkFeeUsd: compatibleCachedPlan?.profitDiagnostics?.networkFeeUsd ?? null,
          btcUsd:
            compatibleCachedPlan?.profitDiagnostics?.corePriceFeed?.btcUsd ??
            compatibleCachedPlan?.profitDiagnostics?.inputTokenUsd ??
            null,
          stxUsd:
            compatibleCachedPlan?.profitDiagnostics?.corePriceFeed?.stxUsd ??
            compatibleCachedPlan?.profitDiagnostics?.stxUsd ??
            null,
        })
      : null,
  };
  summary.estimatedFeeSats = compatibleCachedPlan ? deriveFeeEstimateSats(compatibleCachedPlan) : null;
  summary.estimatedFeeMicroStx = compatibleCachedPlan ? deriveFeeEstimateMicroStx(compatibleCachedPlan) : null;
  return summary;
}

function buildGuardrailAssessment(config, amountSats, pair, quoteSummary, balances, signerReadiness, networkStatus, previousFailures) {
  const blockers = [];
  if (pair !== SUPPORTED_PAIR) blockers.push('pair_not_allowlisted');
  if (config.defiSimple.allowedPairs.length > 0 && !config.defiSimple.allowedPairs.includes(pair)) {
    blockers.push('pair_not_in_config_allowlist');
  }
  if (amountSats > config.defiSimple.maxInputSats) blockers.push('input_above_max_sats');
  if (!balances?.ok) blockers.push('stacks_balances_unavailable');
  if ((balances?.sbtcSats || 0) < amountSats) blockers.push('insufficient_sbtc_balance');
  if (!signerReadiness.ok) blockers.push(signerReadiness.reason || 'signer_not_ready');
  if (!networkStatus.ok) blockers.push('stacks_network_unavailable');
  if (!quoteSummary.amountOut || !quoteSummary.minAmountOut) blockers.push('quote_amounts_missing');
  if (quoteSummary.quoteSource === 'bitflow_quote_unavailable') blockers.push('quote_unavailable');
  const priceImpactBps = Math.abs(Number(quoteSummary.priceImpactBps || 0));
  if (priceImpactBps > config.defiSimple.maxSlippageBps) blockers.push('slippage_above_max_bps');
  if (quoteSummary.estimatedFeeSats === null) blockers.push('estimated_fee_unavailable');
  if (quoteSummary.estimatedFeeSats !== null && quoteSummary.estimatedFeeSats > config.defiSimple.maxFeeSats) {
    blockers.push('estimated_fee_above_max_sats');
  }
  if (
    quoteSummary.estimatedFeeMicroStx !== null &&
    Number(balances?.stxMicroStx || 0) < Number(quoteSummary.estimatedFeeMicroStx)
  ) {
    blockers.push('insufficient_stx_for_fee');
  }
  if (previousFailures >= FAILURE_CIRCUIT_THRESHOLD) blockers.push('circuit_breaker_open');
  return [...new Set(blockers)];
}

function buildPlan(config, pair, amountSats, walletMatch, balances, signerReadiness, networkStatus, quoteSummary, cachedPlan, blockers) {
  const quoteFreshnessSec = quoteSummary.fetchedAt
    ? Math.max(0, Math.round((Date.now() - new Date(quoteSummary.fetchedAt).getTime()) / 1000))
    : null;
  const quoteFresh = quoteFreshnessSec !== null && quoteFreshnessSec <= QUOTE_FRESHNESS_SEC;
  if (!quoteFresh) blockers.push('quote_stale');
  const liveCapable =
    fs.existsSync(BITFLOW_EXECUTOR_PATH) &&
    signerReadiness.executorPasswordReady &&
    walletMatch.ok;
  return {
    pair,
    amountSats,
    status: blockers.length === 0 ? 'ready' : quoteSummary.amountOut ? 'partial' : 'not_ready',
    wallet: walletMatch.wallet || null,
    balances: sanitizeValue({
      sbtcSats: balances?.sbtcSats ?? null,
      usdcxBaseUnits: balances?.usdcxBaseUnits ?? null,
      stxMicroStx: balances?.stxMicroStx ?? null,
    }),
    dependencyReadiness: {
      walletMatch: walletMatch.ok,
      signerReady: signerReadiness.ok,
      executorPasswordReady: signerReadiness.executorPasswordReady,
      executorAvailable: fs.existsSync(BITFLOW_EXECUTOR_PATH),
      cachedPlanAvailable: Boolean(cachedPlan),
      cachedPlanCompatible: Boolean(quoteSummary.cacheCompatible),
      networkReady: networkStatus.ok,
    },
    cacheStatus: {
      available: Boolean(quoteSummary.cacheAvailable),
      compatible: Boolean(quoteSummary.cacheCompatible),
      rejectReason: quoteSummary.cacheRejectReason || null,
      ageSec: quoteSummary.cacheAgeSec ?? null,
      generatedAtUtc: quoteSummary.cacheGeneratedAtUtc || null,
    },
    quote: quoteSummary,
    quoteFreshnessSec,
    quoteFresh,
    executionPolicy: {
      liveEnabled: liveCapable,
      approvalRequired: config.defiSimple.requireApprovalForLive,
      maxInputSats: config.defiSimple.maxInputSats,
      maxSlippageBps: config.defiSimple.maxSlippageBps,
      maxFeeSats: config.defiSimple.maxFeeSats,
      quoteMaxAgeSec: QUOTE_FRESHNESS_SEC,
      pairAllowlist: [SUPPORTED_PAIR],
      circuitBreakerThreshold: FAILURE_CIRCUIT_THRESHOLD,
    },
    executor: {
      path: fs.existsSync(BITFLOW_EXECUTOR_PATH) ? BITFLOW_EXECUTOR_PATH : null,
      mode: liveCapable ? 'subprocess_wrapper_available' : 'subprocess_wrapper_blocked',
    },
    cachedContext: quoteSummary.cacheCompatible && cachedPlan
      ? {
          generatedAtUtc: cachedPlan.generatedAtUtc || null,
          feePerByte: cachedPlan?.feeDiagnostics?.feePerByte ?? null,
          decision: cachedPlan?.decision || null,
          decisionReason: cachedPlan?.decisionReason || null,
        }
      : null,
    knownBlockers: [...new Set(blockers)],
  };
}

function buildEphemeralExecutorFiles(amountSats) {
  const suffix = `${process.pid}-${Date.now()}-${amountSats}-${Math.random().toString(16).slice(2)}`;
  return {
    stateFile: path.join(os.tmpdir(), `speedy-indra-bitflow-fee-${suffix}.json`),
    summaryFile: path.join(os.tmpdir(), `speedy-indra-bitflow-fee-${suffix}.md`),
  };
}

function tryUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup for ephemeral executor artifacts.
  }
}

function buildExecutorArgs(walletMatch, amountSats, slippageBps, broadcast, outputFiles = {}) {
  const args = [
    BITFLOW_EXECUTOR_PATH,
    '--json-only',
    '--wallet-id',
    walletMatch.wallet.id,
    '--expected-address',
    walletMatch.wallet.stxAddress,
    '--input-token',
    SBTC_CONTRACT,
    '--output-token',
    USDCX_CONTRACT,
    '--amount-in',
    String(amountSats),
    '--slippage-tolerance',
    String(Number((slippageBps / 100).toFixed(2))),
    '--state-file',
    outputFiles.stateFile || EXECUTOR_STATE_PATH,
    '--summary-file',
    outputFiles.summaryFile || EXECUTOR_SUMMARY_PATH,
  ];
  if (broadcast) {
    args.push('--broadcast');
  }
  return args;
}

function runBitflowExecutor(walletMatch, amountSats, slippageBps, broadcast, options = {}) {
  const walletPassword = resolveWalletPassword();
  if (!walletPassword) {
    return {
      ok: false,
      status: 'rejected',
      reason: 'wallet_password_missing_for_executor',
    };
  }

  const outputFiles = options.ephemeral ? buildEphemeralExecutorFiles(amountSats) : {};
  const run = spawnSync(process.execPath, buildExecutorArgs(walletMatch, amountSats, slippageBps, broadcast, outputFiles), {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: {
      ...process.env,
      DOG_MM_WALLET_PASSWORD: walletPassword,
    },
    timeout: 120000,
  });

  try {
    if (run.error) {
      return {
        ok: false,
        status: 'failed',
        reason: 'executor_spawn_failed',
        error: run.error.message,
      };
    }

    const stdout = run.stdout || '';
    const stderr = (run.stderr || '').trim();
    let body = null;
    try {
      body = stdout.trim() ? JSON.parse(stdout) : null;
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        reason: 'executor_output_parse_failed',
        error: error.message,
        exitCode: run.status,
        stderr,
      };
    }

    if (run.status !== 0) {
      return {
        ok: false,
        status: 'failed',
        reason: 'executor_failed',
        exitCode: run.status,
        stderr,
        body,
      };
    }

    return {
      ok: true,
      status: broadcast ? 'broadcasted' : 'planned',
      body,
      stderr,
    };
  } finally {
    if (options.ephemeral) {
      tryUnlink(outputFiles.stateFile);
      tryUnlink(outputFiles.summaryFile);
    }
  }
}

async function deriveLiveFeeEstimate(walletMatch, amountSats, slippageBps, quoteSummary) {
  const unavailable = {
    estimatedFeeSats: null,
    estimatedFeeMicroStx: null,
    feeSource: 'unavailable',
    feeComputationReason: 'fee_unavailable',
    feeConfidence: 'none',
    rawFeeInputs: null,
  };

  if (quoteSummary?.quoteSource !== 'bitflow_live_quote') {
    return {
      ...unavailable,
      feeComputationReason: 'quote_not_live',
    };
  }
  if (!walletMatch?.ok || !walletMatch?.wallet?.id || !walletMatch?.wallet?.stxAddress) {
    return {
      ...unavailable,
      feeComputationReason: 'wallet_not_ready_for_preflight',
    };
  }
  if (!fs.existsSync(BITFLOW_EXECUTOR_PATH)) {
    return {
      ...unavailable,
      feeComputationReason: 'executor_unavailable',
    };
  }
  if (!resolveWalletPassword()) {
    return {
      ...unavailable,
      feeComputationReason: 'wallet_password_missing_for_executor',
    };
  }

  const preflight = runBitflowExecutor(walletMatch, amountSats, slippageBps, false, { ephemeral: true });
  if (!preflight.ok) {
    return {
      ...unavailable,
      feeComputationReason: preflight.reason || 'preflight_failed',
      rawFeeInputs: sanitizeValue({
        preflightStatus: preflight.status || null,
        exitCode: preflight.exitCode ?? null,
      }),
    };
  }

  const feeMicroStx =
    toFiniteNumber(preflight.body?.feeDiagnostics?.feeMicroStx) ??
    toFiniteNumber(preflight.body?.transaction?.fee);
  if (!Number.isFinite(feeMicroStx) || feeMicroStx <= 0) {
    return {
      ...unavailable,
      feeComputationReason: 'preflight_fee_missing',
      rawFeeInputs: sanitizeValue({
        preflightGeneratedAtUtc: preflight.body?.generatedAtUtc || null,
      }),
    };
  }

  const inputTokenDecimals =
    toFiniteNumber(preflight.body?.profitDiagnostics?.inputTokenDecimals) ??
    toFiniteNumber(preflight.body?.quote?.inputTokenDecimals) ??
    8;
  const outputTokenDecimals =
    toFiniteNumber(preflight.body?.profitDiagnostics?.outputTokenDecimals) ??
    toFiniteNumber(preflight.body?.quote?.outputTokenDecimals) ??
    6;
  const prices = await resolveCorePrices({
    inputToken: SBTC_CONTRACT,
    outputToken: USDCX_CONTRACT,
    amountIn: amountSats,
    amountOut: quoteSummary?.amountOut || preflight.body?.quote?.amountOut || null,
    minAmountOut: quoteSummary?.minAmountOut || preflight.body?.quote?.minAmountOut || null,
    inputTokenDecimals,
    outputTokenDecimals,
    feeMicroStx,
  });
  const btcUsd = toFiniteNumber(prices?.btcUsd);
  const stxUsd = toFiniteNumber(prices?.stxUsd);
  if (!Number.isFinite(btcUsd) || btcUsd <= 0 || !Number.isFinite(stxUsd) || stxUsd <= 0) {
    return {
      ...unavailable,
      feeComputationReason: 'core_price_inputs_unavailable',
      rawFeeInputs: sanitizeValue({
        feeMicroStx,
        btcUsd,
        stxUsd,
        priceSources: prices?.sources || {},
        priceWarnings: prices?.warnings || [],
      }),
    };
  }

  const estimatedFeeSats = estimateSatsFromMicroStx(feeMicroStx, {
    btcUsd,
    stxUsd,
  });
  if (!Number.isFinite(estimatedFeeSats) || estimatedFeeSats < 0) {
    return {
      ...unavailable,
      feeComputationReason: 'fee_conversion_failed',
      rawFeeInputs: sanitizeValue({
        feeMicroStx,
        btcUsd,
        stxUsd,
      }),
    };
  }

  return {
    estimatedFeeSats,
    estimatedFeeMicroStx: feeMicroStx,
    feeSource: 'live_derived',
    feeComputationReason: 'executor_preflight_fee_microstx_x_core_prices',
    feeConfidence: prices.complete ? 'high' : 'medium',
    rawFeeInputs: sanitizeValue({
      feeMicroStx,
      feePerByte: preflight.body?.feeDiagnostics?.feePerByte ?? null,
      txBytes: preflight.body?.feeDiagnostics?.txBytes ?? null,
      btcUsd,
      stxUsd,
      priceSources: prices?.sources || {},
      priceWarnings: prices?.warnings || [],
      preflightGeneratedAtUtc: preflight.body?.generatedAtUtc || null,
    }),
  };
}

function mergeFeeEstimateIntoQuoteSummary(quoteSummary, feeEstimate) {
  if (!feeEstimate || !quoteSummary) return quoteSummary;
  return {
    ...quoteSummary,
    estimatedFeeSats: feeEstimate.estimatedFeeSats,
    estimatedFeeMicroStx: feeEstimate.estimatedFeeMicroStx,
    feeSource: feeEstimate.feeSource || quoteSummary.feeSource,
    feeComputationReason: feeEstimate.feeComputationReason || quoteSummary.feeComputationReason,
    feeConfidence: feeEstimate.feeConfidence || quoteSummary.feeConfidence,
    rawFeeInputs: feeEstimate.rawFeeInputs ?? quoteSummary.rawFeeInputs,
  };
}

function buildPreflightSummary(executorRun, feeEstimate = null) {
  const body = executorRun?.body || {};
  const feeMicroStx = Number(body.transaction?.fee || 0) || null;
  return {
    generatedAtUtc: body.generatedAtUtc || null,
    amountIn: body.amountIn || null,
    amountOut: body.quote?.amountOut || null,
    minAmountOut: body.quote?.minAmountOut || null,
    feeMicroStx,
    feeSatsEquivalent:
      feeEstimate?.estimatedFeeSats ??
      estimateSatsFromMicroStx(feeMicroStx, body),
    feeSource: feeEstimate?.feeSource || 'unavailable',
    txid: body.transaction?.txid || null,
    contract: body.swap?.contract || null,
    functionName: body.swap?.functionName || null,
    decision: body.decision || null,
    decisionReason: body.decisionReason || null,
    broadcastResponse: body.broadcastResponse || null,
  };
}

function buildLiveBlockers(config, plan, balances, executorPreflight, approveLive) {
  const blockers = [];
  const preflight = executorPreflight?.body || {};
  const preflightFeeMicroStx = Number(preflight.transaction?.fee || 0);
  const preflightFeeSats =
    toFiniteNumber(plan?.quote?.estimatedFeeSats) ??
    estimateSatsFromMicroStx(preflightFeeMicroStx, preflight);

  if (plan.pair !== SUPPORTED_PAIR) blockers.push('live_pair_not_supported');
  if (plan.amountSats > config.defiSimple.maxInputSats) blockers.push('live_input_above_max_sats');
  if ((balances?.sbtcSats || 0) < plan.amountSats) blockers.push('live_insufficient_sbtc_balance');
  if (!plan.dependencyReadiness.signerReady) blockers.push('live_signer_not_ready');
  if (!plan.dependencyReadiness.executorAvailable) blockers.push('live_executor_unavailable');
  if (!plan.quoteFresh) blockers.push('live_quote_stale');
  if (Math.abs(Number(plan.quote.priceImpactBps || 0)) > config.defiSimple.maxSlippageBps) {
    blockers.push('live_slippage_above_max_bps');
  }
  if (
    plan.quote.estimatedFeeSats !== null &&
    Number(plan.quote.estimatedFeeSats) > config.defiSimple.maxFeeSats
  ) {
    blockers.push('live_estimated_fee_above_max_sats');
  }
  if (preflightFeeSats !== null && preflightFeeSats > config.defiSimple.maxFeeSats) {
    blockers.push('live_preflight_fee_above_max_sats');
  }
  if (config.defiSimple.requireApprovalForLive !== true) blockers.push('live_config_approval_not_enabled');
  if (!approveLive) blockers.push('live_cli_approval_missing');
  if (plan.knownBlockers.length > 0) blockers.push('live_plan_has_critical_blockers');
  if (!executorPreflight?.ok) blockers.push(executorPreflight?.reason || 'live_preflight_failed');

  if (Number.isFinite(preflightFeeMicroStx) && Number(balances?.stxMicroStx || 0) < preflightFeeMicroStx) {
    blockers.push('live_insufficient_stx_for_fee');
  }
  if (!preflight.transaction?.txid) blockers.push('live_preflight_tx_missing');
  if (!preflight.swap?.contract || !preflight.swap?.functionName) blockers.push('live_preflight_swap_metadata_missing');
  if (preflight.decision && String(preflight.decision).toUpperCase() !== 'GO') {
    blockers.push('live_executor_policy_rejected');
  }

  return [...new Set(blockers)];
}

function canUseFeatureFlagOverrideForTest({
  featureEnabled,
  pair,
  amountSats,
  approveLive,
  dryRun,
  statusOnly,
  previousState,
}) {
  if (featureEnabled) return false;
  if (dryRun || statusOnly) return false;
  if (!approveLive) return false;
  if (pair !== SUPPORTED_PAIR) return false;
  if (!Number.isFinite(amountSats) || amountSats <= 0 || amountSats > 3000) return false;
  if (previousState?.defiLiveFeatureTestConsumedAt) return false;
  return true;
}

function canUseFeatureFlagOverrideForTestV2({
  featureEnabled,
  pair,
  amountSats,
  approveLive,
  dryRun,
  statusOnly,
  previousState,
  explicitOverride,
}) {
  if (featureEnabled) return false;
  if (!explicitOverride) return false;
  if (dryRun || statusOnly) return false;
  if (!approveLive) return false;
  if (pair !== SUPPORTED_PAIR) return false;
  if (!Number.isFinite(amountSats) || amountSats <= 0 || amountSats > 2000) return false;
  if (previousState?.defiLiveFeatureTestV2ConsumedAt) return false;
  return true;
}

async function runSbtcToUsdcx(options = {}) {
  const config = loadAgentConfig();
  const nowIso = new Date().toISOString();
  const requestedMode = String(options.mode || '').trim().toLowerCase();
  const statusOnly =
    requestedMode === 'quote' ? true : parseBoolean(options.statusOnly, false);
  const dryRun =
    requestedMode === 'execute'
      ? false
      : requestedMode === 'quote' || requestedMode === 'plan'
      ? true
      : options.dryRun === undefined
      ? config.defiSimple.dryRunDefault
      : parseBoolean(options.dryRun, true);
  const force = parseBoolean(options.force, false);
  const approveLive = parseBoolean(options.approveLive, false);
  const featureOverrideTestV2 = parseBoolean(
    options.featureOverrideTestV2 ?? options['feature-override-test-v2'],
    false,
  );
  const persist = options.persist === undefined ? requestedMode === '' : parseBoolean(options.persist, false);
  const pair = String(options.pair || SUPPORTED_PAIR).trim().toLowerCase();
  const amountSats = Number(options['amount-sats'] || 10000);
  const featureEnabled = config.featureFlags.defiSimple;

  appendJsonLog('defi_simple_skill_started', {
    statusOnly,
    dryRun,
    force,
    approveLive,
    pair,
    amountSats,
  });

  const previousState = readJsonIfExists(path.join(ROOT_DIR, 'state', 'speedy-indra', 'agent-state.json')) || {};
  const featureFlagOverrideForTest = canUseFeatureFlagOverrideForTest({
    featureEnabled,
    pair,
    amountSats,
    approveLive,
    dryRun,
    statusOnly,
    previousState,
  });
  const featureFlagOverrideForTestV2 = canUseFeatureFlagOverrideForTestV2({
    featureEnabled,
    pair,
    amountSats,
    approveLive,
    dryRun,
    statusOnly,
    previousState,
    explicitOverride: featureOverrideTestV2,
  });
  const effectiveFeatureEnabled =
    featureEnabled || featureFlagOverrideForTest || featureFlagOverrideForTestV2;

  if (featureFlagOverrideForTest) {
    appendJsonLog('defi_simple_feature_flag_override', {
      feature_flag_override_for_test: true,
      pair,
      amountSats,
      approveLive,
      scope: 'restricted_manual_live_test',
    });
  }
  if (featureFlagOverrideForTestV2) {
    appendJsonLog('defi_simple_feature_flag_override_v2', {
      feature_flag_override_for_test_v2: true,
      pair,
      amountSats,
      approveLive,
      scope: 'restricted_manual_live_test_v2',
    });
  }

  const previousFailures = Number(previousState.consecutiveDefiFailures || previousState.defiFailed || 0);
  const walletMatch = findWalletMatch(config);
  const balances = await checkStacksBalances(walletMatch.wallet?.stxAddress || config.stxAddress);
  const networkStatus = await checkNetworkStatus();
  const signerReadiness = checkSignerReadiness(walletMatch);
  appendJsonLog('defi_simple_readiness_checked', sanitizeValue({
    walletMatch,
    balances,
    networkStatus,
    signerReadiness,
  }));

  let quoteResponse;
  try {
    quoteResponse = await fetchBitflowQuote(amountSats, config.defiSimple.maxSlippageBps);
  } catch (error) {
    quoteResponse = {
      ok: false,
      status: 0,
      body: { error: error.message },
    };
  }
  const cachedPlan = readJsonIfExists(CACHED_PLAN_PATH);
  const cacheAssessment = assessCachedPlanCompatibility(cachedPlan, {
    pair,
    amountSats,
    stxAddress: walletMatch.wallet?.stxAddress || config.stxAddress,
    nowMs: Date.now(),
  });
  appendJsonLog('defi_simple_cache_assessed', sanitizeValue({
    pair,
    amountSats,
    cacheAvailable: cacheAssessment.available,
    cacheCompatible: cacheAssessment.compatible,
    cacheRejectReason: cacheAssessment.rejectReason,
    cacheAgeSec: cacheAssessment.ageSec,
    cacheGeneratedAtUtc: cacheAssessment.generatedAtUtc,
  }));
  const selectedRoute = quoteResponse.body?.routes?.[0] || null;
  let quoteSummary = buildQuoteSummary(selectedRoute, quoteResponse, cacheAssessment, amountSats);
  if (quoteSummary.quoteSource === 'bitflow_live_quote' && quoteSummary.estimatedFeeSats === null) {
    const liveFeeEstimate = await deriveLiveFeeEstimate(
      walletMatch,
      amountSats,
      config.defiSimple.maxSlippageBps,
      quoteSummary
    );
    quoteSummary = mergeFeeEstimateIntoQuoteSummary(quoteSummary, liveFeeEstimate);
    appendJsonLog('defi_simple_live_fee_estimated', sanitizeValue({
      pair,
      amountSats,
      feeSource: quoteSummary.feeSource,
      feeComputationReason: quoteSummary.feeComputationReason,
      estimatedFeeSats: quoteSummary.estimatedFeeSats,
      estimatedFeeMicroStx: quoteSummary.estimatedFeeMicroStx,
      rawFeeInputs: quoteSummary.rawFeeInputs,
    }));
  }
  appendJsonLog('defi_simple_quote_checked', sanitizeValue({
    pair,
    quoteSummary,
    quoteResponse: {
      ok: quoteResponse.ok,
      status: quoteResponse.status,
      error: quoteResponse.ok ? null : quoteResponse.body?.error || null,
    },
  }));

  const blockers = [];
  if (persist && !effectiveFeatureEnabled && !statusOnly) blockers.push('feature_disabled');
  if (!quoteResponse.ok && !cacheAssessment.compatible) blockers.push('quote_unavailable');
  if (quoteResponse.ok && !selectedRoute) blockers.push('quote_returned_no_routes');
  if (!force && amountSats > config.defiSimple.maxInputSats) blockers.push('input_above_max_sats');

  blockers.push(
    ...buildGuardrailAssessment(
      config,
      amountSats,
      pair,
      quoteSummary,
      balances,
      signerReadiness,
      networkStatus,
      previousFailures
    )
  );

  const plan = buildPlan(
    config,
    pair,
    amountSats,
    walletMatch,
    balances,
    signerReadiness,
    networkStatus,
    quoteSummary,
    cachedPlan,
    blockers
  );
  appendJsonLog('defi_simple_plan_built', sanitizeValue(plan));

  const liveRequested = !dryRun && !statusOnly;
  let execution = {
    executed: false,
    status: 'skipped',
    reason: dryRun
      ? 'dry_run_default'
      : statusOnly
      ? 'status_only'
      : 'live_not_attempted',
  };

  if (liveRequested) {
    appendJsonLog('defi_simple_live_requested', sanitizeValue({
      pair,
      amountSats,
      approveLive,
      approvalRequired: config.defiSimple.requireApprovalForLive,
    }));

    const preflight = runBitflowExecutor(walletMatch, amountSats, config.defiSimple.maxSlippageBps, false);
    const liveBlockers = buildLiveBlockers(config, plan, balances, preflight, approveLive);

    if (liveBlockers.length > 0) {
      execution = {
        executed: false,
        status: 'skipped',
        reason: liveBlockers[0],
        blockers: liveBlockers,
        preflight: sanitizeValue(buildPreflightSummary(preflight, {
          estimatedFeeSats: quoteSummary.estimatedFeeSats,
          feeSource: quoteSummary.feeSource,
        })),
      };
      appendJsonLog('defi_simple_live_rejected', sanitizeValue({
        pair,
        amountSats,
        blockers: liveBlockers,
        preflight: buildPreflightSummary(preflight, {
          estimatedFeeSats: quoteSummary.estimatedFeeSats,
          feeSource: quoteSummary.feeSource,
        }),
      }));
    } else {
      appendJsonLog('defi_simple_live_approved', sanitizeValue({
        pair,
        amountSats,
        preflight: buildPreflightSummary(preflight, {
          estimatedFeeSats: quoteSummary.estimatedFeeSats,
          feeSource: quoteSummary.feeSource,
        }),
      }));
      appendJsonLog('defi_simple_live_execution_started', { pair, amountSats });

      const liveRun = runBitflowExecutor(walletMatch, amountSats, config.defiSimple.maxSlippageBps, true);
      if (!liveRun.ok) {
        execution = {
          executed: false,
          status: 'failed',
          reason: liveRun.reason || 'live_execution_failed',
          error: liveRun.error || null,
          exitCode: liveRun.exitCode ?? null,
          result: sanitizeValue(buildPreflightSummary(liveRun, {
            estimatedFeeSats: quoteSummary.estimatedFeeSats,
            feeSource: quoteSummary.feeSource,
          })),
        };
        appendJsonLog('defi_simple_live_execution_failed', sanitizeValue({
          pair,
          amountSats,
          execution,
        }));
      } else {
        const body = liveRun.body || {};
        execution = {
          executed: true,
          status: 'completed',
          reason: 'broadcast_completed',
          txid: body.broadcastResponse?.txid || body.transaction?.txid || null,
          broadcastResponse: sanitizeValue(body.broadcastResponse || null),
          transaction: sanitizeValue({
            txid: body.transaction?.txid || null,
            nonce: body.transaction?.nonce || null,
            fee: body.transaction?.fee || null,
          }),
          preflight: sanitizeValue(buildPreflightSummary(preflight, {
            estimatedFeeSats: quoteSummary.estimatedFeeSats,
            feeSource: quoteSummary.feeSource,
          })),
        };
        appendJsonLog('defi_simple_live_execution_completed', sanitizeValue({
          pair,
          amountSats,
          execution,
        }));
      }
    }
  } else {
    appendJsonLog('defi_simple_execution_skipped', sanitizeValue({
      pair,
      blockers: plan.knownBlockers,
      execution,
    }));
  }

  const status = execution.executed ? 'completed' : plan.status;
  const standardized = {
    status,
    quoteSummary: sanitizeValue(quoteSummary),
    plan: sanitizeValue(plan),
    executionPolicy: sanitizeValue(plan.executionPolicy),
    blockers: [...plan.knownBlockers],
  };

  let finalState = null;
  if (persist) {
    finalState = updateAgentState(current => {
      current.defiStatus = {
        implemented: true,
        ready: plan.knownBlockers.length === 0,
        status: plan.status,
        approvalRequired: config.defiSimple.requireApprovalForLive,
        liveEnabled: plan.executionPolicy.liveEnabled,
      };
      current.defiLastPair = pair;
      current.lastDefiCheckAt = nowIso;
      current.defiKnownBlockers = plan.knownBlockers;
      current.defiLastPlan = sanitizeValue(plan);
      current.defiLastQuoteSummary = sanitizeValue(quoteSummary);
      if (!statusOnly) {
        current.defiAttempts += 1;
        current.lastDefiAttemptAt = nowIso;
        if (liveRequested) {
          current.lastDefiLiveAttemptAt = nowIso;
        }
        if (execution.executed) {
          current.defiSucceeded += 1;
          current.lastDefiSuccessAt = nowIso;
          current.lastDefiLiveSuccessAt = nowIso;
          current.lastDefiLiveTxId = execution.txid || null;
          current.lastDefiLiveOutcome = execution.status;
          current.consecutiveDefiFailures = 0;
        } else if (liveRequested && execution.status === 'failed') {
          current.defiFailed += 1;
          current.lastDefiLiveOutcome = execution.reason || execution.status;
          current.consecutiveDefiFailures += 1;
        } else if (liveRequested && execution.status === 'skipped') {
          current.lastDefiLiveOutcome = execution.reason || execution.status;
        } else if (plan.knownBlockers.length > 0) {
          current.defiFailed += 1;
        }
      }
      current.skills.defiSimple = {
        ...current.skills.defiSimple,
        enabled: effectiveFeatureEnabled,
        lastRunAt: nowIso,
        lastSuccessAt: execution.executed ? nowIso : current.skills.defiSimple.lastSuccessAt,
        lastFailureAt:
          execution.status === 'failed'
            ? nowIso
            : !execution.executed && plan.knownBlockers.length > 0
            ? nowIso
            : current.skills.defiSimple.lastFailureAt,
        lastSkipReason: execution.executed ? null : execution.reason,
        lastOutcome: execution.executed ? 'completed' : liveRequested ? execution.status : 'planned',
        lastAttemptMode: dryRun ? 'dry_run' : statusOnly ? 'status_only' : 'live',
        lastStatusCode: 200,
        errorCount:
          execution.status === 'failed'
            ? current.skills.defiSimple.errorCount + 1
            : !execution.executed && plan.knownBlockers.length > 0
            ? current.skills.defiSimple.errorCount + 1
            : current.skills.defiSimple.errorCount,
      };
      if (featureFlagOverrideForTest) {
        current.defiLiveFeatureTestConsumedAt = nowIso;
      }
      if (featureFlagOverrideForTestV2) {
        current.defiLiveFeatureTestV2ConsumedAt = nowIso;
      }
      return current;
    });

    writeAgentStatus({
      checkedAt: nowIso,
      defi: finalState.defiStatus,
      defiPlan: finalState.defiLastPlan,
    });
  }

  appendJsonLog('defi_simple_skill_completed', {
    ok: true,
    dryRun,
    statusOnly,
    liveRequested,
    pair,
    blockerCount: plan.knownBlockers.length,
    liveOutcome: execution.status,
  });

  return {
    ok: true,
    skill: 'defi-simple',
    mode: requestedMode || (liveRequested ? 'execute' : statusOnly ? 'quote' : 'plan'),
    dryRun,
    statusOnly,
    approveLive,
    pair,
    amountSats,
    ...standardized,
    plan: sanitizeValue(plan),
    execution: sanitizeValue(execution),
    state: finalState,
  };
}

async function runDefiSimpleSkill(options = {}) {
  return runSbtcToUsdcx(options);
}

module.exports = {
  runDefiSimpleSkill,
  runSbtcToUsdcx,
  __test: {
    assessCachedPlanCompatibility,
    buildQuoteSummary,
    buildPlan,
    deriveFeeEstimateSats,
  },
};
