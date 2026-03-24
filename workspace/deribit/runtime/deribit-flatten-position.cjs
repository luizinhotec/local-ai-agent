#!/usr/bin/env node

const { appendEvent } = require('./lib/deribit-state-store.cjs');
const { fetchAndPersistPrivateSnapshot } = require('./lib/deribit-private-snapshot.cjs');
const { connectWithRetry } = require('./lib/deribit-client.cjs');

function readConfig() {
  return {
    environment: process.env.DERIBIT_ENVIRONMENT || 'testnet',
    currency: process.env.DERIBIT_CURRENCY || 'BTC',
    instrument: process.env.DERIBIT_INSTRUMENT || 'BTC-PERPETUAL',
    clientId: process.env.DERIBIT_CLIENT_ID || '',
    clientSecret: process.env.DERIBIT_CLIENT_SECRET || '',
  };
}

function parseArgs(argv) {
  const flags = { execute: false };
  for (const arg of argv) {
    if (arg === '--execute') {
      flags.execute = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Deribit flatten position

Usage:
  node workspace/deribit/runtime/deribit-flatten-position.cjs
  node workspace/deribit/runtime/deribit-flatten-position.cjs --execute
`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return flags;
}

function buildFlattenOrder(snapshot) {
  const size = Math.abs(snapshot.positionSizeUsd || 0);
  if (!size) {
    return null;
  }

  if (snapshot.positionDirection === 'sell') {
    return {
      direction: 'buy',
      amount: size,
      price: snapshot.bestAsk,
    };
  }

  if (snapshot.positionDirection === 'buy') {
    return {
      direction: 'sell',
      amount: size,
      price: snapshot.bestBid,
    };
  }

  return null;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const config = readConfig();
  if (!config.clientId || !config.clientSecret) {
    console.error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
    process.exit(1);
  }

  const { snapshot } = await fetchAndPersistPrivateSnapshot(config);
  const order = buildFlattenOrder(snapshot);
  if (!order) {
    console.log('no position to flatten');
    return;
  }

  console.log(`flatten_direction: ${order.direction}`);
  console.log(`flatten_amount_usd: ${order.amount}`);
  console.log(`flatten_price: ${order.price}`);

  if (!flags.execute) {
    console.log('dry_run: no flatten order sent');
    return;
  }

  const client = await connectWithRetry({ environment: config.environment });
  try {
    await client.authenticate(config.clientId, config.clientSecret);
    const params = {
      instrument_name: snapshot.instrument,
      amount: order.amount,
      type: 'limit',
      price: order.price,
      post_only: false,
      reduce_only: true,
      time_in_force: 'good_til_cancelled',
      label: `codex-flatten-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    };
    const result =
      order.direction === 'buy'
        ? await client.buy(params)
        : await client.sell(params);

    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'flatten_sent',
      result,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    client.close();
  }

  await fetchAndPersistPrivateSnapshot(config);
}

main().catch(error => {
  console.error(`[deribit-flatten-position] ${error.message}`);
  process.exit(1);
});
