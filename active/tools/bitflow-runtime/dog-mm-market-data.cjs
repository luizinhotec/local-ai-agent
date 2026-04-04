'use strict';

const {
  getPrice,
  getAllPrices,
  getStacksHolders,
  getWhaleAlerts,
  getHealth,
} = require('./dogdata-client.cjs');

const WHALE_ALERT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const WHALE_THRESHOLD_DOG = 1_000_000;
const SPREAD_UNFAVORABLE_PCT = 2.0;

/**
 * Returns a unified market snapshot with prices, spread, whale alerts, and holder count.
 */
async function getMarketSnapshot() {
  const [krakenResult, bitflowResult, gateioResult, allPrices, holdersResult, whalesResult] =
    await Promise.allSettled([
      getPrice('kraken'),
      getPrice('bitflow'),
      getPrice('gateio'),
      getAllPrices(),
      getStacksHolders(),
      getWhaleAlerts('stacks', WHALE_THRESHOLD_DOG),
    ]);

  const kraken = krakenResult.status === 'fulfilled' ? krakenResult.value : { price: null };
  const bitflow = bitflowResult.status === 'fulfilled' ? bitflowResult.value : { price: null };
  const gateio = gateioResult.status === 'fulfilled' ? gateioResult.value : { price: null };
  const markets = allPrices.status === 'fulfilled' ? allPrices.value : { spreadPct: null, marketCount: 0 };
  const holders = holdersResult.status === 'fulfilled' ? holdersResult.value : { holderCount: null };
  const whales = whalesResult.status === 'fulfilled' ? whalesResult.value : { totalAlerts: 0, alerts: [] };

  // Whale alerts within last 2 hours
  const now = Date.now();
  const recentWhales = (whales.alerts || []).filter(a => {
    if (!a.timestamp && !a.created_at) return true; // include if no timestamp
    const ts = a.timestamp || a.created_at;
    return now - new Date(ts).getTime() < WHALE_ALERT_WINDOW_MS;
  });

  return {
    price_kraken: kraken.price,
    price_bitflow: bitflow.price,
    price_gateio: gateio.price,
    spread_pct: markets.spreadPct,
    market_count: markets.marketCount,
    whale_alert_recent_count: recentWhales.length,
    whale_alerts_recent: recentWhales.slice(0, 5),
    stacks_holders_count: holders.holderCount,
    errors: [
      kraken.error ? `kraken: ${kraken.error}` : null,
      bitflow.error ? `bitflow: ${bitflow.error}` : null,
      gateio.error ? `gateio: ${gateio.error}` : null,
      markets.error ? `markets: ${markets.error}` : null,
      holders.error ? `holders: ${holders.error}` : null,
      whales.error ? `whales: ${whales.error}` : null,
    ].filter(Boolean),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Returns whether market conditions are favorable for MM activity.
 */
async function isMarketFavorable() {
  const snapshot = await getMarketSnapshot();

  // Check spread
  if (snapshot.spread_pct !== null && snapshot.spread_pct < SPREAD_UNFAVORABLE_PCT) {
    return {
      favorable: false,
      reason: `spread_too_low: ${snapshot.spread_pct?.toFixed(4)}% (threshold: ${SPREAD_UNFAVORABLE_PCT}%)`,
      snapshot,
    };
  }

  // Check recent whale activity
  if (snapshot.whale_alert_recent_count > 0) {
    return {
      favorable: false,
      reason: `whale_alert_recent: ${snapshot.whale_alert_recent_count} alert(s) in last 2h on Stacks`,
      snapshot,
    };
  }

  return {
    favorable: true,
    reason: 'spread and whale conditions nominal',
    snapshot,
  };
}

/**
 * Returns a formatted message suitable for Telegram.
 */
async function formatTelegramReport() {
  const result = await isMarketFavorable();
  const s = result.snapshot;

  const priceLines = [
    s.price_bitflow != null ? `  Bitflow: $${s.price_bitflow.toFixed(8)}` : null,
    s.price_kraken != null ? `  Kraken:  $${s.price_kraken.toFixed(8)}` : null,
    s.price_gateio != null ? `  Gate.io: $${s.price_gateio.toFixed(8)}` : null,
  ].filter(Boolean).join('\n');

  const spreadLine = s.spread_pct != null
    ? `Spread (high-low): ${s.spread_pct.toFixed(4)}%`
    : 'Spread: n/a';

  const whaleLine = `Whale alerts (Stacks, 2h): ${s.whale_alert_recent_count}`;
  const holdersLine = s.stacks_holders_count != null
    ? `Stacks holders: ${s.stacks_holders_count}`
    : 'Stacks holders: n/a';

  const favorableLine = result.favorable
    ? '✅ Mercado FAVORAVEL'
    : `⛔ Mercado DESFAVORAVEL\nMotivo: ${result.reason}`;

  const errorSection = s.errors.length > 0
    ? `\nAvisos:\n${s.errors.map(e => `  - ${e}`).join('\n')}`
    : '';

  const ts = new Date(s.timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return [
    '📊 DOG MM - Market Snapshot',
    `🕐 ${ts}`,
    '',
    'Precos DOG:',
    priceLines,
    '',
    spreadLine,
    whaleLine,
    holdersLine,
    '',
    favorableLine,
    errorSection,
  ].join('\n');
}

module.exports = {
  getMarketSnapshot,
  isMarketFavorable,
  formatTelegramReport,
};

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const isReport = args.includes('--report');
  const isJson = args.includes('--json');

  (async () => {
    if (isReport) {
      const msg = await formatTelegramReport();
      console.log(msg);
      if (isJson) {
        const result = await isMarketFavorable();
        process.stdout.write('\n--- JSON ---\n');
        console.log(JSON.stringify(result, null, 2));
      }
    } else {
      const snapshot = await getMarketSnapshot();
      console.log(JSON.stringify(snapshot, null, 2));
    }
  })();
}
