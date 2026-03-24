const {
  readLatestSnapshot,
  readLatestOpenOrders,
  readBotMetrics,
  writeLatestReconcile,
  writeLatestTrades,
  appendEvent,
} = require('./deribit-state-store.cjs');
const { fetchAndPersistPrivateSnapshot } = require('./deribit-private-snapshot.cjs');

function normalizePositionFromSnapshot(snapshot) {
  return {
    instrument: snapshot?.instrument || null,
    direction: snapshot?.positionDirection || 'flat',
    sizeUsd: Number(snapshot?.positionSizeUsd || 0),
    averagePrice:
      typeof snapshot?.positionAveragePrice === 'number' ? snapshot.positionAveragePrice : null,
    floatingPnl:
      typeof snapshot?.positionFloatingPnl === 'number' ? snapshot.positionFloatingPnl : null,
    realizedPnl:
      typeof snapshot?.positionRealizedPnl === 'number' ? snapshot.positionRealizedPnl : null,
    totalPnl: typeof snapshot?.positionPnl === 'number' ? snapshot.positionPnl : null,
  };
}

function summarizeOrder(order) {
  return {
    orderId: order?.order_id || null,
    label: order?.label || null,
    instrument: order?.instrument_name || null,
    direction: order?.direction || null,
    amount: typeof order?.amount === 'number' ? order.amount : null,
    filledAmount: typeof order?.filled_amount === 'number' ? order.filled_amount : 0,
    price: typeof order?.price === 'number' ? order.price : null,
    state: order?.order_state || null,
    reduceOnly: Boolean(order?.reduce_only),
    postOnly: Boolean(order?.post_only),
    creationTimestamp: typeof order?.creation_timestamp === 'number' ? order.creation_timestamp : null,
  };
}

function summarizeOrders(orders) {
  return (orders || []).map(summarizeOrder);
}

function buildOrderKey(order) {
  return [
    order?.instrument || order?.instrument_name || '',
    order?.direction || '',
    Boolean(order?.reduceOnly ?? order?.reduce_only),
    Number(order?.amount ?? 0),
    Number(order?.price ?? 0),
    order?.label || '',
  ].join('|');
}

function compareOrders(localOrders, exchangeOrders) {
  const localKeys = new Set((localOrders || []).map(buildOrderKey));
  const exchangeKeys = new Set((exchangeOrders || []).map(buildOrderKey));

  if (localKeys.size !== exchangeKeys.size) {
    return true;
  }

  for (const key of exchangeKeys) {
    if (!localKeys.has(key)) {
      return true;
    }
  }

  return false;
}

function detectPartialFill(openOrdersExchange) {
  return (openOrdersExchange || []).some(order => {
    const filledAmount = Number(order?.filledAmount ?? order?.filled_amount ?? 0);
    const totalAmount = Number(order?.amount ?? 0);
    return filledAmount > 0 && totalAmount > filledAmount;
  });
}

function summarizeTrades(trades, lastReconciledTradeSeq) {
  const sortedTrades = [...(trades || [])].sort(
    (left, right) => Number(right.trade_seq || 0) - Number(left.trade_seq || 0)
  );
  const newTrades = sortedTrades.filter(
    trade => Number(trade?.trade_seq || 0) > Number(lastReconciledTradeSeq || 0)
  );
  const aggregate = newTrades.reduce(
    (acc, trade) => {
      const amount = Number(trade?.amount || 0);
      const price = Number(trade?.price || 0);
      const fee = Number(trade?.fee || 0);
      const realizedPnl = Number(trade?.profit_loss || 0);
      acc.realizedPnl += realizedPnl;
      acc.fees += fee;
      acc.filledAmount += amount;
      acc.weightedPrice += amount * price;
      acc.maxTradeSeq = Math.max(acc.maxTradeSeq, Number(trade?.trade_seq || 0));
      return acc;
    },
    {
      realizedPnl: 0,
      fees: 0,
      filledAmount: 0,
      weightedPrice: 0,
      maxTradeSeq: Number(lastReconciledTradeSeq || 0),
    }
  );

  return {
    trades: sortedTrades,
    newTrades,
    lastTradeSeq: aggregate.maxTradeSeq,
    realizedPnl: Number(aggregate.realizedPnl.toFixed(8)),
    fees: Number(aggregate.fees.toFixed(8)),
    filledAmount: aggregate.filledAmount,
    avgFillPrice:
      aggregate.filledAmount > 0
        ? Number((aggregate.weightedPrice / aggregate.filledAmount).toFixed(2))
        : null,
  };
}

function buildDivergence(localPositionBefore, exchangePosition, openOrdersLocal, openOrdersExchange, tradeSummary) {
  const divergenceType = [];
  const localFlat = Math.abs(Number(localPositionBefore?.sizeUsd || 0)) === 0;
  const exchangeFlat = Math.abs(Number(exchangePosition?.sizeUsd || 0)) === 0;
  const positionMismatch =
    (localPositionBefore?.direction || 'flat') !== (exchangePosition?.direction || 'flat') ||
    Math.abs(Number(localPositionBefore?.sizeUsd || 0) - Number(exchangePosition?.sizeUsd || 0)) > 0;
  const openOrdersMismatch = compareOrders(openOrdersLocal, openOrdersExchange);

  if (positionMismatch) {
    divergenceType.push('position_mismatch');
  }
  if (openOrdersMismatch) {
    divergenceType.push('open_orders_mismatch');
  }
  if (localFlat && !exchangeFlat) {
    divergenceType.push('unexpected_position_open');
  }
  if (!localFlat && exchangeFlat) {
    divergenceType.push('position_closed_elsewhere');
  }
  if (detectPartialFill(openOrdersExchange)) {
    divergenceType.push('partial_fill_detected');
  }
  if ((tradeSummary?.newTrades || []).length > 0) {
    divergenceType.push('new_exchange_trades_detected');
  }

  return {
    divergenceDetected: divergenceType.length > 0,
    divergenceType,
  };
}

