const { connectWithRetry } = require('./deribit-client.cjs');
const {
  writeLatestSnapshot,
  writeLatestOpenOrders,
  appendEvent,
} = require('./deribit-state-store.cjs');

function normalizeOpenOrdersResult(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result?.orders)) {
    return result.orders;
  }
  return [];
}

function summarizeOpenOrdersForLog(orders) {
  return (orders || []).slice(0, 5).map(order => ({
    orderId: order?.order_id || null,
    instrument: order?.instrument_name || null,
    direction: order?.direction || null,
    state: order?.order_state || null,
    reduceOnly: Boolean(order?.reduce_only),
    price: typeof order?.price === 'number' ? order.price : null,
    amount: typeof order?.amount === 'number' ? order.amount : null,
  }));
}

function filterOrdersByInstrument(orders, instrument) {
  return (orders || []).filter(order => order?.instrument_name === instrument);
}

async function probeOpenOrders(client, config) {
  const probes = await Promise.all([
    client
      .getOpenOrdersByInstrument(config.instrument)
      .then(result => ({ key: 'byInstrument', ok: true, result }))
      .catch(error => ({ key: 'byInstrument', ok: false, error: error.message })),
    client
      .getOpenOrdersByCurrency(config.currency, 'future', 'all')
      .then(result => ({ key: 'byCurrency', ok: true, result }))
      .catch(error => ({ key: 'byCurrency', ok: false, error: error.message })),
    client
      .getOpenOrders()
      .then(result => ({ key: 'allOpenOrders', ok: true, result }))
      .catch(error => ({ key: 'allOpenOrders', ok: false, error: error.message })),
  ]);

  const diagnostics = {};
  for (const probe of probes) {
    if (!probe.ok) {
      diagnostics[probe.key] = {
        ok: false,
        error: probe.error,
        rawCount: null,
        filteredCount: null,
        rawSample: [],
      };
      continue;
    }

    const rawOrders = normalizeOpenOrdersResult(probe.result);
    const filteredOrders =
      probe.key === 'byInstrument'
        ? rawOrders
        : filterOrdersByInstrument(rawOrders, config.instrument);

    diagnostics[probe.key] = {
      ok: true,
      rawCount: rawOrders.length,
      filteredCount: filteredOrders.length,
      rawSample: summarizeOpenOrdersForLog(rawOrders),
    };
  }

  const byInstrumentOrders = diagnostics.byInstrument?.ok
    ? normalizeOpenOrdersResult(probes.find(probe => probe.key === 'byInstrument')?.result)
    : [];
  const byCurrencyOrders = diagnostics.byCurrency?.ok
    ? filterOrdersByInstrument(
        normalizeOpenOrdersResult(probes.find(probe => probe.key === 'byCurrency')?.result),
        config.instrument
      )
    : [];
  const allOpenOrders = diagnostics.allOpenOrders?.ok
    ? filterOrdersByInstrument(
        normalizeOpenOrdersResult(probes.find(probe => probe.key === 'allOpenOrders')?.result),
        config.instrument
      )
    : [];

  let selectedSource = 'byInstrument';
  let selectedOrders = byInstrumentOrders;
  if (selectedOrders.length === 0 && byCurrencyOrders.length > 0) {
    selectedSource = 'byCurrency';
    selectedOrders = byCurrencyOrders;
  } else if (selectedOrders.length === 0 && allOpenOrders.length > 0) {
    selectedSource = 'allOpenOrders';
    selectedOrders = allOpenOrders;
  }

  return {
    openOrders: selectedOrders,
    selectedSource,
    diagnostics,
  };
}

