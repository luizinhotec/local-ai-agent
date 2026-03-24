#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { connectWithRetry } = require('./lib/deribit-client.cjs');
const {
  appendEvent,
  writeLatestSnapshot,
  writeLatestOpenOrders,
} = require('./lib/deribit-state-store.cjs');

const DEFAULTS = {
  environment: 'testnet',
  currency: 'BTC',
  instrument: 'BTC-PERPETUAL',
  logIntervalMs: 5000,
  privateRefreshIntervalMs: 10000,
  retries: 5,
  retryDelayMs: 1500,
};

function parseArgs(argv) {
  const flags = {
    help: false,
    once: false,
  };
  const values = {};
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '--once') {
      flags.once = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`unknown argument: ${arg}`);
    }
    const [key, rawValue] = arg.slice(2).split('=');
    if (!rawValue) {
      throw new Error(`missing value for --${key}`);
    }
    values[key] = rawValue;
  }
  return { flags, values };
}

function printHelp() {
  console.log(`Deribit read-only monitor

Usage:
  node workspace/deribit/runtime/deribit-read-only-monitor.cjs
  node workspace/deribit/runtime/deribit-read-only-monitor.cjs --environment=testnet --instrument=BTC-PERPETUAL
  node workspace/deribit/runtime/deribit-read-only-monitor.cjs --once

Environment:
  DERIBIT_ENVIRONMENT        testnet or production, default testnet
  DERIBIT_CLIENT_ID          optional client id for private account reads
  DERIBIT_CLIENT_SECRET      optional client secret for private account reads
  DERIBIT_CURRENCY           default BTC
  DERIBIT_INSTRUMENT         default BTC-PERPETUAL
  DERIBIT_LOG_INTERVAL_MS    default 5000
  DERIBIT_PRIVATE_REFRESH_INTERVAL_MS default 10000

Behavior:
  without credentials: public market monitor only
  with credentials: adds account summary, position and private subscriptions
  --once captures a fresh snapshot, persists it and exits
`);
}

function loadJsonConfig() {
  const configPath = path.join(__dirname, '..', 'config', 'deribit.config.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function readConfig(values) {
  const fileConfig = loadJsonConfig();
  return {
    environment:
      values.environment ||
      process.env.DERIBIT_ENVIRONMENT ||
      fileConfig.environment ||
      DEFAULTS.environment,
    clientId: values['client-id'] || process.env.DERIBIT_CLIENT_ID || '',
    clientSecret: values['client-secret'] || process.env.DERIBIT_CLIENT_SECRET || '',
    currency:
      values.currency ||
      process.env.DERIBIT_CURRENCY ||
      fileConfig.currency ||
      DEFAULTS.currency,
    instrument:
      values.instrument ||
      process.env.DERIBIT_INSTRUMENT ||
      fileConfig.instrument ||
      DEFAULTS.instrument,
    logIntervalMs: Number(
      values['log-interval-ms'] ||
        process.env.DERIBIT_LOG_INTERVAL_MS ||
        fileConfig.logIntervalMs ||
        DEFAULTS.logIntervalMs
    ),
    privateRefreshIntervalMs: Number(
      values['private-refresh-interval-ms'] ||
        process.env.DERIBIT_PRIVATE_REFRESH_INTERVAL_MS ||
        fileConfig.privateRefreshIntervalMs ||
        DEFAULTS.privateRefreshIntervalMs
    ),
  };
}

function buildPublicChannels(instrument) {
  return [
    `ticker.${instrument}.100ms`,
    `book.${instrument}.100ms`,
  ];
}

function buildPrivateChannels(currency, instrument) {
  return [
    `user.portfolio.${currency}`,
    `user.orders.${instrument}.100ms`,
    `user.trades.${instrument}.100ms`,
  ];
}

function formatNumber(value, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }
  return value.toFixed(digits);
}

function createState(config) {
  return {
    startedAt: new Date().toISOString(),
    environment: config.environment,
    instrument: config.instrument,
    currency: config.currency,
    authEnabled: false,
    instrumentInfo: null,
    ticker: null,
    book: null,
    accountSummary: null,
    position: null,
    portfolio: null,
    openOrders: [],
    lastOrderEvent: null,
    lastTradeEvent: null,
    lastEventAt: null,
  };
}

