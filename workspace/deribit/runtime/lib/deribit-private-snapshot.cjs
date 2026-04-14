const { connectWithRetry } = require('./deribit-client.cjs');
const {
  writeLatestSnapshot,
  writeLatestOpenOrders,
  appendEvent,
  readLatestSnapshot,
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

function computeTakerMomentum(trades, count = 30) {
  const sample = (trades || []).slice(0, count);
  if (sample.length === 0) {
    return { takerMomentum: 'neutral', takerBuyRatio: null, takerTradeCount: 0 };
  }
  const buyCount = sample.filter(t => t.direction === 'buy').length;
  const takerBuyRatio = Number((buyCount / sample.length).toFixed(3));
  const takerMomentum = takerBuyRatio >= 0.6 ? 'bullish' : takerBuyRatio <= 0.4 ? 'bearish' : 'neutral';
  return { takerMomentum, takerBuyRatio, takerTradeCount: sample.length };
}

function computeFundingTrend(chartData) {
  const points = Array.isArray(chartData) ? chartData : [];
  if (points.length === 0) {
    return { avgFunding8h: null, fundingTrend: 'neutral' };
  }
  const values = points.map(p => Number(p.interest_8h || 0)).filter(v => Number.isFinite(v));
  if (values.length === 0) {
    return { avgFunding8h: null, fundingTrend: 'neutral' };
  }
  const avgFunding8h = Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(8));
  const fundingTrend = avgFunding8h > 0.00005 ? 'positive' : avgFunding8h < -0.00005 ? 'negative' : 'neutral';
  return { avgFunding8h, fundingTrend };
}

function computeDvolRisk(volatilityData) {
  const points = Array.isArray(volatilityData) ? volatilityData : [];
  if (points.length === 0) {
    return { dvolCurrent: null, dvolRisk: 'normal' };
  }
  const last = points[points.length - 1];
  // API retorna [timestamp, open, high, low, close] ou objeto com .close
  const dvolCurrent = Array.isArray(last)
    ? (Number.isFinite(Number(last[4])) ? Number(last[4]) : null)
    : (typeof last?.close === 'number' ? last.close : null);
  if (!Number.isFinite(dvolCurrent)) {
    return { dvolCurrent: null, dvolRisk: 'normal' };
  }
  const dvolRisk = dvolCurrent > 80 ? 'high' : dvolCurrent > 60 ? 'elevated' : 'normal';
  return { dvolCurrent, dvolRisk };
}

function computePriceTrend(closes, currentPrice) {
  if (!Array.isArray(closes) || closes.length === 0 || !Number.isFinite(currentPrice)) {
    return { priceMA60: null, priceTrend: 'sideways' };
  }
  const values = closes.map(Number).filter(v => Number.isFinite(v));
  if (values.length === 0) {
    return { priceMA60: null, priceTrend: 'sideways' };
  }
  const priceMA60 = Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2));
  const priceTrend = currentPrice > priceMA60 * 1.0005 ? 'uptrend'
    : currentPrice < priceMA60 * 0.9995 ? 'downtrend'
    : 'sideways';
  return { priceMA60, priceTrend };
}

async function fetchPrivateExchangeState(config, options = {}) {
  const client = await connectWithRetry({ environment: config.environment });
  try {
    await client.authenticate(config.clientId, config.clientSecret);

    const includeRecentTrades = Boolean(options.includeRecentTrades);
    const recentTradesCount =
      Number(options.recentTradesCount) > 0 ? Number(options.recentTradesCount) : 20;

    const prevSnapshot = readLatestSnapshot();
    const oiPrevious = typeof prevSnapshot?.oiCurrent === 'number' ? prevSnapshot.oiCurrent : null;

    const [instrumentInfo, ticker, accountSummary, position, openOrdersProbe, recentTradesResponse, publicTradesResponse, fundingChartResponse, volatilityResponse, openInterestResponse, chartResponse] = await Promise.all([
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
      client.getLastTradesByInstrument(config.instrument, 30).catch(() => ({ trades: [] })),
      client.getFundingChartData(config.instrument, '8h').catch(() => ({ data: [] })),
      client.getVolatilityIndex(config.currency.toLowerCase()).catch(() => ({ data: [] })),
      client.getOpenInterest(config.instrument).catch(() => []),
      client.getTradingViewChart(config.instrument, '5', 12).catch(() => ({ close: [] })),
    ]);
    const publicTrades = Array.isArray(publicTradesResponse?.trades) ? publicTradesResponse.trades : [];
    const { takerMomentum, takerBuyRatio, takerTradeCount } = computeTakerMomentum(publicTrades);
    const { avgFunding8h, fundingTrend } = computeFundingTrend(fundingChartResponse?.data);
    const { dvolCurrent, dvolRisk } = computeDvolRisk(volatilityResponse?.data);
    const oiCurrent = Array.isArray(openInterestResponse) && openInterestResponse.length > 0
      ? (typeof openInterestResponse[0]?.open_interest === 'number' ? openInterestResponse[0].open_interest : null)
      : null;
    const oiDelta = oiCurrent !== null && oiPrevious !== null ? oiCurrent - oiPrevious : null;
    const oiTrend = oiDelta === null ? 'stable' : oiDelta > 0 ? 'expanding' : oiDelta < 0 ? 'contracting' : 'stable';
    const { priceMA60, priceTrend } = computePriceTrend(chartResponse?.close, ticker.mark_price ?? null);
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
      takerMomentum,
      takerBuyRatio,
      takerTradeCount,
      avgFunding8h,
      fundingTrend,
      dvolCurrent,
      dvolRisk,
      oiCurrent,
      oiDelta,
      oiTrend,
      priceMA60,
      priceTrend,
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
