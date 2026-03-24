#!/usr/bin/env node

const { appendEvent, readLatestOpenOrders } = require('./lib/deribit-state-store.cjs');
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
      console.log(`Deribit cancel open orders

Usage:
  node workspace/deribit/runtime/deribit-cancel-open-orders.cjs
  node workspace/deribit/runtime/deribit-cancel-open-orders.cjs --execute
`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const config = readConfig();
  if (!config.clientId || !config.clientSecret) {
    console.error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
    process.exit(1);
  }

  const { openOrders } = await fetchAndPersistPrivateSnapshot(config);
  console.log(`open_order_count: ${openOrders.length}`);
  if (openOrders.length === 0) {
    console.log('nothing to cancel');
    return;
  }

  for (const order of openOrders) {
    console.log(`${order.order_id} | ${order.direction} | ${order.price} | ${order.amount} | ${order.label || 'no-label'}`);
  }

  if (!flags.execute) {
    console.log('dry_run: no orders cancelled');
    return;
  }

  const client = await connectWithRetry({ environment: config.environment });
  try {
    await client.authenticate(config.clientId, config.clientSecret);
    for (const order of openOrders) {
      const result = await client.cancel(order.order_id);
      appendEvent({
        recordedAt: new Date().toISOString(),
        type: 'cancel_order',
        orderId: order.order_id,
        label: order.label || '',
        result,
      });
      console.log(`cancelled: ${order.order_id}`);
    }
  } finally {
    client.close();
  }

  await fetchAndPersistPrivateSnapshot(config);
}

main().catch(error => {
  console.error(`[deribit-cancel-open-orders] ${error.message}`);
  process.exit(1);
});