function handleNotification(state, message) {
  const channel = message?.params?.channel;
  const data = message?.params?.data;
  if (!channel) {
    return;
  }

  state.lastEventAt = new Date().toISOString();
  appendEvent({
    recordedAt: state.lastEventAt,
    type: 'notification',
    channel,
  });

  if (channel.startsWith('ticker.')) {
    state.ticker = data;
    return;
  }
  if (channel.startsWith('book.')) {
    state.book = data;
    return;
  }
  if (channel.startsWith('user.portfolio.')) {
    state.portfolio = data;
    return;
  }
  if (channel.startsWith('user.orders.')) {
    state.lastOrderEvent = data;
    return;
  }
  if (channel.startsWith('user.trades.')) {
    state.lastTradeEvent = data;
  }
}

function buildSnapshot(state) {
  const ticker = state.ticker || {};
  const book = state.book || {};
  const account = state.accountSummary || {};
  const position = state.position || {};
  const portfolio = state.portfolio || {};
  const bestBid = ticker.best_bid_price ?? book.best_bid_price ?? null;
  const bestAsk = ticker.best_ask_price ?? book.best_ask_price ?? null;

  return {
    snapshotAt: new Date().toISOString(),
    startedAt: state.startedAt,
    lastEventAt: state.lastEventAt,
    environment: state.environment,
    instrument: state.instrument,
    currency: state.currency,
    authEnabled: state.authEnabled,
    bestBid,
    bestAsk,
    markPrice: ticker.mark_price ?? null,
    indexPrice: ticker.index_price ?? null,
    currentFunding: ticker.current_funding ?? null,
    openInterest: ticker.open_interest ?? null,
    tickSize: state.instrumentInfo?.tick_size ?? null,
    minTradeAmount: state.instrumentInfo?.min_trade_amount ?? null,
    contractSize: state.instrumentInfo?.contract_size ?? null,
    accountEquity: account.equity ?? portfolio.equity ?? null,
    availableFunds: account.available_funds ?? null,
    maintenanceMargin: account.maintenance_margin ?? null,
    positionDirection: position.direction ?? 'flat',
    positionSizeUsd: position.size ?? 0,
    positionPnl: position.total_profit_loss ?? 0,
    estimatedLiquidationPrice: position.estimated_liquidation_price ?? null,
    openOrderCount: Array.isArray(state.openOrders) ? state.openOrders.length : 0,
  };
}

function printSnapshot(state) {
  const snapshot = buildSnapshot(state);

  console.log('');
  console.log(`[${snapshot.snapshotAt}] Deribit monitor`);
  console.log(`environment: ${snapshot.environment}`);
  console.log(`instrument: ${snapshot.instrument}`);
  console.log(`auth: ${snapshot.authEnabled ? 'enabled' : 'public-only'}`);
  console.log(
    `market: bid ${formatNumber(snapshot.bestBid)} | ask ${formatNumber(snapshot.bestAsk)} | mark ${formatNumber(snapshot.markPrice)} | index ${formatNumber(snapshot.indexPrice)}`
  );
  console.log(
    `flow: funding ${formatNumber(snapshot.currentFunding, 6)} | oi ${formatNumber(snapshot.openInterest, 0)}`
  );

  if (state.instrumentInfo) {
    console.log(
      `instrument_meta: tick ${formatNumber(snapshot.tickSize)} | min_order ${formatNumber(snapshot.minTradeAmount, 0)} | contract ${formatNumber(snapshot.contractSize, 0)}`
    );
  }

  if (state.authEnabled) {
    console.log(
      `account: equity ${formatNumber(snapshot.accountEquity, 6)} ${state.currency} | available ${formatNumber(snapshot.availableFunds, 6)} ${state.currency} | maintenance ${formatNumber(snapshot.maintenanceMargin, 6)} ${state.currency}`
    );
    console.log(
      `position: direction ${snapshot.positionDirection || 'flat'} | size ${formatNumber(snapshot.positionSizeUsd, 0)} USD | pnl ${formatNumber(snapshot.positionPnl, 6)} ${state.currency} | est_liq ${formatNumber(snapshot.estimatedLiquidationPrice)}`
      );
    console.log(`open_orders: ${snapshot.openOrderCount}`);
    if (state.portfolio && typeof state.portfolio === 'object') {
      console.log(
        `portfolio: balance ${formatNumber(state.portfolio.balance, 6)} ${state.currency} | equity ${formatNumber(state.portfolio.equity, 6)} ${state.currency}`
      );
    }
  }

  if (state.lastOrderEvent) {
    const order = Array.isArray(state.lastOrderEvent) ? state.lastOrderEvent[0] : state.lastOrderEvent;
    if (order) {
      console.log(
        `last_order_event: ${order.order_state || 'n/a'} | ${order.direction || 'n/a'} | ${formatNumber(order.price)} | ${formatNumber(order.amount, 0)}`
      );
    }
  }

  if (state.lastTradeEvent) {
    const trade = Array.isArray(state.lastTradeEvent) ? state.lastTradeEvent[0] : state.lastTradeEvent;
    if (trade) {
      console.log(
        `last_trade_event: ${trade.direction || 'n/a'} | ${formatNumber(trade.price)} | ${formatNumber(trade.amount, 0)}`
      );
    }
  }

  writeLatestSnapshot(snapshot);
  if (state.authEnabled) {
    writeLatestOpenOrders({
      recordedAt: snapshot.snapshotAt,
      environment: state.environment,
      instrument: state.instrument,
      orders: state.openOrders,
    });
  }
}

