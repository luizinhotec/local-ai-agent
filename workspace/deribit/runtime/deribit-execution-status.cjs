#!/usr/bin/env node

const {
  readLatestSnapshot,
  readLatestOpenOrders,
  readLatestExecutionAudit,
  LATEST_SNAPSHOT_PATH,
} = require('./lib/deribit-state-store.cjs');

function main() {
  const snapshot = readLatestSnapshot();
  if (!snapshot) {
    console.error(`no Deribit snapshot found at ${LATEST_SNAPSHOT_PATH}`);
    process.exit(1);
  }

  const openOrdersPayload = readLatestOpenOrders();
  const orders = openOrdersPayload?.orders || [];
  const executionAudit = readLatestExecutionAudit();

  console.log(`snapshot_at: ${snapshot.snapshotAt || 'n/a'}`);
  console.log(`environment: ${snapshot.environment}`);
  console.log(`instrument: ${snapshot.instrument}`);
  console.log(`auth: ${snapshot.authEnabled ? 'enabled' : 'public-only'}`);
  console.log(`position_direction: ${snapshot.positionDirection}`);
  console.log(`position_size_usd: ${snapshot.positionSizeUsd}`);
  console.log(`available_funds: ${snapshot.availableFunds ?? 'n/a'} ${snapshot.currency}`);
  console.log(`open_order_count: ${orders.length}`);

  if (executionAudit) {
    console.log(`latest_execution_status: ${executionAudit.status || 'n/a'}`);
    console.log(`latest_execution_label: ${executionAudit.orderLabel || 'n/a'}`);
    console.log(`latest_execution_order_id: ${executionAudit.orderId || 'n/a'}`);
    console.log(`latest_execution_lifecycle_hint: ${executionAudit.lifecycleHint || 'n/a'}`);
    console.log(`latest_execution_filled_amount: ${executionAudit.lastExchangeTradeSummary?.filledAmount ?? 'n/a'}`);
    console.log(`latest_execution_avg_fill_price: ${executionAudit.lastExchangeTradeSummary?.avgFillPrice ?? 'n/a'}`);
  }

  for (const order of orders) {
    console.log(
      `${order.order_state || 'n/a'} | ${order.direction || 'n/a'} | ${order.price ?? 'n/a'} | filled ${order.filled_amount ?? 'n/a'} / ${order.amount ?? 'n/a'} | ${order.label || 'no-label'}`
    );
  }
}

main();
