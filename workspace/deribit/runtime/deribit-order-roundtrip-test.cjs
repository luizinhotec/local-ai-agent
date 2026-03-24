#!/usr/bin/env node

const { connectWithRetry } = require('./lib/deribit-client.cjs');
const { appendEvent } = require('./lib/deribit-state-store.cjs');

function readBaseConfig() {
  return {
    environment: process.env.DERIBIT_ENVIRONMENT || 'testnet',
    currency: process.env.DERIBIT_CURRENCY || 'BTC',
    instrument: process.env.DERIBIT_INSTRUMENT || 'BTC-PERPETUAL',
    clientId: process.env.DERIBIT_CLIENT_ID || '',
    clientSecret: process.env.DERIBIT_CLIENT_SECRET || '',
    direction: 'buy',
    amount: 10,
    cancelAtEnd: true,
  };
}

function parseArgs(argv) {
  const config = readBaseConfig();

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      console.log(`Deribit order roundtrip test

Usage:
  node workspace/deribit/runtime/deribit-order-roundtrip-test.cjs
  node workspace/deribit/runtime/deribit-order-roundtrip-test.cjs --direction=buy --amount=10
  node workspace/deribit/runtime/deribit-order-roundtrip-test.cjs --direction=sell --no-cancel
`);
      process.exit(0);
    }

    if (arg === '--no-cancel') {
      config.cancelAtEnd = false;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`unknown argument: ${arg}`);
    }

    const [key, value] = arg.slice(2).split('=');
    if (!value) {
      throw new Error(`missing value for --${key}`);
    }

    if (key === 'direction') {
      if (!['buy', 'sell'].includes(value)) {
        throw new Error('direction must be buy or sell');
      }
      config.direction = value;
      continue;
    }

    if (key === 'amount') {
      config.amount = Number(value);
      continue;
    }

    if (key === 'instrument') {
      config.instrument = value;
      continue;
    }

    throw new Error(`unknown argument: --${key}`);
  }

  return config;
}

function normalizeOrders(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result?.orders)) {
    return result.orders;
  }
  return [];
}

function roundToTick(value, tickSize) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (typeof tickSize !== 'number' || !Number.isFinite(tickSize) || tickSize <= 0) {
    return Number(value.toFixed(2));
  }
  const rounded = Math.round(value / tickSize) * tickSize;
  const tickDecimals = Math.max(0, String(tickSize).split('.')[1]?.length || 0);
  return Number(rounded.toFixed(tickDecimals));
}

function summarizeOrder(order) {
  if (!order || typeof order !== 'object') {
    return null;
  }
  return {
    order_id: order.order_id || null,
    instrument_name: order.instrument_name || null,
    order_state: order.order_state || null,
    direction: order.direction || null,
    price: typeof order.price === 'number' ? order.price : null,
    amount: typeof order.amount === 'number' ? order.amount : null,
    filled_amount: typeof order.filled_amount === 'number' ? order.filled_amount : 0,
    reduce_only: Boolean(order.reduce_only),
    label: order.label || null,
    creation_timestamp:
      typeof order.creation_timestamp === 'number' ? order.creation_timestamp : null,
    last_update_timestamp:
      typeof order.last_update_timestamp === 'number' ? order.last_update_timestamp : null,
    order_type: order.order_type || null,
    time_in_force: order.time_in_force || null,
    web: Boolean(order.web),
    api: Boolean(order.api),
  };
}

