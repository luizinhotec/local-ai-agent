#!/usr/bin/env node

const { connectWithRetry } = require('./lib/deribit-client.cjs');
const { fetchAndPersistPrivateSnapshot } = require('./lib/deribit-private-snapshot.cjs');

function readConfig() {
  return {
    environment: process.env.DERIBIT_ENVIRONMENT || 'testnet',
    currency: process.env.DERIBIT_CURRENCY || 'BTC',
    instrument: process.env.DERIBIT_INSTRUMENT || 'BTC-PERPETUAL',
    clientId: process.env.DERIBIT_CLIENT_ID || '',
    clientSecret: process.env.DERIBIT_CLIENT_SECRET || '',
  };
}

function formatNumber(value, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }
  return value.toFixed(digits);
}

async function main() {
  const config = readConfig();
  if (!config.clientId || !config.clientSecret) {
    console.error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
    process.exit(1);
  }

  const client = await connectWithRetry({ environment: config.environment });
  try {
    const { snapshot } = await fetchAndPersistPrivateSnapshot(config);
    console.log(`environment: ${snapshot.environment}`);
    console.log(`instrument: ${snapshot.instrument}`);
    console.log(`account_equity: ${formatNumber(snapshot.accountEquity, 6)} ${snapshot.currency}`);
    console.log(`available_funds: ${formatNumber(snapshot.availableFunds, 6)} ${snapshot.currency}`);
    console.log(`position_direction: ${snapshot.positionDirection}`);
    console.log(`position_size_usd: ${formatNumber(snapshot.positionSizeUsd, 0)}`);
    console.log(`open_order_count: ${snapshot.openOrderCount}`);
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(`[deribit-private-sync] ${error.message}`);
  process.exit(1);
});
