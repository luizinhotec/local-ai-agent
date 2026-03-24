#!/usr/bin/env node

const { readLatestSnapshot, LATEST_SNAPSHOT_PATH } = require('./lib/deribit-state-store.cjs');

function formatNumber(value, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }
  return value.toFixed(digits);
}

function main() {
  const snapshot = readLatestSnapshot();
  if (!snapshot) {
    console.error(`no Deribit snapshot found at ${LATEST_SNAPSHOT_PATH}`);
    process.exit(1);
  }

  console.log(`snapshot_at: ${snapshot.snapshotAt || 'n/a'}`);
  console.log(`environment: ${snapshot.environment}`);
  console.log(`instrument: ${snapshot.instrument}`);
  console.log(`auth: ${snapshot.authEnabled ? 'enabled' : 'public-only'}`);
  console.log(
    `market: bid ${formatNumber(snapshot.bestBid)} | ask ${formatNumber(snapshot.bestAsk)} | mark ${formatNumber(snapshot.markPrice)} | index ${formatNumber(snapshot.indexPrice)}`
  );
  console.log(
    `flow: funding ${formatNumber(snapshot.currentFunding, 6)} | oi ${formatNumber(snapshot.openInterest, 0)}`
  );

  if (snapshot.authEnabled) {
    console.log(
      `account: equity ${formatNumber(snapshot.accountEquity, 6)} ${snapshot.currency} | available ${formatNumber(snapshot.availableFunds, 6)} ${snapshot.currency}`
    );
    console.log(
      `position: direction ${snapshot.positionDirection || 'flat'} | size ${formatNumber(snapshot.positionSizeUsd, 0)} USD | pnl ${formatNumber(snapshot.positionPnl, 6)} ${snapshot.currency}`
    );
  }
}

main();
