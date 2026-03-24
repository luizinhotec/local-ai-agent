const fs = require('fs');
const path = require('path');

function toFiniteNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scaleAtomicToHuman(value, decimals) {
  const amount = toFiniteNumber(value);
  const precision = toFiniteNumber(decimals);
  if (!Number.isFinite(amount) || !Number.isFinite(precision)) return null;
  return amount / (10 ** precision);
}

function ratioToBps(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return (value / base) * 10_000;
}

function percent(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return (value / base) * 100;
}

function deriveImpliedInputTokenUsd(inputTokenUsd, input = {}) {
  if (Number.isFinite(inputTokenUsd)) return inputTokenUsd;
  if (!isStableUsdToken(input.outputToken)) return inputTokenUsd;

  const amountInHuman = scaleAtomicToHuman(input.amountIn, input.inputTokenDecimals);
  const amountOutHuman = scaleAtomicToHuman(input.amountOut, input.outputTokenDecimals);
  const outputTokenUsd = toFiniteNumber(input.outputTokenUsd);

  if (
    Number.isFinite(amountInHuman) &&
    amountInHuman > 0 &&
    Number.isFinite(amountOutHuman) &&
    Number.isFinite(outputTokenUsd)
  ) {
    return (amountOutHuman * outputTokenUsd) / amountInHuman;
  }

  return inputTokenUsd;
}

function normalizeToken(token) {
  return String(token || '').trim().toLowerCase();
}

function isBtcLikeToken(token) {
  const normalized = normalizeToken(token);
  return normalized.includes('sbtc') || normalized.includes('bitcoin') || normalized.endsWith('.xbtc');
}

function isStableUsdToken(token) {
  const normalized = normalizeToken(token);
  return (
    normalized.includes('usdc') ||
    normalized.includes('usdt') ||
    normalized.includes('usd') ||
    normalized.includes('dai')
  );
}

function readCache(cacheFile) {
  try {
    if (!fs.existsSync(cacheFile)) return null;
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function writeCache(cacheFile, payload) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 2));
  } catch {
    // Cache write failures are non-fatal for the trading loop.
  }
}

