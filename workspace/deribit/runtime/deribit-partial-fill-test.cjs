#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { connectWithRetry } = require('./lib/deribit-client.cjs');
const { reconcileWithExchange } = require('./lib/deribit-reconcile.cjs');
const {
  createExecutionAudit,
  transitionExecutionAudit,
  inferAuditFromExchange,
  applyExchangeOrderToAudit,
} = require('./lib/deribit-execution-audit.cjs');
const { appendEvent, STATE_DIR } = require('./lib/deribit-state-store.cjs');

const REPORT_PATH = path.join(STATE_DIR, 'deribit-partial-fill-report.json');

function readConfig() {
  return {
    environment: process.env.DERIBIT_ENVIRONMENT || 'testnet',
    currency: process.env.DERIBIT_CURRENCY || 'BTC',
    instrument: process.env.DERIBIT_INSTRUMENT || 'BTC-PERPETUAL',
    clientId: process.env.DERIBIT_CLIENT_ID || '',
    clientSecret: process.env.DERIBIT_CLIENT_SECRET || '',
  };
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

function buildSnapshotContext(ticker, accountSummary) {
  return {
    bestBid: ticker?.best_bid_price ?? null,
    bestAsk: ticker?.best_ask_price ?? null,
    markPrice: ticker?.mark_price ?? null,
    indexPrice: ticker?.index_price ?? null,
    currentFunding: ticker?.current_funding ?? null,
    accountEquity: accountSummary?.equity ?? null,
    availableFunds: accountSummary?.available_funds ?? null,
    positionDirection: 'flat',
    positionSizeUsd: 0,
    positionPnlBtc: 0,
  };
}

function hasStatus(history, status) {
  return (history || []).some(entry => entry?.status === status);
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
    web: Boolean(order.web),
    api: Boolean(order.api),
  };
}

