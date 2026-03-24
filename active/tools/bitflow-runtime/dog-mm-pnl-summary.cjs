#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const OPS_LOG_FILE = path.resolve(STATE_DIR, 'dog-mm-ops-log.jsonl');
const OPS_BUNDLE_FILE = path.resolve(STATE_DIR, 'dog-mm-ops-bundle.json');
const LP_ADD_PLAN_FILE = path.resolve(STATE_DIR, 'bitflow-last-lp-add-plan.json');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-pnl-summary.json');
const OUTPUT_MD = path.resolve(STATE_DIR, 'dog-mm-pnl-summary.md');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readJsonLines(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'local-ai-agent/dog-mm-pnl-summary',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function findLastEvent(events, type) {
  const filtered = events.filter(event => event.type === type);
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

function isRealTxid(value) {
  return typeof value === 'string' && /^([0-9a-f]{64}|0x[0-9a-f]{64})$/i.test(value);
}

function normalizeTxid(value) {
  if (!isRealTxid(value)) return '';
  return value.startsWith('0x') ? value.slice(2) : value;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function extractLpInventoryFromHeartbeat(event) {
  if (!event?.details) return null;
  return {
    observedAtUtc: event.details.timestampIso || event.loggedAt || null,
    totalValueUsdObserved: toNumber(event.details.totalValueUsd, NaN),
    tokenXAmountSbtc: toNumber(event.details.tokenXAmount, NaN),
    tokenYAmountUsdcx: toNumber(event.details.tokenYAmount, NaN),
    lpTokenAmount: event.details.lpTokenAmount || '',
    unsignedBinId: event.details.unsignedBinId || '',
    coversActiveBin: event.details.coversActiveBin === true,
  };
}

function buildMarkdown(summary) {
  const lines = [
    '# DOG MM PnL Summary',
    '',
    `- generated_at_utc: ${summary.generatedAtUtc}`,
    `- cycle_status: ${summary.cycle.status}`,
    `- wallet_address: ${summary.wallet.address}`,
    `- inventory_snapshot_age_hours: ${summary.currentInventory.snapshotAgeHours ?? 'n/a'}`,
    '',
    '## Swap Entry',
    '',
    `- amount_in_sats: ${summary.swapEntry.amountInSats ?? 'n/a'}`,
    `- amount_in_btc: ${summary.swapEntry.amountInBtc ?? 'n/a'}`,
    `- amount_out_usdcx: ${summary.swapEntry.amountOutUsdcx ?? 'n/a'}`,
    `- swap_txid: ${summary.swapEntry.txid || 'n/a'}`,
    '',
    '## Gas',
    '',
    `- swap_gas_stx: ${summary.gas.swap.stx ?? 'n/a'}`,
    `- swap_gas_usd: ${summary.gas.swap.usdNow ?? 'n/a'}`,
    `- lp_add_gas_stx: ${summary.gas.lpAdd.stx ?? 'n/a'}`,
    `- lp_add_gas_usd: ${summary.gas.lpAdd.usdNow ?? 'n/a'}`,
    `- close_gas_stx: ${summary.gas.close.stx ?? 'unavailable'}`,
    `- close_gas_usd: ${summary.gas.close.usdNow ?? 'unavailable'}`,
    `- total_gas_paid_stx_known: ${summary.gas.totalKnownStx ?? 'n/a'}`,
    `- total_gas_paid_usd_known: ${summary.gas.totalKnownUsdNow ?? 'n/a'}`,
    '',
    '## Inventory',
    '',
    `- deployed_sbtc: ${summary.deployedInventory.sbtc ?? 'n/a'}`,
    `- deployed_usdcx: ${summary.deployedInventory.usdcx ?? 'n/a'}`,
    `- deployed_value_usd_at_entry_mark: ${summary.deployedInventory.valueUsdAtEntryMark ?? 'n/a'}`,
    `- latest_observed_sbtc: ${summary.currentInventory.tokenXAmountSbtc ?? 'n/a'}`,
    `- latest_observed_usdcx: ${summary.currentInventory.tokenYAmountUsdcx ?? 'n/a'}`,
    `- latest_observed_total_value_usd: ${summary.currentInventory.totalValueUsdObserved ?? 'n/a'}`,
    `- marked_now_value_usd_from_last_observed_balances: ${summary.currentInventory.markedValueUsdNow ?? 'n/a'}`,
    '',
    '## PnL',
    '',
    `- fees_accumulated_lp_usd: ${summary.pnl.feesAccumulatedLpUsd ?? 'unavailable'}`,
    `- gross_pnl_usd_vs_entry_mark: ${summary.pnl.grossUsd ?? 'n/a'}`,
    `- net_pnl_usd_after_known_gas: ${summary.pnl.netAfterKnownGasUsd ?? 'n/a'}`,
    '',
    '## Notes',
    '',
  ];

  for (const note of summary.notes) {
    lines.push(`- ${note}`);
  }

  return `${lines.join('\n')}\n`;
}

async function getTxSummary(txid, stxUsdNow) {
  if (!isRealTxid(txid)) {
    return {
      txid: txid || '',
      available: false,
      microStx: null,
      stx: null,
      usdNow: null,
      status: 'unavailable',
    };
  }

  const tx = await fetchJson(`https://api.hiro.so/extended/v1/tx/${normalizeTxid(txid)}`);
  const microStx = toNumber(tx.fee_rate, NaN);
  const stx = microStx / 1_000_000;
  return {
    txid: tx.tx_id || txid,
    available: true,
    microStx,
    stx: round(stx, 6),
    usdNow: round(stx * stxUsdNow, 6),
    status: tx.tx_status || 'unknown',
    blockTimeIso: tx.block_time_iso || null,
  };
}

async function main() {
  const [opsBundle, lpAddPlan, events, marketPrices] = await Promise.all([
    readJson(OPS_BUNDLE_FILE),
    readJson(LP_ADD_PLAN_FILE),
    readJsonLines(OPS_LOG_FILE),
    fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,blockstack&vs_currencies=usd'),
  ]);

  const btcUsdNow = toNumber(marketPrices?.bitcoin?.usd, NaN);
  const stxUsdNow = toNumber(marketPrices?.blockstack?.usd, NaN);
  const swapEvent = findLastEvent(events, 'phase0_swap_executed');
  const openEvent = findLastEvent(events, 'phase0_open_recorded');
  const closeEvent = findLastEvent(events, 'phase0_close_recorded');
  const heartbeatEvent = findLastEvent(events, 'heartbeat_success');

  const swapTxId = swapEvent?.details?.swapTxId || '';
  const openTxId = openEvent?.details?.txHashOpen || lpAddPlan?.transaction?.txid || '';
  const closeTxId = closeEvent?.details?.txHashClose || '';
  const [swapGas, lpAddGas, closeGas] = await Promise.all([
    getTxSummary(swapTxId, stxUsdNow),
    getTxSummary(openTxId, stxUsdNow),
    getTxSummary(closeTxId, stxUsdNow),
  ]);

  const heartbeatInventory = extractLpInventoryFromHeartbeat(heartbeatEvent);
  const entrySbtc = toNumber(lpAddPlan?.position?.xAmount, NaN) / 100_000_000;
  const entryUsdcx = toNumber(lpAddPlan?.position?.yAmount, NaN) / 1_000_000;
  const entrySbtcUsd = toNumber(opsBundle?.phase1?.poolSnapshot?.tokens?.sBTC?.priceUsd, NaN);
  const entryValueUsdAtEntryMark =
    Number.isFinite(entrySbtcUsd) && Number.isFinite(entrySbtc) && Number.isFinite(entryUsdcx)
      ? entrySbtc * entrySbtcUsd + entryUsdcx
      : NaN;

  const currentMarkedValueUsdNow =
    heartbeatInventory &&
    Number.isFinite(heartbeatInventory.tokenXAmountSbtc) &&
    Number.isFinite(heartbeatInventory.tokenYAmountUsdcx) &&
    Number.isFinite(btcUsdNow)
      ? heartbeatInventory.tokenXAmountSbtc * btcUsdNow + heartbeatInventory.tokenYAmountUsdcx
      : NaN;

  const totalKnownGasStx =
    (swapGas.stx || 0) + (lpAddGas.stx || 0) + (closeGas.available ? closeGas.stx || 0 : 0);
  const totalKnownGasUsdNow =
    (swapGas.usdNow || 0) + (lpAddGas.usdNow || 0) + (closeGas.available ? closeGas.usdNow || 0 : 0);

  const grossUsd =
    Number.isFinite(currentMarkedValueUsdNow) && Number.isFinite(entryValueUsdAtEntryMark)
      ? currentMarkedValueUsdNow - entryValueUsdAtEntryMark
      : NaN;

  const netAfterKnownGasUsd =
    Number.isFinite(grossUsd) && Number.isFinite(totalKnownGasUsdNow)
      ? grossUsd - totalKnownGasUsdNow
      : NaN;

  const snapshotAgeHours =
    heartbeatInventory?.observedAtUtc
      ? (Date.now() - new Date(heartbeatInventory.observedAtUtc).getTime()) / (1000 * 60 * 60)
      : NaN;

  const summary = {
    generatedAtUtc: new Date().toISOString(),
    wallet: {
      address: lpAddPlan?.wallet?.address || opsBundle?.status?.wallet?.stxAddress || '',
      name: lpAddPlan?.wallet?.name || opsBundle?.status?.wallet?.name || '',
    },
    market: {
      btcUsdNow: round(btcUsdNow, 2),
      stxUsdNow: round(stxUsdNow, 6),
      entrySbtcUsd: round(entrySbtcUsd, 6),
    },
    cycle: {
      status: closeGas.available ? 'closed_or_closing' : 'open',
      openTxId: openTxId || '',
      closeTxId: closeTxId || '',
    },
    swapEntry: {
      txid: swapTxId || '',
      amountInSats: swapEvent?.details?.amountInSats || '',
      amountInBtc: round(toNumber(swapEvent?.details?.amountInSats, NaN) / 100_000_000, 8),
      amountOutUsdcx: round(toNumber(swapEvent?.details?.amountOutUsdcx, NaN), 6),
      observedAtUtc: swapEvent?.loggedAt || null,
    },
    gas: {
      swap: swapGas,
      lpAdd: lpAddGas,
      close: closeGas,
      totalKnownStx: round(totalKnownGasStx, 6),
      totalKnownUsdNow: round(totalKnownGasUsdNow, 6),
    },
    deployedInventory: {
      sbtc: round(entrySbtc, 8),
      usdcx: round(entryUsdcx, 6),
      valueUsdAtEntryMark: round(entryValueUsdAtEntryMark, 6),
    },
    currentInventory: {
      observedAtUtc: heartbeatInventory?.observedAtUtc || null,
      snapshotAgeHours: round(snapshotAgeHours, 2),
      lpTokenAmount: heartbeatInventory?.lpTokenAmount || '',
      tokenXAmountSbtc: round(heartbeatInventory?.tokenXAmountSbtc, 8),
      tokenYAmountUsdcx: round(heartbeatInventory?.tokenYAmountUsdcx, 6),
      totalValueUsdObserved: round(heartbeatInventory?.totalValueUsdObserved, 6),
      markedValueUsdNow: round(currentMarkedValueUsdNow, 6),
    },
    pnl: {
      feesAccumulatedLpUsd: null,
      grossUsd: round(grossUsd, 6),
      netAfterKnownGasUsd: round(netAfterKnownGasUsd, 6),
    },
    notes: [],
  };

  if (!heartbeatInventory) {
    summary.notes.push('No heartbeat_success snapshot was found for current LP inventory.');
  } else {
    summary.notes.push(
      `Current inventory uses the latest observed heartbeat snapshot at ${heartbeatInventory.observedAtUtc}.`
    );
  }

  if (!closeGas.available) {
    summary.notes.push('Close gas is unavailable because there is no valid close transaction recorded yet.');
  }

  summary.notes.push(
    'feesAccumulatedLpUsd remains unavailable because local state does not expose a trustworthy fee-accrual field separate from inventory drift.'
  );
  summary.notes.push(
    'grossUsd is mark-to-market against the LP add inventory at the entry sBTC/USD mark from the local DOG MM ops bundle.'
  );
  summary.notes.push(
    'netAfterKnownGasUsd subtracts only known on-chain gas for swap and LP add, plus close if a real close transaction exists.'
  );

  ensureDir(OUTPUT_JSON);
  ensureDir(OUTPUT_MD);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2));
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(summary));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => {
  console.error(`DOG MM PnL summary failed: ${error.message}`);
  process.exit(1);
});
