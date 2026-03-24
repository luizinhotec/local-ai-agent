#!/usr/bin/env node

const { connectWithRetry } = require('./lib/deribit-client.cjs');
const { appendEvent } = require('./lib/deribit-state-store.cjs');

function readConfig() {
  return {
    environment: process.env.DERIBIT_ENVIRONMENT || 'testnet',
    currency: process.env.DERIBIT_CURRENCY || 'BTC',
    instrument: process.env.DERIBIT_INSTRUMENT || 'BTC-PERPETUAL',
    clientId: process.env.DERIBIT_CLIENT_ID || '',
    clientSecret: process.env.DERIBIT_CLIENT_SECRET || '',
  };
}

function findMatchedAccount(subaccounts, accountSummary) {
  const accountId = Number(accountSummary?.id || 0);
  if (!Array.isArray(subaccounts) || !accountId) {
    return null;
  }
  return subaccounts.find(account => Number(account?.id || 0) === accountId) || null;
}

function summarizePortfolioCurrency(subaccount, currency) {
  const key = String(currency || '').toLowerCase();
  const portfolio = subaccount?.portfolio || {};
  return portfolio[key] || null;
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
    const [accountSummary, accountSummaries, subaccounts] = await Promise.all([
      client.getAccountSummary(config.currency, true),
      client.getAccountSummaries(true).catch(() => null),
      client.getSubaccounts(true).catch(() => []),
    ]);

    const matchedAccount = findMatchedAccount(subaccounts, accountSummary);
    const matchedPortfolio = summarizePortfolioCurrency(matchedAccount, config.currency);
    const compactAccountSummaries = Array.isArray(accountSummaries?.summaries)
      ? accountSummaries.summaries
          .filter(summary => summary?.currency === config.currency)
          .map(summary => ({
            currency: summary.currency,
            equity: summary.equity,
            availableFunds: summary.available_funds,
          }))
      : [];

    console.log(`environment: ${config.environment}`);
    console.log(`instrument: ${config.instrument}`);
    console.log(`currency: ${config.currency}`);
    console.log(`auth_scope: ${auth.scope || 'n/a'}`);
    console.log(`user_id: ${accountSummary?.id ?? 'n/a'}`);
    console.log(`username: ${accountSummary?.username || 'n/a'}`);
    console.log(`system_name: ${accountSummary?.system_name || 'n/a'}`);
    console.log(`email: ${accountSummary?.email || 'n/a'}`);
    console.log(`account_type: ${accountSummary?.type || 'n/a'}`);
    console.log(`subaccounts_visible: ${Array.isArray(subaccounts) ? subaccounts.length : 0}`);
    console.log(`matched_subaccount_id: ${matchedAccount?.id ?? 'n/a'}`);
    console.log(`matched_subaccount_type: ${matchedAccount?.type || 'n/a'}`);
    console.log(`matched_subaccount_username: ${matchedAccount?.username || 'n/a'}`);
    console.log(`matched_subaccount_system_name: ${matchedAccount?.system_name || 'n/a'}`);
    console.log(`currency_equity: ${accountSummary?.equity ?? 'n/a'}`);
    console.log(`currency_available_funds: ${accountSummary?.available_funds ?? 'n/a'}`);
    console.log(`matched_portfolio_equity: ${matchedPortfolio?.equity ?? 'n/a'}`);
    console.log(`matched_portfolio_available_funds: ${matchedPortfolio?.available_funds ?? 'n/a'}`);

    appendEvent({
      recordedAt: new Date().toISOString(),
      type: 'auth_context_diagnostic',
      summary: {
        environment: config.environment,
        instrument: config.instrument,
        currency: config.currency,
        authScope: auth.scope || null,
        userId: accountSummary?.id ?? null,
        username: accountSummary?.username || null,
        systemName: accountSummary?.system_name || null,
        email: accountSummary?.email || null,
        accountType: accountSummary?.type || null,
        subaccountsVisible: Array.isArray(subaccounts) ? subaccounts.length : 0,
        matchedSubaccountId: matchedAccount?.id ?? null,
        matchedSubaccountType: matchedAccount?.type || null,
        matchedSubaccountUsername: matchedAccount?.username || null,
        matchedSubaccountSystemName: matchedAccount?.system_name || null,
        currencyEquity: accountSummary?.equity ?? null,
        currencyAvailableFunds: accountSummary?.available_funds ?? null,
        matchedPortfolioEquity: matchedPortfolio?.equity ?? null,
        matchedPortfolioAvailableFunds: matchedPortfolio?.available_funds ?? null,
        accountSummaries: compactAccountSummaries,
      },
    });
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(`[deribit-auth-context] ${error.message}`);
  process.exit(1);
});
