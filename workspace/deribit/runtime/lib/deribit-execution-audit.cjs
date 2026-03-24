const {
  readLatestExecutionAudit,
  writeLatestExecutionAudit,
  appendEvent,
} = require('./deribit-state-store.cjs');

function nowIso() {
  return new Date().toISOString();
}

function cloneHistory(history, transition) {
  const nextHistory = Array.isArray(history) ? [...history] : [];
  nextHistory.push(transition);
  return nextHistory;
}

function summarizeOrder(order) {
  if (!order) {
    return null;
  }
  return {
    orderId: order.order_id || null,
    label: order.label || null,
    state: order.order_state || null,
    price: typeof order.price === 'number' ? order.price : null,
    amount: typeof order.amount === 'number' ? order.amount : null,
    filledAmount: typeof order.filled_amount === 'number' ? order.filled_amount : 0,
    averagePrice: typeof order.average_price === 'number' ? order.average_price : null,
    direction: order.direction || null,
    reduceOnly: Boolean(order.reduce_only),
    postOnly: Boolean(order.post_only),
    timeInForce: order.time_in_force || null,
    creationTimestamp: typeof order.creation_timestamp === 'number' ? order.creation_timestamp : null,
    lastUpdateTimestamp: typeof order.last_update_timestamp === 'number' ? order.last_update_timestamp : null,
    rejectPostOnly: Boolean(order.reject_post_only),
  };
}

function summarizeTrades(trades) {
  const safeTrades = Array.isArray(trades) ? trades : [];
  const totals = safeTrades.reduce(
    (acc, trade) => {
      const amount = Number(trade?.amount || 0);
      const price = Number(trade?.price || 0);
      const fee = Number(trade?.fee || 0);
      const pnl = Number(trade?.profit_loss || 0);
      acc.filledAmount += amount;
      acc.fees += fee;
      acc.realizedPnl += pnl;
      acc.weightedPrice += amount * price;
      acc.maxTradeSeq = Math.max(acc.maxTradeSeq, Number(trade?.trade_seq || 0));
      return acc;
    },
    { filledAmount: 0, fees: 0, realizedPnl: 0, weightedPrice: 0, maxTradeSeq: 0 }
  );

  return {
    trades: safeTrades,
    filledAmount: totals.filledAmount,
    fees: Number(totals.fees.toFixed(8)),
    realizedPnl: Number(totals.realizedPnl.toFixed(8)),
    avgFillPrice:
      totals.filledAmount > 0 ? Number((totals.weightedPrice / totals.filledAmount).toFixed(2)) : null,
    lastTradeSeq: totals.maxTradeSeq || null,
  };
}

function lifecycleStatusFromOrderState(orderState, filledAmount, amount) {
  const normalizedState = String(orderState || '').toLowerCase();
  const safeFilled = Number(filledAmount || 0);
  const safeAmount = Number(amount || 0);

  if (normalizedState === 'rejected') {
    return 'rejected';
  }
  if (normalizedState === 'cancelled') {
    return 'cancelled';
  }
  if (normalizedState === 'filled') {
    return 'filled';
  }
  if (safeFilled > 0 && safeAmount > safeFilled) {
    return 'partially_filled';
  }
  if (normalizedState === 'open' || normalizedState === 'untriggered') {
    return 'open';
  }
  return 'accepted';
}

function createExecutionAudit({ cycleId, orderIntent, snapshotContext, source = 'bot-loop' }) {
  const createdAt = nowIso();
  const audit = {
    cycleId: cycleId || null,
    source,
    createdAt,
    updatedAt: createdAt,
    status: 'intent_created',
    orderId: null,
    orderLabel: orderIntent?.label || null,
    orderIntent,
    reduceOnly: Boolean(orderIntent?.reduceOnly),
    lifecycleHint: orderIntent?.lifecycleHint || 'entry',
    direction: orderIntent?.direction || null,
    instrumentName: orderIntent?.instrumentName || null,
    intendedAmount: Number(orderIntent?.amount || 0),
    intendedPrice: typeof orderIntent?.price === 'number' ? orderIntent.price : null,
    snapshotContext: snapshotContext || null,
    lastExchangeOrder: null,
    lastExchangeTradeSummary: {
      filledAmount: 0,
      fees: 0,
      realizedPnl: 0,
      avgFillPrice: null,
      lastTradeSeq: null,
    },
    history: [
      {
        at: createdAt,
        status: 'intent_created',
        note: 'order intent created',
      },
    ],
  };
  writeLatestExecutionAudit(audit);
  appendEvent({
    recordedAt: createdAt,
    type: 'execution_lifecycle',
    summary: {
      cycleId: audit.cycleId,
      status: audit.status,
      orderLabel: audit.orderLabel,
      orderId: audit.orderId,
      note: 'order intent created',
    },
  });
  return audit;
}

