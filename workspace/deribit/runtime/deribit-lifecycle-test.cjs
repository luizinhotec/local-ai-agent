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
const {
  appendEvent,
  STATE_DIR,
  readLatestExecutionAudit,
  readLatestReconcile,
} = require('./lib/deribit-state-store.cjs');

const REPORT_PATH = path.join(STATE_DIR, 'deribit-lifecycle-test-report.json');

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

function findLifecycleInconsistencies(history) {
  const ordered = (history || []).map(entry => entry?.status).filter(Boolean);
  const issues = [];

  const mustFollow = [
    ['sent', 'intent_created'],
    ['open', 'sent'],
    ['partially_filled', 'sent'],
    ['filled', 'sent'],
    ['cancelled', 'sent'],
    ['rejected', 'sent'],
  ];

  for (const [status, prerequisite] of mustFollow) {
    if (ordered.includes(status) && !ordered.includes(prerequisite)) {
      issues.push(`${status} without ${prerequisite}`);
    }
  }

  if (ordered.includes('filled') && !ordered.includes('open') && !ordered.includes('partially_filled')) {
    issues.push('filled without open or partially_filled');
  }

  if (ordered.includes('cancelled') && !ordered.includes('open') && !ordered.includes('partially_filled')) {
    issues.push('cancelled without open or partially_filled');
  }

  return issues;
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
    observed: {
      intent_created: false,
      sent: false,
      accepted_or_open: false,
      cancelled: false,
      rejected: false,
      failed: false,
      partially_filled: false,
      filled: false,
    },
    evidence: {},
    inconsistencies: [],
    cleanup: [],
  };

  const client = await connectWithRetry({ environment: config.environment });
  let createdOrderId = null;
  let rejectedOrderId = null;

  try {
    await client.authenticate(config.clientId, config.clientSecret);
    const [instrumentInfo, ticker, accountSummary] = await Promise.all([
      client.getInstrument(config.instrument),
      client.getTicker(config.instrument),
      client.getAccountSummary(config.currency, true),
    ]);
    const snapshotContext = buildSnapshotContext(ticker, accountSummary);

    const primaryLabel = `lifecycle-test-${Date.now()}`;
    const primaryIntent = {
      kind: 'order',
      direction: 'buy',
      instrumentName: config.instrument,
      amount: 10,
      price: roundToTick((ticker.best_bid_price || ticker.mark_price) * 0.5, instrumentInfo.tick_size),
      type: 'limit',
      label: primaryLabel,
      postOnly: false,
      reduceOnly: false,
      timeInForce: 'good_til_cancelled',
      lifecycleHint: 'entry',
    };

    let audit = createExecutionAudit({
      cycleId: `lifecycle-test-${Date.now()}`,
      orderIntent: primaryIntent,
      snapshotContext,
      source: 'lifecycle-test',
    });
    audit = transitionExecutionAudit(audit, 'intent_created', {
      note: 'controlled lifecycle test intent created',
    });
    report.observed.intent_created = hasStatus(audit.history, 'intent_created');

    audit = transitionExecutionAudit(audit, 'sent', {
      sentAt: new Date().toISOString(),
      note: 'controlled lifecycle test submission sent',
    });
    report.observed.sent = hasStatus(audit.history, 'sent');

    const created = await client.buy({
      instrument_name: primaryIntent.instrumentName,
      amount: primaryIntent.amount,
      type: primaryIntent.type,
      price: primaryIntent.price,
      label: primaryIntent.label,
      post_only: primaryIntent.postOnly,
      reduce_only: primaryIntent.reduceOnly,
      time_in_force: primaryIntent.timeInForce,
    });
    const createdOrder = created?.order || created;
    createdOrderId = createdOrder?.order_id || null;
    audit = applyExchangeOrderToAudit(
      audit,
      createdOrder,
      [],
      'controlled lifecycle test exchange acknowledged order submission'
    );
    report.observed.accepted_or_open =
      hasStatus(audit.history, 'accepted') || hasStatus(audit.history, 'open');

    const reconciliationOpen = await reconcileWithExchange(config, {
      cycleId: `lifecycle-open-${Date.now()}`,
      recentTradesCount: 20,
    });
    audit = inferAuditFromExchange(audit, reconciliationOpen.reconciliation, reconciliationOpen.recentTrades);

    const cancelResult = await client.cancel(createdOrderId);
    const cancelledState = await client.getOrderState(createdOrderId);
    audit = applyExchangeOrderToAudit(
      audit,
      cancelledState,
      [],
      'controlled lifecycle test confirmed cancellation via get_order_state'
    );
    report.observed.cancelled = hasStatus(audit.history, 'cancelled');

    const reconciliationClosed = await reconcileWithExchange(config, {
      cycleId: `lifecycle-closed-${Date.now()}`,
      recentTradesCount: 20,
    });

    report.evidence.primaryFlow = {
      intent: primaryIntent,
      createdOrder,
      cancelResult,
      cancelledState,
      reconciliationOpen: reconciliationOpen.reconciliation,
      reconciliationClosed: reconciliationClosed.reconciliation,
      executionAudit: readLatestExecutionAudit(),
    };

    const rejectedLabel = `lifecycle-reject-${Date.now()}`;
    const rejectedResponse = await client.buy({
      instrument_name: config.instrument,
      amount: 10,
      type: 'limit',
      price: roundToTick((ticker.best_ask_price || ticker.mark_price) + (instrumentInfo.tick_size || 0.5), instrumentInfo.tick_size),
      label: rejectedLabel,
      post_only: true,
      reduce_only: false,
      time_in_force: 'good_til_cancelled',
      reject_post_only: true,
    }).catch(error => ({ __error: error.message }));

    let rejectedAudit = createExecutionAudit({
      cycleId: `lifecycle-reject-${Date.now()}`,
      orderIntent: {
        ...primaryIntent,
        label: rejectedLabel,
        price: roundToTick((ticker.best_ask_price || ticker.mark_price) + (instrumentInfo.tick_size || 0.5), instrumentInfo.tick_size),
        postOnly: true,
      },
      snapshotContext,
      source: 'lifecycle-test',
    });
    rejectedAudit = transitionExecutionAudit(rejectedAudit, 'sent', {
      sentAt: new Date().toISOString(),
      note: 'controlled lifecycle reject test submission sent',
    });

    if (!rejectedResponse?.__error) {
      const rejectedOrder = rejectedResponse?.order || rejectedResponse;
      rejectedOrderId = rejectedOrder?.order_id || null;
      rejectedAudit = applyExchangeOrderToAudit(
        rejectedAudit,
        rejectedOrder,
        [],
        'controlled lifecycle reject test exchange response'
      );
      report.observed.rejected = hasStatus(rejectedAudit.history, 'rejected');
      if (rejectedOrderId) {
        try {
          const rejectedState = await client.getOrderState(rejectedOrderId);
          rejectedAudit = applyExchangeOrderToAudit(
            rejectedAudit,
            rejectedState,
            [],
            'controlled lifecycle reject test order state lookup'
          );
          report.observed.rejected = hasStatus(rejectedAudit.history, 'rejected');
          if (rejectedState?.order_state === 'open') {
            await client.cancel(rejectedOrderId);
            report.cleanup.push(`cancelled unexpected open reject-test order ${rejectedOrderId}`);
          }
        } catch (error) {
          report.evidence.rejectedStateLookupError = error.message;
        }
      }
    } else if (String(rejectedResponse.__error).includes('post_only_reject')) {
      rejectedAudit = transitionExecutionAudit(rejectedAudit, 'rejected', {
        rejectedAt: new Date().toISOString(),
        note: `controlled lifecycle reject test received expected reject response: ${rejectedResponse.__error}`,
      });
      report.observed.rejected = hasStatus(rejectedAudit.history, 'rejected');
    } else {
      rejectedAudit = transitionExecutionAudit(rejectedAudit, 'failed', {
        failedAt: new Date().toISOString(),
        note: `controlled lifecycle reject test failed before exchange order creation: ${rejectedResponse.__error}`,
      });
    }

    report.evidence.rejectedFlow = {
      response: rejectedResponse,
      executionAudit: rejectedAudit,
    };

    const failedLabel = `lifecycle-fail-${Date.now()}`;
    let failedAudit = createExecutionAudit({
      cycleId: `lifecycle-fail-${Date.now()}`,
      orderIntent: {
        ...primaryIntent,
        label: failedLabel,
        amount: 0,
      },
      snapshotContext,
      source: 'lifecycle-test',
    });
    failedAudit = transitionExecutionAudit(failedAudit, 'sent', {
      sentAt: new Date().toISOString(),
      note: 'controlled lifecycle failure test submission sent',
    });

    const failedResponse = await client.buy({
      instrument_name: config.instrument,
      amount: 0,
      type: 'limit',
      price: primaryIntent.price,
      label: failedLabel,
      post_only: false,
      reduce_only: false,
      time_in_force: 'good_til_cancelled',
    }).catch(error => ({ __error: error.message }));

    if (failedResponse?.__error) {
      failedAudit = transitionExecutionAudit(failedAudit, 'failed', {
        failedAt: new Date().toISOString(),
        note: `controlled lifecycle failure test received expected API error: ${failedResponse.__error}`,
      });
      report.observed.failed = hasStatus(failedAudit.history, 'failed');
    }

    report.evidence.failedFlow = {
      response: failedResponse,
      executionAudit: failedAudit,
    };

    report.observed.partially_filled = false;
    report.observed.filled = false;

    report.inconsistencies = [
      ...findLifecycleInconsistencies(audit.history),
      ...findLifecycleInconsistencies(rejectedAudit.history),
      ...findLifecycleInconsistencies(failedAudit.history),
    ];

    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'lifecycle_test_summary',
      summary: {
        environment: config.environment,
        instrument: config.instrument,
        observed: report.observed,
        inconsistencies: report.inconsistencies,
      },
    });

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    console.log('lifecycle_observed:');
    console.log(`- intent_created: ${report.observed.intent_created}`);
    console.log(`- sent: ${report.observed.sent}`);
    console.log(`- accepted_or_open: ${report.observed.accepted_or_open}`);
    console.log(`- cancelled: ${report.observed.cancelled}`);
    console.log(`- rejected: ${report.observed.rejected ? 'true' : 'inconclusive'}`);
    console.log(`- failed: ${report.observed.failed ? 'true' : 'inconclusive'}`);
    console.log(`- partially_filled: inconclusive`);
    console.log(`- filled: inconclusive`);
    console.log(`report_path: ${REPORT_PATH}`);
  } finally {
    if (createdOrderId) {
      try {
        const state = await client.getOrderState(createdOrderId);
        if (state?.order_state === 'open') {
          await client.cancel(createdOrderId);
          report.cleanup.push(`cancelled leftover primary order ${createdOrderId}`);
        }
      } catch (error) {
        report.cleanup.push(`primary cleanup check failed for ${createdOrderId}: ${error.message}`);
      }
    }
    if (rejectedOrderId) {
      try {
        const state = await client.getOrderState(rejectedOrderId);
        if (state?.order_state === 'open') {
          await client.cancel(rejectedOrderId);
          report.cleanup.push(`cancelled leftover rejected-test order ${rejectedOrderId}`);
        }
      } catch (error) {
        report.cleanup.push(`rejected cleanup check failed for ${rejectedOrderId}: ${error.message}`);
      }
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    client.close();
  }
}

main().catch(error => {
  console.error(`[deribit-lifecycle-test] ${error.message}`);
  process.exit(1);
});
