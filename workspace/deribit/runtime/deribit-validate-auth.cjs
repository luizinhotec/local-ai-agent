#!/usr/bin/env node

const { connectWithRetry } = require('./lib/deribit-client.cjs');

function readConfig() {
  return {
    environment: process.env.DERIBIT_ENVIRONMENT || 'testnet',
    currency: process.env.DERIBIT_CURRENCY || 'BTC',
    instrument: process.env.DERIBIT_INSTRUMENT || 'BTC-PERPETUAL',
    clientId: process.env.DERIBIT_CLIENT_ID || '',
    clientSecret: process.env.DERIBIT_CLIENT_SECRET || '',
  };
}

async function main() {
  const config = readConfig();
  if (!config.clientId || !config.clientSecret) {
    console.error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
    process.exit(1);
  }

  const client = await connectWithRetry({ environment: config.environment });
  try {
    const auth = await client.authenticate(config.clientId, config.clientSecret);
    const accountSummary = await client.getAccountSummary(config.currency);

    console.log(`environment: ${config.environment}`);
    console.log(`instrument: ${config.instrument}`);
    console.log(`auth_scope: ${auth.scope || 'n/a'}`);
    console.log(`account_equity: ${accountSummary.equity ?? 'n/a'}`);
    console.log(`available_funds: ${accountSummary.available_funds ?? 'n/a'}`);
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(`[deribit-validate-auth] ${error.message}`);
  process.exit(1);
});