function hasConflictingExchangeOrder(orderIntent, openOrdersExchange) {
  if (!orderIntent || orderIntent.kind !== 'order') {
    return false;
  }

  return (openOrdersExchange || []).some(order => {
    const state = order?.state || order?.order_state || '';
    if (state && !['open', 'untriggered', 'partially_filled'].includes(state)) {
      return false;
    }
    return (
      (order?.instrument || order?.instrument_name) === orderIntent.instrumentName &&
      order?.direction === orderIntent.direction &&
      Boolean(order?.reduceOnly ?? order?.reduce_only) === Boolean(orderIntent.reduceOnly)
    );
  });
}

function findAmbiguousExchangeOrders(orderIntent, openOrdersExchange) {
  if (!orderIntent || orderIntent.kind !== 'order') {
    return [];
  }

  return (openOrdersExchange || []).filter(order => {
    if ((order?.instrument || order?.instrument_name) !== orderIntent.instrumentName) {
      return false;
    }
    const sameReduceOnly =
      Boolean(order?.reduceOnly ?? order?.reduce_only) === Boolean(orderIntent.reduceOnly);

    if (orderIntent.reduceOnly) {
      return !sameReduceOnly;
    }

    if (!sameReduceOnly) {
      return true;
    }

    return order?.direction && order.direction !== orderIntent.direction;
  });
}

async function reconcileWithExchange(config, options = {}) {
  const localSnapshotBefore = readLatestSnapshot();
  const localOpenOrdersBefore = readLatestOpenOrders()?.orders || [];
  const previousMetrics = readBotMetrics() || {};
  const {
    snapshot,
    openOrders,
    recentTrades,
    recentTradesHasMore,
  } = await fetchAndPersistPrivateSnapshot(config, {
    includeRecentTrades: true,
    recentTradesCount: Number(options.recentTradesCount || 20),
  });
  const exchangePosition = normalizePositionFromSnapshot(snapshot);
  const localPositionBefore = normalizePositionFromSnapshot(localSnapshotBefore);
  const openOrdersExchange = summarizeOrders(openOrders);
  const openOrdersLocal = summarizeOrders(localOpenOrdersBefore);
  const tradeSummary = summarizeTrades(recentTrades, previousMetrics.lastReconciledTradeSeq);
  const divergence = buildDivergence(
    localPositionBefore,
    exchangePosition,
    openOrdersLocal,
    openOrdersExchange,
    tradeSummary
  );

  const reconciliation = {
    reconciledAt: snapshot.snapshotAt,
    cycleId: options.cycleId || null,
    exchangePosition,
    localPositionBefore,
    localPositionAfter: exchangePosition,
    openOrdersExchange,
    openOrdersLocal,
    divergenceDetected: divergence.divergenceDetected,
    divergenceType: divergence.divergenceType,
    partialFillDetected: divergence.divergenceType.includes('partial_fill_detected'),
    unexpectedPositionOpen: divergence.divergenceType.includes('unexpected_position_open'),
    tradeSummary: {
      recentTradeCount: tradeSummary.trades.length,
      newTradeCount: tradeSummary.newTrades.length,
      recentTradesHasMore,
      realizedPnl: tradeSummary.realizedPnl,
      fees: tradeSummary.fees,
      avgFillPrice: tradeSummary.avgFillPrice,
      filledAmount: tradeSummary.filledAmount,
      lastTradeSeq: tradeSummary.lastTradeSeq,
    },
  };

  writeLatestReconcile(reconciliation);
  writeLatestTrades({
    recordedAt: snapshot.snapshotAt,
    instrument: config.instrument,
    environment: config.environment,
    trades: tradeSummary.trades,
    newTrades: tradeSummary.newTrades,
    recentTradesHasMore,
  });
  appendEvent({
    recordedAt: snapshot.snapshotAt,
    type: 'bot_reconcile',
    summary: {
      cycleId: options.cycleId || null,
      divergenceDetected: reconciliation.divergenceDetected,
      divergenceType: reconciliation.divergenceType,
      recentTradeCount: tradeSummary.trades.length,
      newTradeCount: tradeSummary.newTrades.length,
    },
  });

  return {
    snapshot,
    openOrders,
    reconciliation,
    tradeSummary,
    recentTrades: tradeSummary.trades,
    hasConflictingExchangeOrder(orderIntent) {
      return hasConflictingExchangeOrder(orderIntent, openOrdersExchange);
    },
    findAmbiguousExchangeOrders(orderIntent) {
      return findAmbiguousExchangeOrders(orderIntent, openOrdersExchange);
    },
  };
}

module.exports = {
  reconcileWithExchange,
  hasConflictingExchangeOrder,
  findAmbiguousExchangeOrders,
};
