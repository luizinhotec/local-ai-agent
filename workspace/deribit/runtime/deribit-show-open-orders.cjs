#!/usr/bin/env node

const {
  readLatestOpenOrders,
  LATEST_OPEN_ORDERS_PATH,
} = require('./lib/deribit-state-store.cjs');

function main() {
  const payload = readLatestOpenOrders();
  if (!payload) {
    console.error(`no open orders snapshot found at ${LATEST_OPEN_ORDERS_PATH}`);
    process.exit(1);
  }

  console.log(`recorded_at: ${payload.recordedAt || 'n/a'}`);
  console.log(`environment: ${payload.environment}`);
  console.log(`instrument: ${payload.instrument}`);
  console.log(`open_order_count: ${Array.isArray(payload.orders) ? payload.orders.length : 0}`);

  for (const order of payload.orders || []) {
    console.log(
      `${order.order_state || 'n/a'} | ${order.direction || 'n/a'} | ${order.price ?? 'n/a'} | ${order.amount ?? 'n/a'} | ${order.label || 'no-label'}`
    );
  }
}

main();