function summarizeSample(orders) {
  return (orders || []).slice(0, 5).map(summarizeOrder);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (!config.clientId || !config.clientSecret) {
    console.error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
    process.exit(1);
  }
  if (!Number.isFinite(config.amount) || config.amount <= 0) {
    console.error('amount must be a positive number');
    process.exit(1);
  }

  const client = await connectWithRetry({ environment: config.environment });
  try {
    await client.authenticate(config.clientId, config.clientSecret);

    const [instrumentInfo, ticker] = await Promise.all([
      client.getInstrument(config.instrument),
      client.getTicker(config.instrument),
    ]);

    const bestBid = typeof ticker?.best_bid_price === 'number' ? ticker.best_bid_price : null;
    const bestAsk = typeof ticker?.best_ask_price === 'number' ? ticker.best_ask_price : null;
    if (config.direction === 'buy' && bestBid === null) {
      throw new Error('bestBid unavailable');
    }
    if (config.direction === 'sell' && bestAsk === null) {
      throw new Error('bestAsk unavailable');
    }

    const basePrice = config.direction === 'buy' ? bestBid * 0.5 : bestAsk * 1.5;
    const price = roundToTick(basePrice, instrumentInfo?.tick_size);
    const label = `roundtrip-${Date.now()}`;
    const orderParams = {
      instrument_name: config.instrument,
      amount: config.amount,
      type: 'limit',
      price,
      label,
      post_only: false,
      reduce_only: false,
      time_in_force: 'good_til_cancelled',
    };

    const createdOrder =
      config.direction === 'buy'
        ? await client.buy(orderParams)
        : await client.sell(orderParams);

    const orderId = createdOrder?.order?.order_id || createdOrder?.order_id || null;
    if (!orderId) {
      throw new Error('order creation did not return order_id');
    }

    const [orderState, byInstrument, byCurrency, allOpenOrders] = await Promise.all([
      client.getOrderState(orderId).catch(error => ({ __error: error.message })),
      client.getOpenOrdersByInstrument(config.instrument).catch(error => ({ __error: error.message })),
      client.getOpenOrdersByCurrency(config.currency, 'future', 'all').catch(error => ({ __error: error.message })),
      client.getOpenOrders().catch(error => ({ __error: error.message })),
    ]);

    const byInstrumentOrders = normalizeOrders(byInstrument);
    const byCurrencyOrders = normalizeOrders(byCurrency);
    const allOrders = normalizeOrders(allOpenOrders);

    const byInstrumentContains = byInstrumentOrders.some(order => String(order?.order_id || '') === String(orderId));
    const byCurrencyContains = byCurrencyOrders.some(order => String(order?.order_id || '') === String(orderId));
    const allOrdersContains = allOrders.some(order => String(order?.order_id || '') === String(orderId));
    const visibleInOrderState = !orderState?.__error;
    const visibleInOpenOrders = byInstrumentContains || byCurrencyContains || allOrdersContains;
    const orderStateValue = orderState?.order_state || null;
    const possibleInconsistency =
      visibleInOrderState &&
      orderStateValue === 'open' &&
      !visibleInOpenOrders;

    let cancelResult = null;
    if (config.cancelAtEnd && visibleInOrderState && orderStateValue === 'open') {
      cancelResult = await client.cancel(orderId).catch(error => ({ __error: error.message }));
    }

    console.log('=== ORDER CREATED ===');
    console.log(`order_id: ${orderId}`);
    console.log(`price: ${price}`);
    console.log(`direction: ${config.direction}`);
    console.log(`label: ${label}`);
    console.log(`response: ${JSON.stringify(summarizeOrder(createdOrder?.order || createdOrder))}`);

    console.log('');
    console.log('=== ORDER STATE ===');
    console.log(`state: ${orderState?.order_state || (orderState?.__error ? 'lookup_error' : 'n/a')}`);
    console.log(`filled_amount: ${orderState?.filled_amount ?? 'n/a'}`);
    console.log(`summary: ${JSON.stringify(orderState?.__error ? { error: orderState.__error } : summarizeOrder(orderState))}`);

    console.log('');
    console.log('=== OPEN ORDERS CHECK ===');
    console.log(`byInstrument_count: ${byInstrumentOrders.length}`);
    console.log(`byInstrument_contains: ${byInstrumentContains}`);
    console.log(`byInstrument_sample: ${JSON.stringify(summarizeSample(byInstrumentOrders))}`);
    console.log(`byCurrency_count: ${byCurrencyOrders.length}`);
    console.log(`byCurrency_contains: ${byCurrencyContains}`);
    console.log(`byCurrency_sample: ${JSON.stringify(summarizeSample(byCurrencyOrders))}`);
    console.log(`allOrders_count: ${allOrders.length}`);
    console.log(`allOrders_contains: ${allOrdersContains}`);
    console.log(`allOrders_sample: ${JSON.stringify(summarizeSample(allOrders))}`);

    console.log('');
    console.log('=== FINAL DIAGNOSIS ===');
    console.log(`visible_in_order_state: ${visibleInOrderState}`);
    console.log(`visible_in_open_orders: ${visibleInOpenOrders}`);
    console.log(`possible_inconsistency: ${possibleInconsistency}`);
    console.log(`cancel_attempted: ${Boolean(config.cancelAtEnd)}`);
    console.log(`cancel_result: ${JSON.stringify(cancelResult)}`);

    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'order_roundtrip_test',
      summary: {
        environment: config.environment,
        currency: config.currency,
        instrument: config.instrument,
        direction: config.direction,
        amount: config.amount,
        orderId,
        price,
        label,
        orderState: orderState?.__error ? { error: orderState.__error } : summarizeOrder(orderState),
        byInstrument: {
          count: byInstrumentOrders.length,
          contains: byInstrumentContains,
          sample: summarizeSample(byInstrumentOrders),
        },
        byCurrency: {
          count: byCurrencyOrders.length,
          contains: byCurrencyContains,
          sample: summarizeSample(byCurrencyOrders),
        },
        allOrders: {
          count: allOrders.length,
          contains: allOrdersContains,
          sample: summarizeSample(allOrders),
        },
        visibleInOrderState,
        visibleInOpenOrders,
        possibleInconsistency,
        cancelResult,
      },
    });
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(`[deribit-order-roundtrip-test] ${error.message}`);
  process.exit(1);
});