async function fetchCoinGecko(timeoutMs, userAgent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,blockstack&vs_currencies=usd',
      {
        headers: {
          accept: 'application/json',
          'user-agent': userAgent,
        },
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCorePrices(input = {}) {
  const cacheFile =
    input.cacheFile ||
    path.resolve(__dirname, '..', '..', '..', 'state', 'dog-mm', 'core-prices-cache.json');
  const timeoutMs = toFiniteNumber(input.timeoutMs, 4000) || 4000;
  const userAgent = input.userAgent || 'local-ai-agent/dog-mm-price-feed';
  const warnings = [];
  const sources = {};
  const cache = readCache(cacheFile);

  let btcUsd = toFiniteNumber(input.inputTokenUsd);
  if (!Number.isFinite(btcUsd) || !isBtcLikeToken(input.inputToken)) {
    btcUsd = null;
  }

  let stxUsd = toFiniteNumber(input.stxUsd);
  let outputTokenUsd = toFiniteNumber(input.outputTokenUsd);
  let fetchedAtUtc = null;

  if (isStableUsdToken(input.outputToken) && !Number.isFinite(outputTokenUsd)) {
    outputTokenUsd = 1;
    sources.outputTokenUsd = 'stablecoin_heuristic';
  }

  try {
    const market = await fetchCoinGecko(timeoutMs, userAgent);
    const fetchedBtcUsd = toFiniteNumber(market?.bitcoin?.usd);
    const fetchedStxUsd = toFiniteNumber(market?.blockstack?.usd);

    if (Number.isFinite(fetchedBtcUsd)) {
      btcUsd = fetchedBtcUsd;
      sources.btcUsd = 'coingecko';
    }
    if (Number.isFinite(fetchedStxUsd)) {
      stxUsd = fetchedStxUsd;
      sources.stxUsd = 'coingecko';
    }

    fetchedAtUtc = new Date().toISOString();
    writeCache(cacheFile, {
      fetchedAtUtc,
      btcUsd,
      stxUsd,
    });
  } catch (error) {
    warnings.push(`core price fetch failed: ${error?.message || String(error)}`);
    const cachedBtcUsd = toFiniteNumber(cache?.btcUsd);
    const cachedStxUsd = toFiniteNumber(cache?.stxUsd);
    const cachedFetchedAtUtc =
      typeof cache?.fetchedAtUtc === 'string' && cache.fetchedAtUtc.trim() ? cache.fetchedAtUtc : null;

    if (!Number.isFinite(btcUsd) && Number.isFinite(cachedBtcUsd)) {
      btcUsd = cachedBtcUsd;
      sources.btcUsd = 'cache';
    }
    if (!Number.isFinite(stxUsd) && Number.isFinite(cachedStxUsd)) {
      stxUsd = cachedStxUsd;
      sources.stxUsd = 'cache';
    }
    if (!fetchedAtUtc && cachedFetchedAtUtc) {
      fetchedAtUtc = cachedFetchedAtUtc;
    }
  }

  let inputTokenUsd = toFiniteNumber(input.inputTokenUsd);
  if (!Number.isFinite(inputTokenUsd) && isBtcLikeToken(input.inputToken) && Number.isFinite(btcUsd)) {
    inputTokenUsd = btcUsd;
    sources.inputTokenUsd = sources.btcUsd || 'btc_proxy';
  }

  if (!Number.isFinite(outputTokenUsd) && isStableUsdToken(input.outputToken)) {
    outputTokenUsd = 1;
    sources.outputTokenUsd = sources.outputTokenUsd || 'stablecoin_heuristic';
  }

  const impliedInputTokenUsd = deriveImpliedInputTokenUsd(inputTokenUsd, {
    ...input,
    outputTokenUsd,
  });
  if (!Number.isFinite(inputTokenUsd) && Number.isFinite(impliedInputTokenUsd)) {
    inputTokenUsd = impliedInputTokenUsd;
    sources.inputTokenUsd = sources.inputTokenUsd || 'quote_implied';
  }

  if (!Number.isFinite(stxUsd)) {
    stxUsd = 0;
    sources.stxUsd = sources.stxUsd || 'fallback_zero';
    warnings.push('stxUsd fallback applied');
  }

  return {
    complete:
      Number.isFinite(btcUsd) &&
      Number.isFinite(stxUsd) &&
      Number.isFinite(inputTokenUsd) &&
      Number.isFinite(outputTokenUsd),
    btcUsd,
    stxUsd,
    inputTokenUsd,
    outputTokenUsd,
    fetchedAtUtc,
    sources,
    warnings,
  };
}

function computeProfitDiagnostics(input) {
  const inputTokenDecimals = toFiniteNumber(input.inputTokenDecimals);
  const outputTokenDecimals = toFiniteNumber(input.outputTokenDecimals);
  const inputTokenUsd = toFiniteNumber(input.inputTokenUsd);
  const outputTokenUsd = toFiniteNumber(input.outputTokenUsd);
  const stxUsd = toFiniteNumber(input.stxUsd);

  const inputAmountHuman = scaleAtomicToHuman(input.amountIn, inputTokenDecimals);
  const expectedOutputHuman = scaleAtomicToHuman(input.amountOut, outputTokenDecimals);
  const minOutputHuman = scaleAtomicToHuman(input.minAmountOut, outputTokenDecimals);

  const networkFeeMicroStx = toFiniteNumber(input.feeMicroStx, 0);
  const explicitFeeStx = toFiniteNumber(input.feeStx);
  const networkFeeStx =
    Number.isFinite(explicitFeeStx)
      ? explicitFeeStx
      : Number.isFinite(networkFeeMicroStx)
        ? networkFeeMicroStx / 1_000_000
        : null;
  const networkFeeUsd =
    Number.isFinite(networkFeeStx) && Number.isFinite(stxUsd) ? networkFeeStx * stxUsd : null;

  const missingFields = [];
  if (!Number.isFinite(inputTokenDecimals)) missingFields.push('inputTokenDecimals');
  if (!Number.isFinite(outputTokenDecimals)) missingFields.push('outputTokenDecimals');
  if (!Number.isFinite(inputTokenUsd)) missingFields.push('inputTokenUsd');
  if (!Number.isFinite(outputTokenUsd)) missingFields.push('outputTokenUsd');
  if (!Number.isFinite(stxUsd)) missingFields.push('stxUsd');

  const inputUsd =
    Number.isFinite(inputAmountHuman) && Number.isFinite(inputTokenUsd)
      ? inputAmountHuman * inputTokenUsd
      : null;
  const expectedOutputUsd =
    Number.isFinite(expectedOutputHuman) && Number.isFinite(outputTokenUsd)
      ? expectedOutputHuman * outputTokenUsd
      : null;
  const minOutputUsd =
    Number.isFinite(minOutputHuman) && Number.isFinite(outputTokenUsd)
      ? minOutputHuman * outputTokenUsd
      : null;

  const grossProfitUsd =
    Number.isFinite(expectedOutputUsd) && Number.isFinite(inputUsd)
      ? expectedOutputUsd - inputUsd
      : null;
  const worstCaseProfitUsd =
    Number.isFinite(minOutputUsd) && Number.isFinite(inputUsd)
      ? minOutputUsd - inputUsd
      : null;
  const netProfitUsd =
    Number.isFinite(grossProfitUsd) && Number.isFinite(networkFeeUsd)
      ? grossProfitUsd - networkFeeUsd
      : null;
  const worstCaseNetProfitUsd =
    Number.isFinite(worstCaseProfitUsd) && Number.isFinite(networkFeeUsd)
      ? worstCaseProfitUsd - networkFeeUsd
      : null;

  const netProfitBps = ratioToBps(netProfitUsd, inputUsd);
  const worstCaseNetProfitBps = ratioToBps(worstCaseNetProfitUsd, inputUsd);
  const feeAsPercentOfInput = percent(networkFeeUsd, inputUsd);
  const feeAsPercentOfExpectedOutput = percent(networkFeeUsd, expectedOutputUsd);
  const feeAsPercentOfGrossProfit =
    Number.isFinite(networkFeeUsd) && Number.isFinite(grossProfitUsd) && grossProfitUsd !== 0
      ? (networkFeeUsd / Math.abs(grossProfitUsd)) * 100
      : null;

  return {
    complete: missingFields.length === 0,
    missingFields,
    inputTokenDecimals,
    outputTokenDecimals,
    inputTokenUsd,
    outputTokenUsd,
    stxUsd,
    inputAmountHuman,
    expectedOutputHuman,
    minOutputHuman,
    inputUsd,
    expectedOutputUsd,
    minOutputUsd,
    networkFeeMicroStx,
    networkFeeStx,
    networkFeeUsd,
    grossProfitUsd,
    worstCaseProfitUsd,
    netProfitUsd,
    worstCaseNetProfitUsd,
    netProfitBps,
    worstCaseNetProfitBps,
    feeAsPercentOfInput,
    feeAsPercentOfExpectedOutput,
    feeAsPercentOfGrossProfit,
  };
}

module.exports = {
  computeProfitDiagnostics,
  resolveCorePrices,
};