async function fetchPrivateExchangeState(config, options = {}) {
  const client = await connectWithRetry({ environment: config.environment });
  try {
    await client.authenticate(config.clientId, config.clientSecret);

    const includeRecentTrades = Boolean(options.includeRecentTrades);
    const recentTradesCount =
      Number(options.recentTradesCount) > 0 ? Number(options.recentTradesCount) : 20;

    const [instrumentInfo, ticker, accountSummary, position, openOrdersProbe, recentTradesResponse] = await Promise.all([
      client.getInstrument(config.instrument),
      client.getTicker(config.instrument),
      client.getAccountSummary(config.currency),
      client.getPosition(config.instrument).catch(() => ({
        direction: 'flat',
        size: 0,
        total_profit_loss: 0,
        realized_profit_loss: 0,
        average_price: 0,
        estimated_liquidation_price: null,
      })),
      probeOpenOrders(client, config),
      includeRecentTrades
        ? client.getUserTradesByInstrument(config.instrument, recentTradesCount).catch(() => ({
            trades: [],
            has_more: false,
          }))
        : Promise.resolve({ trades: [], has_more: false }),
    ]);
    const openOrders = Array.isArray(openOrdersProbe?.openOrders) ? openOrdersProbe.openOrders : [];

    const direction = position.direction === 'zero' ? 'flat' : (position.direction || 'flat');
    const recentTrades = Array.isArray(recentTradesResponse?.trades)
      ? recentTradesResponse.trades
      : [];
    const snapshot = {
      snapshotAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
      environment: config.environment,
      instrument: config.instrument,
      currency: config.currency,
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
      positionAveragePrice: position.average_price ?? 0,
      positionFloatingPnl: position.floating_profit_loss ?? 0,
      positionRealizedPnl: position.realized_profit_loss ?? 0,
      positionPnl: position.total_profit_loss ?? 0,
      estimatedLiquidationPrice: position.estimated_liquidation_price ?? null,
      openOrderCount: Array.isArray(openOrders) ? openOrders.length : 0,
    };

    const shouldLogOpenOrdersProbe =
      openOrdersProbe?.selectedSource !== 'byInstrument' ||
      snapshot.openOrderCount === 0 ||
      Object.values(openOrdersProbe?.diagnostics || {}).some(entry => entry && entry.ok === false);

    if (shouldLogOpenOrdersProbe) {
      appendEvent({
        recordedAt: snapshot.snapshotAt,
        type: 'private_open_orders_probe',
        instrument: config.instrument,
        currency: config.currency,
        selectedSource: openOrdersProbe?.selectedSource || 'unknown',
        openOrderCount: snapshot.openOrderCount,
        diagnostics: openOrdersProbe?.diagnostics || {},
      });
    }

    return {
      snapshot,
      openOrders,
      openOrdersSource: openOrdersProbe?.selectedSource || 'byInstrument',
      openOrdersDiagnostics: openOrdersProbe?.diagnostics || {},
      position,
      recentTrades,
      recentTradesHasMore: Boolean(recentTradesResponse?.has_more),
    };
  } finally {
    client.close();
  }
}

async function fetchAndPersistPrivateSnapshot(config, options = {}) {
  const {
    snapshot,
    openOrders,
    openOrdersSource,
    openOrdersDiagnostics,
    position,
    recentTrades,
    recentTradesHasMore,
  } = await fetchPrivateExchangeState(config, options);

  writeLatestSnapshot(snapshot);
  writeLatestOpenOrders({
    recordedAt: snapshot.snapshotAt,
    environment: config.environment,
    instrument: config.instrument,
    source: openOrdersSource || 'byInstrument',
    diagnostics: openOrdersDiagnostics || {},
    orders: openOrders,
  });
  appendEvent({
    recordedAt: snapshot.snapshotAt,
    type: 'private_sync',
    instrument: config.instrument,
    currency: config.currency,
    openOrderCount: snapshot.openOrderCount,
    openOrdersSource: openOrdersSource || 'byInstrument',
    directionalEdgeUsd:
      typeof snapshot.markPrice === 'number' && typeof snapshot.indexPrice === 'number'
        ? Number((snapshot.markPrice - snapshot.indexPrice).toFixed(4))
        : null,
    recentTradeCount: Array.isArray(recentTrades) ? recentTrades.length : 0,
  });

  return {
    snapshot,
    openOrders,
    openOrdersSource,
    openOrdersDiagnostics,
    position,
    recentTrades,
    recentTradesHasMore,
  };
}

module.exports = {
  fetchPrivateExchangeState,
  fetchAndPersistPrivateSnapshot,
};