function transitionExecutionAudit(audit, status, patch = {}) {
  const transitionAt = patch.transitionAt || nowIso();
  const sameStatus = audit?.status === status;
  const sameOrderId =
    typeof patch.orderId === 'undefined' || patch.orderId === audit?.orderId;
  const sameNote = (patch.note || null) === null;
  if (sameStatus && sameOrderId && sameNote) {
    const mergedAudit = {
      ...(audit || {}),
      ...patch,
      updatedAt: transitionAt,
      status,
    };
    writeLatestExecutionAudit(mergedAudit);
    return mergedAudit;
  }
  const nextAudit = {
    ...(audit || {}),
    ...patch,
    updatedAt: transitionAt,
    status,
    history: cloneHistory(audit?.history, {
      at: transitionAt,
      status,
      note: patch.note || null,
    }),
  };
  writeLatestExecutionAudit(nextAudit);
  appendEvent({
    recordedAt: transitionAt,
    type: 'execution_lifecycle',
    summary: {
      cycleId: nextAudit.cycleId || null,
      status,
      orderLabel: nextAudit.orderLabel || null,
      orderId: nextAudit.orderId || null,
      note: patch.note || null,
    },
  });
  return nextAudit;
}

function inferAuditFromExchange(audit, reconciliation, recentTrades) {
  if (!audit?.orderLabel && !audit?.orderId) {
    return audit;
  }

  const matchingOpenOrder = (reconciliation?.openOrdersExchange || []).find(order => {
    return (
      (audit.orderId && order.orderId === audit.orderId) ||
      (audit.orderLabel && order.label === audit.orderLabel)
    );
  });
  const matchingTrades = (recentTrades || []).filter(trade => {
    return (
      (audit.orderId && trade.order_id === audit.orderId) ||
      (audit.orderLabel && trade.label === audit.orderLabel)
    );
  });
  const tradeSummary = summarizeTrades(matchingTrades);

  if (matchingOpenOrder) {
    const nextStatus = lifecycleStatusFromOrderState(
      matchingOpenOrder.state,
      matchingOpenOrder.filledAmount,
      matchingOpenOrder.amount
    );
    return transitionExecutionAudit(audit, nextStatus, {
      orderId: matchingOpenOrder.orderId || audit.orderId,
      lastExchangeOrder: matchingOpenOrder,
      lastExchangeTradeSummary: tradeSummary,
      openAt: nextStatus === 'open' && !audit.openAt ? nowIso() : audit.openAt || null,
      partiallyFilledAt:
        nextStatus === 'partially_filled' && !audit.partiallyFilledAt
          ? nowIso()
          : audit.partiallyFilledAt || null,
      note: 'execution lifecycle updated from exchange open orders',
    });
  }

  if (tradeSummary.filledAmount > 0) {
    const nextStatus =
      tradeSummary.filledAmount >= Number(audit.intendedAmount || 0) ? 'filled' : 'partially_filled';
    return transitionExecutionAudit(audit, nextStatus, {
      lastExchangeTradeSummary: tradeSummary,
      filledAt: nextStatus === 'filled' && !audit.filledAt ? nowIso() : audit.filledAt || null,
      partiallyFilledAt:
        nextStatus === 'partially_filled' && !audit.partiallyFilledAt
          ? nowIso()
          : audit.partiallyFilledAt || null,
      note: 'execution lifecycle updated from exchange trades',
    });
  }

  return audit;
}

function applyExchangeOrderToAudit(audit, order, recentTrades = [], note = 'execution lifecycle updated from exchange order state') {
  if (!audit || !order) {
    return audit;
  }

  const summarizedOrder = summarizeOrder(order);
  const tradeSummary = summarizeTrades(recentTrades);
  const nextStatus = lifecycleStatusFromOrderState(
    summarizedOrder?.state,
    summarizedOrder?.filledAmount,
    summarizedOrder?.amount
  );
  const transitionAt = nowIso();

  return transitionExecutionAudit(audit, nextStatus, {
    transitionAt,
    acceptedAt:
      ['accepted', 'open', 'partially_filled', 'filled', 'cancelled', 'rejected'].includes(nextStatus)
        ? audit.acceptedAt || transitionAt
        : audit.acceptedAt || null,
    orderId: summarizedOrder?.orderId || audit.orderId || null,
    orderLabel: summarizedOrder?.label || audit.orderLabel || null,
    lastExchangeOrder: summarizedOrder,
    lastExchangeTradeSummary: tradeSummary,
    openAt:
      nextStatus === 'open' && !audit.openAt ? transitionAt : audit.openAt || null,
    partiallyFilledAt:
      nextStatus === 'partially_filled' && !audit.partiallyFilledAt
        ? transitionAt
        : audit.partiallyFilledAt || null,
    filledAt:
      nextStatus === 'filled' && !audit.filledAt ? transitionAt : audit.filledAt || null,
    cancelledAt:
      nextStatus === 'cancelled' && !audit.cancelledAt ? transitionAt : audit.cancelledAt || null,
    rejectedAt:
      nextStatus === 'rejected' && !audit.rejectedAt ? transitionAt : audit.rejectedAt || null,
    note,
  });
}

function readOrCreateExecutionAudit(context) {
  const existing = readLatestExecutionAudit();
  if (
    existing &&
    existing.orderLabel &&
    context?.orderIntent?.label &&
    existing.orderLabel === context.orderIntent.label
  ) {
    return existing;
  }
  return createExecutionAudit(context);
}

module.exports = {
  summarizeOrder,
  summarizeTrades,
  lifecycleStatusFromOrderState,
  createExecutionAudit,
  transitionExecutionAudit,
  inferAuditFromExchange,
  applyExchangeOrderToAudit,
  readOrCreateExecutionAudit,
};
