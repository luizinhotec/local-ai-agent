#!/usr/bin/env node

const {
  readLatestSnapshot,
  readBotState,
  appendEvent,
  LATEST_SNAPSHOT_PATH,
} = require('./lib/deribit-state-store.cjs');
const { loadRiskConfig, evaluateRisk } = require('./lib/deribit-risk.cjs');
const { loadStrategyConfig, decideAction } = require('./lib/deribit-strategy.cjs');
const {
  loadExecutionConfig,
  buildOrderIntent,
  validateExecutionPreflight,
} = require('./lib/deribit-execution.cjs');
const { connectWithRetry } = require('./lib/deribit-client.cjs');

function parseArgs(argv) {
  const flags = {
    execute: false,
    allowProduction: false,
  };

  for (const arg of argv) {
    if (arg === '--execute') {
      flags.execute = true;
      continue;
    }
    if (arg === '--allow-production') {
      flags.allowProduction = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Deribit execute decision

Usage:
  node workspace/deribit/runtime/deribit-execute-decision.cjs
  node workspace/deribit/runtime/deribit-execute-decision.cjs --execute

Behavior:
  default mode is dry-run
  --execute sends the order if preflight passes
  --allow-production overrides the local production execution block
`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return flags;
}

function buildOrderParams(orderIntent) {
  return {
    instrument_name: orderIntent.instrumentName,
    amount: orderIntent.amount,
    type: orderIntent.type,
    price: orderIntent.price,
    label: orderIntent.label,
    post_only: orderIntent.postOnly,
    reduce_only: orderIntent.reduceOnly,
    time_in_force: orderIntent.timeInForce,
  };
}

async function fetchFreshPrivateSnapshot(environment, currency, instrument, clientId, clientSecret) {
  const client = await connectWithRetry({ environment });
  try {
    await client.authenticate(clientId, clientSecret);
    const [instrumentInfo, ticker, accountSummary, position, openOrders] = await Promise.all([
      client.getInstrument(instrument),
      client.getTicker(instrument),
      client.getAccountSummary(currency),
      client.getPosition(instrument).catch(() => ({
        direction: 'flat',
        size: 0,
        total_profit_loss: 0,
        estimated_liquidation_price: null,
      })),
      client.getOpenOrdersByInstrument(instrument).catch(() => []),
    ]);

    const direction = position.direction === 'zero' ? 'flat' : (position.direction || 'flat');
    return {
      snapshotAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      environment,
      instrument,
      currency,
      authEnabled: true,
      bestBid: ticker.best_bid_price ?? null,
      bestAsk: ticker.best_ask_price ?? null,
      markPrice: ticker.mark_price ?? null,
      indexPrice: ticker.index_price ?? null,
      currentFunding: ticker.current_funding ?? null,
      openInterest: ticker.open_interest ?? null,
      tickSize: instrumentInfo.tick_size ?? null,
      minTradeAmount: instrumentInfo.min_trade_amount ?? null,
      contractSize: instrumentInfo.contract_size ?? null,
      accountEquity: accountSummary.equity ?? null,
      availableFunds: accountSummary.available_funds ?? null,
      maintenanceMargin: accountSummary.maintenance_margin ?? null,
      positionDirection: direction,
      positionSizeUsd: position.size ?? 0,
      positionPnl: position.total_profit_loss ?? 0,
      estimatedLiquidationPrice: position.estimated_liquidation_price ?? null,
      openOrderCount: Array.isArray(openOrders) ? openOrders.length : 0,
    };
  } finally {
    client.close();
  }
}

async function executeOrder(snapshot, orderIntent, clientId, clientSecret) {
  const client = await connectWithRetry({ environment: snapshot.environment });
  try {
    await client.authenticate(clientId, clientSecret);
    const params = buildOrderParams(orderIntent);
    if (orderIntent.direction === 'buy') {
      return await client.buy(params);
    }
    return await client.sell(params);
  } finally {
    client.close();
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  let snapshot = readLatestSnapshot();

  const clientId = process.env.DERIBIT_CLIENT_ID || '';
  const clientSecret = process.env.DERIBIT_CLIENT_SECRET || '';
  if (clientId && clientSecret) {
    const baseSnapshot = snapshot || {
      environment: process.env.DERIBIT_ENVIRONMENT || 'testnet',
      currency: process.env.DERIBIT_CURRENCY || 'BTC',
      instrument: process.env.DERIBIT_INSTRUMENT || 'BTC-PERPETUAL',
    };
    snapshot = await fetchFreshPrivateSnapshot(
      baseSnapshot.environment,
      baseSnapshot.currency,
      baseSnapshot.instrument,
      clientId,
      clientSecret
    );
    appendEvent({
      recordedAt: snapshot.snapshotAt,
      type: 'execution_refresh',
      instrument: snapshot.instrument,
      environment: snapshot.environment,
    });
  }

  if (!snapshot) {
    console.error(`no Deribit snapshot found at ${LATEST_SNAPSHOT_PATH}`);
    process.exit(1);
  }

  const riskResult = evaluateRisk(snapshot, loadRiskConfig());
  const strategyConfig = loadStrategyConfig();
  const executionConfig = loadExecutionConfig();
  const decision = decideAction(snapshot, riskResult, strategyConfig, {
    botState: readBotState() || {},
  });
  const preflight = validateExecutionPreflight(
    snapshot,
    riskResult,
    decision,
    executionConfig,
    { allowProduction: flags.allowProduction }
  );
  const orderIntent = buildOrderIntent(snapshot, decision, strategyConfig, executionConfig);

  console.log(`mode: ${flags.execute ? 'execute' : 'dry-run'}`);
  console.log(`decision_action: ${decision.action}`);
  console.log(`decision_mode: ${decision.executionMode}`);

  if (orderIntent.kind !== 'order') {
    console.log(`order_intent: ${orderIntent.kind}`);
    console.log(`reason: ${orderIntent.reason}`);
    process.exit(0);
  }

  console.log(`order_direction: ${orderIntent.direction}`);
  console.log(`order_amount_usd: ${orderIntent.amount}`);
  console.log(`order_price: ${orderIntent.price}`);
  console.log(`post_only: ${orderIntent.postOnly}`);
  console.log(`reduce_only: ${orderIntent.reduceOnly}`);
  console.log(`label: ${orderIntent.label}`);

  if (!preflight.ok) {
    console.log('preflight_errors:');
    for (const error of preflight.errors) {
      console.log(`- ${error}`);
    }
    process.exit(2);
  }

  if (!flags.execute) {
    console.log('dry_run: no order sent');
    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'execution_dry_run',
      action: decision.action,
      orderIntent,
    });
    process.exit(0);
  }

  if (!clientId || !clientSecret) {
    console.error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
    process.exit(3);
  }

  const result = await executeOrder(snapshot, orderIntent, clientId, clientSecret);
  appendEvent({
    recordedAt: new Date().toISOString(),
    type: 'execution_sent',
    action: decision.action,
    orderIntent,
    result,
  });
  console.log('execution_result:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(`[deribit-execute-decision] ${error.message}`);
  process.exit(1);
});