async function bootstrapPrivateState(client, config, state) {
  if (!config.clientId || !config.clientSecret) {
    return;
  }

  await client.authenticate(config.clientId, config.clientSecret);
  state.authEnabled = true;
  state.accountSummary = await client.getAccountSummary(config.currency);

  try {
    state.position = await client.getPosition(config.instrument);
  } catch (error) {
    state.position = {
      direction: 'flat',
      size: 0,
      total_profit_loss: 0,
      estimated_liquidation_price: null,
      note: error.message,
    };
  }

  try {
    state.openOrders = await client.getOpenOrdersByInstrument(config.instrument);
  } catch (error) {
    state.openOrders = [];
    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'private_refresh_error',
      scope: 'open_orders_bootstrap',
      message: error.message,
    });
  }

  await client.privateSubscribe(buildPrivateChannels(config.currency, config.instrument));
}

async function refreshPrivateState(client, config, state) {
  if (!state.authEnabled) {
    return;
  }

  state.accountSummary = await client.getAccountSummary(config.currency);

  try {
    state.position = await client.getPosition(config.instrument);
  } catch (error) {
    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'private_refresh_error',
      scope: 'position',
      message: error.message,
    });
  }

  try {
    state.openOrders = await client.getOpenOrdersByInstrument(config.instrument);
  } catch (error) {
    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'private_refresh_error',
      scope: 'open_orders',
      message: error.message,
    });
  }
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  const config = readConfig(values);
  const state = createState(config);
  let shuttingDown = false;

  const client = await connectWithRetry({
    environment: config.environment,
    retries: DEFAULTS.retries,
    retryDelayMs: DEFAULTS.retryDelayMs,
  });

  client.onNotification(message => handleNotification(state, message));
  client.onError(error => {
    console.error(`[deribit-monitor] ${error.message}`);
  });
  client.onClose(event => {
    if (shuttingDown) {
      return;
    }
    console.error(`[deribit-monitor] websocket closed: ${event.code}`);
    process.exitCode = 1;
  });

  state.instrumentInfo = await client.getInstrument(config.instrument);
  state.ticker = await client.getTicker(config.instrument);
  await client.subscribe(buildPublicChannels(config.instrument));
  appendEvent({
    recordedAt: new Date().toISOString(),
    type: 'subscription',
    scope: 'public',
    instrument: config.instrument,
  });
  await bootstrapPrivateState(client, config, state);

  if (state.authEnabled) {
    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'subscription',
      scope: 'private',
      instrument: config.instrument,
      currency: config.currency,
    });
  }

  printSnapshot(state);

  if (flags.once) {
    shuttingDown = true;
    client.close();
    return;
  }

  const timer = setInterval(() => printSnapshot(state), config.logIntervalMs);
  const privateRefreshTimer = setInterval(() => {
    refreshPrivateState(client, config, state).catch(error => {
      console.error(`[deribit-monitor] private refresh failed: ${error.message}`);
      appendEvent({
        recordedAt: new Date().toISOString(),
        type: 'private_refresh_error',
        scope: 'account',
        message: error.message,
      });
    });
  }, config.privateRefreshIntervalMs);

  const shutdown = () => {
    shuttingDown = true;
    clearInterval(timer);
    clearInterval(privateRefreshTimer);
    client.close();
    setTimeout(() => process.exit(0), 50);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error(`[deribit-monitor] ${error.message}`);
  process.exit(1);
});
