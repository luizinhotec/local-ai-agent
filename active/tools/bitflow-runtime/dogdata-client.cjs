'use strict';

const BASE_URL = 'https://www.dogdata.xyz';
const TIMEOUT_MS = 10000;

function buildHeaders(apiKey) {
  const headers = { 'User-Agent': 'local-ai-agent/dog-mm-agent' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return headers;
}

async function fetchJson(path, apiKey) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: buildHeaders(apiKey),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`dogdata HTTP ${res.status} for ${path}`);
  }
  return res.json();
}

function getApiKey() {
  return process.env.DOGDATA_API_KEY || null;
}

/**
 * Returns DOG price in USD from a specific exchange.
 * exchange: 'kraken' | 'bitflow' | 'gateio' | 'mexc' | 'bitget'
 */
async function getPrice(exchange) {
  const apiKey = getApiKey();
  try {
    const data = await fetchJson(`/api/price/${exchange}`, apiKey);
    if (exchange === 'kraken') {
      const ticker = data.result?.DOGUSD;
      if (!ticker) throw new Error('kraken: missing DOGUSD field');
      return {
        exchange: 'kraken',
        price: parseFloat(ticker.c[0]),
        price24hAvg: parseFloat(ticker.p[0]),
        high24h: parseFloat(ticker.h[1]),
        low24h: parseFloat(ticker.l[1]),
        timestamp: data.timestamp || new Date().toISOString(),
      };
    }
    return {
      exchange,
      price: parseFloat(data.price),
      change24h: data.change24h ?? null,
      volume24h: data.volume24h ?? data.volume ?? null,
      cached: data.cached ?? null,
      timestamp: data.timestamp || new Date().toISOString(),
    };
  } catch (err) {
    return { exchange, price: null, error: err.message };
  }
}

/**
 * Returns prices from all markets + spread between highest and lowest.
 */
async function getAllPrices() {
  const apiKey = getApiKey();
  try {
    const data = await fetchJson('/api/markets', apiKey);
    const tickers = data.tickers || [];
    const prices = tickers.map(t => ({
      market: t.market,
      pair: t.pair,
      price: t.price,
      volumeUsd: t.volumeUsd,
      spread: t.spread,
      trustScore: t.trustScore,
    }));
    const validPrices = prices.filter(p => typeof p.price === 'number' && p.price > 0);
    const high = validPrices.length ? Math.max(...validPrices.map(p => p.price)) : null;
    const low = validPrices.length ? Math.min(...validPrices.map(p => p.price)) : null;
    const spreadPct = (high && low) ? ((high - low) / low) * 100 : null;
    return {
      markets: prices,
      highPrice: high,
      lowPrice: low,
      spreadPct,
      marketCount: prices.length,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return { markets: [], highPrice: null, lowPrice: null, spreadPct: null, error: err.message };
  }
}

/**
 * Returns DOG holder count and top holders on Stacks.
 */
async function getStacksHolders() {
  const apiKey = getApiKey();
  try {
    const data = await fetchJson('/api/multichain/holders?chain=stacks', apiKey);
    const holders = data.stacks?.holders || [];
    return {
      chain: 'stacks',
      holderCount: holders.length,
      holders: holders.slice(0, 10),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return { chain: 'stacks', holderCount: null, holders: [], error: err.message };
  }
}

/**
 * Returns historical Stacks snapshots.
 * days: 7 | 30 | 'latest'
 */
async function getStacksHistory(days) {
  const apiKey = getApiKey();
  const param = days === 'latest' ? 'latest=true' : `days=${days}`;
  try {
    const data = await fetchJson(`/api/stacks/history?${param}`, apiKey);
    return { ok: data.ok !== false, data, timestamp: new Date().toISOString() };
  } catch (err) {
    return { ok: false, data: null, error: err.message };
  }
}

/**
 * Returns whale alerts.
 * chain: 'stacks' | 'bitcoin' | 'solana' | null (all)
 * threshold: minimum DOG amount (default 1_000_000)
 */
async function getWhaleAlerts(chain, threshold) {
  const apiKey = getApiKey();
  const params = new URLSearchParams();
  if (chain) params.set('chain', chain);
  if (threshold) params.set('threshold', String(threshold));
  params.set('limit', '20');
  try {
    const data = await fetchJson(`/api/whale-alerts?${params}`, apiKey);
    return {
      chain: chain || 'all',
      threshold: data.threshold_raw ?? threshold ?? 1000000,
      totalAlerts: data.total_alerts ?? 0,
      alerts: data.alerts || [],
      dogPriceUsd: data.dog_price_usd ?? null,
      timestamp: data.timestamp || new Date().toISOString(),
    };
  } catch (err) {
    return { chain, totalAlerts: 0, alerts: [], error: err.message };
  }
}

/**
 * Returns general token market stats.
 */
async function getMarketStats() {
  const apiKey = getApiKey();
  try {
    const data = await fetchJson('/api/dog-rune/stats', apiKey);
    return { ok: true, stats: data, timestamp: new Date().toISOString() };
  } catch (err) {
    return { ok: false, stats: null, error: err.message };
  }
}

/**
 * Returns API health status.
 */
async function getHealth() {
  try {
    const data = await fetchJson('/api/health', null);
    return { ok: data.status === 'healthy', status: data.status, details: data, timestamp: data.timestamp };
  } catch (err) {
    return { ok: false, status: 'unreachable', error: err.message };
  }
}

module.exports = {
  getPrice,
  getAllPrices,
  getStacksHolders,
  getStacksHistory,
  getWhaleAlerts,
  getMarketStats,
  getHealth,
};

// CLI self-test
if (require.main === module) {
  (async () => {
    console.log('=== dogdata-client self-test ===\n');

    const health = await getHealth();
    console.log('health:', JSON.stringify(health, null, 2));

    const kraken = await getPrice('kraken');
    console.log('\nkraken:', JSON.stringify(kraken, null, 2));

    const bitflow = await getPrice('bitflow');
    console.log('\nbitflow:', JSON.stringify(bitflow, null, 2));

    const gateio = await getPrice('gateio');
    console.log('\ngateio:', JSON.stringify(gateio, null, 2));

    const all = await getAllPrices();
    console.log('\nall_prices spread_pct:', all.spreadPct?.toFixed(4), 'markets:', all.marketCount);

    const holders = await getStacksHolders();
    console.log('\nstacks_holders count:', holders.holderCount);

    const whales = await getWhaleAlerts('stacks', 1000000);
    console.log('\nwhale_alerts stacks:', whales.totalAlerts);
  })();
}
