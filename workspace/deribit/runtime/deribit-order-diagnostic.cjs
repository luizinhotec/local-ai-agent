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
  const base = readBaseConfig();
  const config = {
    ...base,
    orderId: '',
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      console.log(`Deribit order diagnostic

Usage:
  node workspace/deribit/runtime/deribit-order-diagnostic.cjs --order-id=<ID>
  node workspace/deribit/runtime/deribit-order-diagnostic.cjs --order-id=<ID> --instrument=BTC-PERPETUAL
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
    cancel_reason: order.cancel_reason || null,
    raw: {
      average_price: typeof order.average_price === 'number' ? order.average_price : null,
      post_only: Boolean(order.post_only),
      replaced: Boolean(order.replaced),
      risk_reducing: Boolean(order.risk_reducing),
      is_liquidation: Boolean(order.is_liquidation),
      contracts: typeof order.contracts === 'number' ? order.contracts : null,
    },
  };
}

function summarizeTrades(trades) {
  return (trades || []).slice(0, 10).map(trade => ({
    trade_seq: typeof trade?.trade_seq === 'number' ? trade.trade_seq : null,
    trade_id: trade?.trade_id || null,
    order_id: trade?.order_id || null,
    instrument_name: trade?.instrument_name || null,
    direction: trade?.direction || null,
    price: typeof trade?.price === 'number' ? trade.price : null,
    amount: typeof trade?.amount === 'number' ? trade.amount : null,
    fee: typeof trade?.fee === 'number' ? trade.fee : null,
    profit_loss: typeof trade?.profit_loss === 'number' ? trade.profit_loss : null,
    timestamp: typeof trade?.timestamp === 'number' ? trade.timestamp : null,
  }));
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

    let order = null;
    let orderLookupError = null;
    try {
      order = await client.getOrderState(config.orderId);
    } catch (error) {
      orderLookupError = error;
    }

    const history = await client
      .getOrderHistoryByInstrument(config.instrument, 20, true, true)
      .catch(() => []);
    const matchedHistoryOrder =
      (history || []).find(entry => String(entry?.order_id || '') === String(config.orderId)) || null;
    const trades = await client.getUserTradesByOrder(config.orderId, true, 'desc').catch(() => []);

    const normalizedOrder = summarizeOrder(order || matchedHistoryOrder);
    const result = {
      environment: config.environment,
      instrument: config.instrument,
      order_id: config.orderId,
      found_by_order_state: Boolean(order),
      found_in_order_history: Boolean(matchedHistoryOrder),
      order_lookup_error: orderLookupError ? orderLookupError.message : null,
      normalized_order: normalizedOrder,
      trades_count: Array.isArray(trades) ? trades.length : 0,
      trades: summarizeTrades(Array.isArray(trades) ? trades : []),
    };

    if (normalizedOrder) {
      console.log(`environment: ${result.environment}`);
      console.log(`instrument: ${result.instrument}`);
      console.log(`order_id: ${result.order_id}`);
      console.log(`found_by_order_state: ${result.found_by_order_state}`);
      console.log(`found_in_order_history: ${result.found_in_order_history}`);
      console.log(`order_state: ${normalizedOrder.order_state || 'n/a'}`);
      console.log(`direction: ${normalizedOrder.direction || 'n/a'}`);
      console.log(`price: ${normalizedOrder.price ?? 'n/a'}`);
      console.log(`amount: ${normalizedOrder.amount ?? 'n/a'}`);
      console.log(`filled_amount: ${normalizedOrder.filled_amount ?? 'n/a'}`);
      console.log(`reduce_only: ${normalizedOrder.reduce_only}`);
      console.log(`label: ${normalizedOrder.label || 'n/a'}`);
      console.log(`creation_timestamp: ${normalizedOrder.creation_timestamp ?? 'n/a'}`);
      console.log(`last_update_timestamp: ${normalizedOrder.last_update_timestamp ?? 'n/a'}`);
      console.log(`raw_response_summary: ${JSON.stringify(normalizedOrder.raw)}`);
    } else {
      console.log(`environment: ${result.environment}`);
      console.log(`instrument: ${result.instrument}`);
      console.log(`order_id: ${result.order_id}`);
      console.log('order_found: false');
      console.log(
        `lookup_result: ${result.order_lookup_error ? `not found or not visible (${result.order_lookup_error})` : 'not found'}`
      );
    }

    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'order_diagnostic',
      summary: result,
    });
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(`[deribit-order-diagnostic] ${error.message}`);
  process.exit(1);
});
