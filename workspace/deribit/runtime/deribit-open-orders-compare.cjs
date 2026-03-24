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
  };
}

function parseArgs(argv) {
  const config = {
    ...readBaseConfig(),
    orderId: '',
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      console.log(`Deribit open orders compare

Usage:
  node workspace/deribit/runtime/deribit-open-orders-compare.cjs --order-id=<ID>
  node workspace/deribit/runtime/deribit-open-orders-compare.cjs --order-id=<ID> --instrument=BTC-PERPETUAL
`);
      process.exit(0);
    }

    if (!arg.startsWith('--')) {
      throw new Error(`unknown argument: ${arg}`);
    }

    const [key, value] = arg.slice(2).split('=');
    if (!value) {
      throw new Error(`missing value for --${key}`);
    }

    if (key === 'order-id') {
      config.orderId = value;
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

function summarizeOrder(order) {
  if (!order) {
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
    web: Boolean(order.web),
    api: Boolean(order.api),
  };
}

function summarizeSample(orders) {
  return (orders || []).slice(0, 5).map(summarizeOrder);
}

function buildEndpointResult(name, params, rawResult, targetOrderId) {
  const orders = normalizeOrders(rawResult);
  const matchedOrder =
    orders.find(order => String(order?.order_id || '') === String(targetOrderId)) || null;

  return {
    name,
    params,
    count: orders.length,
    containsTargetOrder: Boolean(matchedOrder),
    matchedOrder: summarizeOrder(matchedOrder),
    sample: summarizeSample(orders),
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (!config.clientId || !config.clientSecret) {
    console.error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
    process.exit(1);
  }
  if (!config.orderId) {
    console.error('missing --order-id');
    process.exit(1);
  }

  const client = await connectWithRetry({ environment: config.environment });
  try {
    await client.authenticate(config.clientId, config.clientSecret);

    const orderStateParams = { order_id: config.orderId };
    const byInstrumentParams = { instrument_name: config.instrument, type: 'all' };
    const byCurrencyParams = { currency: config.currency, kind: 'future', type: 'all' };
    const getOpenOrdersParams = {};

    const [orderState, byInstrument, byCurrency, allOpenOrders] = await Promise.all([
      client.getOrderState(config.orderId).catch(error => ({ __error: error.message })),
      client.getOpenOrdersByInstrument(config.instrument).catch(error => ({ __error: error.message })),
      client.getOpenOrdersByCurrency(config.currency, 'future', 'all').catch(error => ({ __error: error.message })),
      client.getOpenOrders().catch(error => ({ __error: error.message })),
    ]);

    const orderStateSummary = orderState?.__error
      ? {
          found: false,
          error: orderState.__error,
          order: null,
        }
      : {
          found: true,
          error: null,
          order: summarizeOrder(orderState),
        };

    const endpointResults = [
      buildEndpointResult('get_open_orders_by_instrument', byInstrumentParams, byInstrument, config.orderId),
      buildEndpointResult('get_open_orders_by_currency', byCurrencyParams, byCurrency, config.orderId),
      buildEndpointResult('get_open_orders', getOpenOrdersParams, allOpenOrders, config.orderId),
    ];

    console.log(`environment: ${config.environment}`);
    console.log(`instrument: ${config.instrument}`);
    console.log(`currency: ${config.currency}`);
    console.log(`order_id: ${config.orderId}`);
    console.log(`order_state_lookup_params: ${JSON.stringify(orderStateParams)}`);
    if (orderStateSummary.found) {
      console.log(`order_state_found: true`);
      console.log(`order_state: ${orderStateSummary.order?.order_state || 'n/a'}`);
      console.log(`order_state_summary: ${JSON.stringify(orderStateSummary.order)}`);
    } else {
      console.log(`order_state_found: false`);
      console.log(`order_state_error: ${orderStateSummary.error}`);
    }

    for (const endpoint of endpointResults) {
      console.log('');
      console.log(`endpoint: ${endpoint.name}`);
      console.log(`params: ${JSON.stringify(endpoint.params)}`);
      console.log(`count: ${endpoint.count}`);
      console.log(`contains_target_order: ${endpoint.containsTargetOrder}`);
      console.log(`matched_order: ${JSON.stringify(endpoint.matchedOrder)}`);
      console.log(`sample: ${JSON.stringify(endpoint.sample)}`);
    }

    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'open_orders_compare',
      summary: {
        environment: config.environment,
        instrument: config.instrument,
        currency: config.currency,
        orderId: config.orderId,
        orderStateParams,
        orderState: orderStateSummary,
        endpoints: endpointResults,
      },
    });
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(`[deribit-open-orders-compare] ${error.message}`);
  process.exit(1);
});