async function waitForOrderState(client, orderId, predicate, timeoutMs = 10000, pollMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await client.getOrderState(orderId).catch(() => null);
    if (lastState && predicate(lastState)) {
      return lastState;
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  return lastState;
}

async function flattenPosition(client, config) {
  const position = await client.getPosition(config.instrument).catch(() => null);
  const size = Number(position?.size || 0);
  const direction = position?.direction || 'flat';
  if (!size || direction === 'flat' || direction === 'zero') {
    return {
      flattened: false,
      position,
      result: null,
      finalState: position,
    };
  }

  const ticker = await client.getTicker(config.instrument);
  const flattenDirection = direction === 'buy' ? 'sell' : 'buy';
  const price =
    flattenDirection === 'sell'
      ? roundToTick(ticker.best_bid_price || ticker.mark_price, 0.5)
      : roundToTick(ticker.best_ask_price || ticker.mark_price, 0.5);

  const params = {
    instrument_name: config.instrument,
    amount: size,
    type: 'limit',
    price,
    post_only: false,
    reduce_only: true,
    time_in_force: 'good_til_cancelled',
    label: `flatten-${Date.now()}`,
  };

  const result =
    flattenDirection === 'sell'
      ? await client.sell(params)
      : await client.buy(params);

  const orderId = result?.order?.order_id || result?.order_id || null;
  let finalState = await client.getPosition(config.instrument).catch(() => null);
  if (orderId) {
    await waitForOrderState(client, orderId, order => {
      return ['filled', 'cancelled'].includes(String(order?.order_state || '').toLowerCase());
    }, 10000, 250);
    finalState = await client.getPosition(config.instrument).catch(() => null);
    const openOrders = await client.getOpenOrdersByInstrument(config.instrument).catch(() => []);
    const openFlatten = (openOrders || []).find(order => order.order_id === orderId);
    if (openFlatten) {
      await client.cancel(orderId).catch(() => null);
      finalState = await client.getPosition(config.instrument).catch(() => null);
    }
  }

  return {
    flattened: true,
    position,
    result,
    finalState,
  };
}

async function main() {
  const config = readConfig();
  if (!config.clientId || !config.clientSecret) {
    console.error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
    process.exit(1);
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });

  const report = {
    startedAt: new Date().toISOString(),
    environment: config.environment,
    instrument: config.instrument,
    partial: {
      observed: {
        intent_created: false,
        sent: false,
        open: false,
        partially_filled: false,
        cancelled: false,
      },
      evidence: {},
      cleanup: [],
    },
    filled: {
      observed: {
        intent_created: false,
        sent: false,
        filled: false,
      },
      evidence: {},
      cleanup: [],
    },
  };

  const client = await connectWithRetry({ environment: config.environment });
  let partialOrderId = null;
  let fillOrderId = null;

  try {
    await client.authenticate(config.clientId, config.clientSecret);
    const [instrumentInfo, ticker, accountSummary] = await Promise.all([
      client.getInstrument(config.instrument),
      client.getTicker(config.instrument),
      client.getAccountSummary(config.currency, true),
    ]);
    const snapshotContext = buildSnapshotContext(ticker, accountSummary);
    const book = await client.call('public/get_order_book', {
      instrument_name: config.instrument,
      depth: 5,
    });

    const bestAskLevel = Array.isArray(book?.asks) && book.asks.length > 0 ? book.asks[0] : null;
    if (!bestAskLevel) {
      throw new Error('order book ask side unavailable');
    }

    const partialPrice = Number(bestAskLevel[0]);
    const partialTopAmount = Number(bestAskLevel[1] || 0);
    const partialAttempts = [];
    let partialAudit = null;
    let partialCreatedOrder = null;
    let partialState = null;
    let partialReconcile = null;
    let partialCancelResult = null;
    let partialCancelledState = null;
    let partialFlatten = null;

    for (const multiplier of [2, 4, 8]) {
      const partialAmount = partialTopAmount * multiplier + 10;
      const partialLabel = `partial-test-${Date.now()}-${multiplier}`;
      const partialIntent = {
        kind: 'order',
        direction: 'buy',
        instrumentName: config.instrument,
        amount: partialAmount,
        price: partialPrice,
        type: 'limit',
        label: partialLabel,
        postOnly: false,
        reduceOnly: false,
        timeInForce: 'good_til_cancelled',
        lifecycleHint: 'entry',
      };

      partialAudit = createExecutionAudit({
        cycleId: `partial-test-${Date.now()}-${multiplier}`,
        orderIntent: partialIntent,
        snapshotContext,
        source: 'partial-fill-test',
      });
      partialAudit = transitionExecutionAudit(partialAudit, 'intent_created', {
        note: 'controlled partial fill test intent created',
      });
      partialAudit = transitionExecutionAudit(partialAudit, 'sent', {
        sentAt: new Date().toISOString(),
        note: 'controlled partial fill test submission sent',
      });

      const created = await client.buy({
        instrument_name: partialIntent.instrumentName,
        amount: partialIntent.amount,
        type: partialIntent.type,
        price: partialIntent.price,
        label: partialIntent.label,
        post_only: partialIntent.postOnly,
        reduce_only: partialIntent.reduceOnly,
        time_in_force: partialIntent.timeInForce,
      }).catch(error => ({ __error: error.message }));

      if (created?.__error) {
        partialAttempts.push({
          multiplier,
          intent: partialIntent,
          error: created.__error,
        });
        continue;
      }

      partialCreatedOrder = created?.order || created;
      partialOrderId = partialCreatedOrder?.order_id || null;
      partialAudit = transitionExecutionAudit(partialAudit, 'open', {
        orderId: partialCreatedOrder?.order_id || null,
        orderLabel: partialCreatedOrder?.label || partialIntent.label,
        openAt: new Date().toISOString(),
        note: 'controlled partial fill test exchange accepted open order',
      });

      partialState = await waitForOrderState(
        client,
        partialOrderId,
        order => Number(order?.filled_amount || 0) > 0,
        12000,
        250
      );
      partialAudit = applyExchangeOrderToAudit(
        partialAudit,
        partialState || partialCreatedOrder,
        [],
        'controlled partial fill test order state update'
      );

      partialReconcile = await reconcileWithExchange(config, {
        cycleId: `partial-open-${Date.now()}`,
        recentTradesCount: 20,
      });
      partialAudit = inferAuditFromExchange(
        partialAudit,
        partialReconcile.reconciliation,
        partialReconcile.recentTrades
      );

      const isPartial =
        Number(partialState?.filled_amount || 0) > 0 &&
        Number(partialState?.filled_amount || 0) < Number(partialState?.amount || 0);

      partialAttempts.push({
        multiplier,
        intent: partialIntent,
        createdOrder: partialCreatedOrder,
        partialState,
        isPartial,
      });

      if (isPartial) {
        partialCancelResult = await client.cancel(partialOrderId).catch(error => ({ __error: error.message }));
        partialCancelledState = await client.getOrderState(partialOrderId).catch(() => null);
        if (partialCancelledState) {
          partialAudit = applyExchangeOrderToAudit(
            partialAudit,
            partialCancelledState,
            [],
            'controlled partial fill test confirmed cancellation via get_order_state'
          );
        }
        break;
      }

      partialFlatten = await flattenPosition(client, config);
      partialOrderId = null;
    }

    report.partial.observed.intent_created = hasStatus(partialAudit?.history, 'intent_created');
    report.partial.observed.sent = hasStatus(partialAudit?.history, 'sent');
    report.partial.observed.open = hasStatus(partialAudit?.history, 'open');
    report.partial.observed.partially_filled = hasStatus(partialAudit?.history, 'partially_filled');
    report.partial.observed.cancelled = hasStatus(partialAudit?.history, 'cancelled');

    if (!report.partial.observed.partially_filled) {
      throw new Error('partial fill test did not reach partially_filled state within configured attempts');
    }

    partialFlatten = await flattenPosition(client, config);
    report.partial.evidence = {
      orderBookTopAsk: bestAskLevel,
      attempts: partialAttempts,
      partialState,
      reconcile: partialReconcile?.reconciliation || null,
      cancelResult: partialCancelResult,
      cancelledState: partialCancelledState,
      executionAudit: partialAudit,
      flatten: partialFlatten,
    };

    const fillLabel = `fill-test-${Date.now()}`;
    const fillIntent = {
      kind: 'order',
      direction: 'buy',
      instrumentName: config.instrument,
      amount: 10,
      price: Number(bestAskLevel[0]),
      type: 'limit',
      label: fillLabel,
      postOnly: false,
      reduceOnly: false,
      timeInForce: 'good_til_cancelled',
      lifecycleHint: 'entry',
    };

    let fillAudit = createExecutionAudit({
      cycleId: `fill-test-${Date.now()}`,
      orderIntent: fillIntent,
      snapshotContext,
      source: 'partial-fill-test',
    });
    fillAudit = transitionExecutionAudit(fillAudit, 'intent_created', {
      note: 'controlled filled test intent created',
    });
    report.filled.observed.intent_created = hasStatus(fillAudit.history, 'intent_created');

    fillAudit = transitionExecutionAudit(fillAudit, 'sent', {
      sentAt: new Date().toISOString(),
      note: 'controlled filled test submission sent',
    });
    report.filled.observed.sent = hasStatus(fillAudit.history, 'sent');

    const fillCreated = await client.buy({
      instrument_name: fillIntent.instrumentName,
      amount: fillIntent.amount,
      type: fillIntent.type,
      price: fillIntent.price,
      label: fillIntent.label,
      post_only: fillIntent.postOnly,
      reduce_only: fillIntent.reduceOnly,
      time_in_force: fillIntent.timeInForce,
    });
    const fillCreatedOrder = fillCreated?.order || fillCreated;
    fillOrderId = fillCreatedOrder?.order_id || null;

    const filledState = await waitForOrderState(
      client,
      fillOrderId,
      order => String(order?.order_state || '').toLowerCase() === 'filled',
      12000,
      250
    );
    if (!filledState) {
      throw new Error('filled test did not reach filled state within timeout');
    }
    const fillTrades = await client.getUserTradesByOrder(fillOrderId, true, 'desc').catch(() => []);
    fillAudit = applyExchangeOrderToAudit(
      fillAudit,
      filledState,
      Array.isArray(fillTrades) ? fillTrades : [],
      'controlled filled test confirmed fill via get_order_state'
    );
    report.filled.observed.filled = hasStatus(fillAudit.history, 'filled');

    const filledFlatten = await flattenPosition(client, config);
    report.filled.evidence = {
      intent: fillIntent,
      createdOrder: fillCreatedOrder,
      filledState,
      trades: fillTrades,
      executionAudit: fillAudit,
      flatten: filledFlatten,
    };

    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'partial_fill_test_summary',
      summary: {
        environment: config.environment,
        instrument: config.instrument,
        partialObserved: report.partial.observed,
        filledObserved: report.filled.observed,
      },
    });
  } finally {
    if (partialOrderId) {
      try {
        const state = await client.getOrderState(partialOrderId).catch(() => null);
        if (state?.order_state === 'open') {
          await client.cancel(partialOrderId).catch(() => null);
          report.partial.cleanup.push(`cancelled leftover partial order ${partialOrderId}`);
        }
      } catch (error) {
        report.partial.cleanup.push(`partial cleanup check failed for ${partialOrderId}: ${error.message}`);
      }
    }

    if (fillOrderId) {
      try {
        const state = await client.getOrderState(fillOrderId).catch(() => null);
        if (state?.order_state === 'open') {
          await client.cancel(fillOrderId).catch(() => null);
          report.filled.cleanup.push(`cancelled leftover fill order ${fillOrderId}`);
        }
      } catch (error) {
        report.filled.cleanup.push(`filled cleanup check failed for ${fillOrderId}: ${error.message}`);
      }
    }

    try {
      const cleanupFlatten = await flattenPosition(client, config);
      if (cleanupFlatten.flattened) {
        report.partial.cleanup.push('post-test flatten executed');
      }
    } catch (error) {
      report.partial.cleanup.push(`post-test flatten failed: ${error.message}`);
    }

    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    client.close();
  }

  console.log(`partial_report: ${REPORT_PATH}`);
  console.log(`partial_lifecycle: ${JSON.stringify(report.partial.observed)}`);
  console.log(`filled_lifecycle: ${JSON.stringify(report.filled.observed)}`);
}

main().catch(error => {
  console.error(`[deribit-partial-fill-test] ${error.message}`);
  process.exit(1);
});
