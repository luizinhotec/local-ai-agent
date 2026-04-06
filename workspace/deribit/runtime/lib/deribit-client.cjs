if (typeof WebSocket === 'undefined') {
  global.WebSocket = require('ws');
}

const WS_URLS = {
  testnet: 'wss://test.deribit.com/ws/api/v2',
  production: 'wss://www.deribit.com/ws/api/v2',
};

const HTTP_URLS = {
  testnet: 'https://test.deribit.com/api/v2',
  production: 'https://www.deribit.com/api/v2',
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class DeribitWsClient {
  constructor(options = {}) {
    this.environment = options.environment || 'testnet';
    this.wsUrl = WS_URLS[this.environment];
    this.httpUrl = HTTP_URLS[this.environment];
    this.websocket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandlers = new Set();
    this.closeHandlers = new Set();
    this.errorHandlers = new Set();
  }

  async connect() {
    if (!this.wsUrl) {
      throw new Error(`unsupported Deribit environment: ${this.environment}`);
    }

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.wsUrl);
      this.websocket = socket;

      const onOpen = () => {
        cleanup();
        this.attachSocketHandlers(socket);
        resolve();
      };

      const onError = event => {
        cleanup();
        const message = event?.message || 'websocket connection failed';
        reject(new Error(message));
      };

      const cleanup = () => {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };

      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
  }

  attachSocketHandlers(socket) {
    socket.addEventListener('message', event => {
      try {
        const payload = JSON.parse(event.data);
        if (typeof payload.id !== 'undefined') {
          const pending = this.pending.get(payload.id);
          if (pending) {
            this.pending.delete(payload.id);
            if (payload.error) {
              pending.reject(new Error(`${payload.error.code}: ${payload.error.message}`));
              return;
            }
            pending.resolve(payload.result);
            return;
          }
        }

        for (const handler of this.notificationHandlers) {
          handler(payload);
        }
      } catch (error) {
        for (const handler of this.errorHandlers) {
          handler(error);
        }
      }
    });

    socket.addEventListener('close', event => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`websocket closed: ${event.code}`));
      }
      this.pending.clear();
      for (const handler of this.closeHandlers) {
        handler(event);
      }
    });

    socket.addEventListener('error', event => {
      const error = new Error(event?.message || 'websocket error');
      for (const handler of this.errorHandlers) {
        handler(error);
      }
    });
  }

  async call(method, params = {}) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error('websocket is not connected');
    }

    const id = this.nextId++;
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const responsePromise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.websocket.send(JSON.stringify(payload));
    return responsePromise;
  }

  async authenticate(clientId, clientSecret) {
    return this.call('public/auth', {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
  }

  async subscribe(channels) {
    return this.call('public/subscribe', { channels });
  }

  async privateSubscribe(channels) {
    return this.call('private/subscribe', { channels });
  }

  async getAccountSummary(currency, extended = true) {
    return this.call('private/get_account_summary', { currency, extended });
  }

  async getAccountSummaries(extended = true) {
    return this.call('private/get_account_summaries', { extended });
  }

  async getSubaccounts(withPortfolio = false) {
    return this.call('private/get_subaccounts', { with_portfolio: withPortfolio });
  }

  async getPosition(instrumentName) {
    return this.call('private/get_position', { instrument_name: instrumentName });
  }

  async getOrderState(orderId) {
    return this.call('private/get_order_state', { order_id: orderId });
  }

  async getOpenOrdersByInstrument(instrumentName, type = 'all') {
    const params = {
      instrument_name: instrumentName,
    };
    if (typeof type === 'string' && type.length > 0) {
      params.type = type;
    }
    return this.call('private/get_open_orders_by_instrument', params);
  }

  async getOpenOrdersByCurrency(currency, kind = 'future', type = 'all') {
    const params = {
      currency,
    };
    if (typeof kind === 'string' && kind.length > 0) {
      params.kind = kind;
    }
    if (typeof type === 'string' && type.length > 0) {
      params.type = type;
    }
    return this.call('private/get_open_orders_by_currency', params);
  }

  async getOpenOrders() {
    return this.call('private/get_open_orders', {});
  }

  async getUserTradesByInstrument(instrumentName, count = 20, sorting = 'desc') {
    return this.call('private/get_user_trades_by_instrument', {
      instrument_name: instrumentName,
      count,
      sorting,
    });
  }

  async getUserTradesByOrder(orderId, historical = true, sorting = 'desc') {
    return this.call('private/get_user_trades_by_order', {
      order_id: orderId,
      historical,
      sorting,
    });
  }

  async getOrderHistoryByInstrument(
    instrumentName,
    count = 20,
    includeOld = true,
    includeUnfilled = true
  ) {
    return this.call('private/get_order_history_by_instrument', {
      instrument_name: instrumentName,
      count,
      include_old: includeOld,
      include_unfilled: includeUnfilled,
    });
  }

  async getTicker(instrumentName) {
    return this.call('public/ticker', { instrument_name: instrumentName });
  }

  async getInstrument(instrumentName) {
    return this.call('public/get_instrument', { instrument_name: instrumentName });
  }

  async buy(params) {
    return this.call('private/buy', params);
  }

  async sell(params) {
    return this.call('private/sell', params);
  }

  async cancel(orderId) {
    return this.call('private/cancel', { order_id: orderId });
  }

  async cancelAll(currency, kind = 'future') {
    return this.call('private/cancel_all', { currency, kind });
  }

  async editByLabel(params) {
    return this.call('private/edit_by_label', params);
  }

  onNotification(handler) {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onClose(handler) {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  onError(handler) {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  close() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.close();
    }
  }
}

async function connectWithRetry(options = {}) {
  const retries = typeof options.retries === 'number' ? options.retries : 5;
  const retryDelayMs = typeof options.retryDelayMs === 'number' ? options.retryDelayMs : 1500;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const client = new DeribitWsClient(options);
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(retryDelayMs * attempt);
      }
    }
  }

  throw lastError || new Error('failed to connect to Deribit');
}

module.exports = {
  DeribitWsClient,
  connectWithRetry,
  WS_URLS,
  HTTP_URLS,
};
