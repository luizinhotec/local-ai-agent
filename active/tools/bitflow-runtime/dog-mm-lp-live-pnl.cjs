#!/usr/bin/env node
'use strict';

const path = require('path');
const { loadRuntimeEnv } = require('./runtime-env.cjs');

const ADDRESS = 'SP1GNF1SGP89KT980XRTRMFKZG4H5P3CDS70Y4NRF';
const ROUTER_CONTRACT = 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-liquidity-router-v-1-1';
const ROUTER_FUNCTION = 'add-relative-liquidity-same-multi';
const WITHDRAW_FUNCTION = 'withdraw-relative-liquidity-same-multi';
const POOL_TOKEN_ASSET_ID = 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-1::pool-token';
const SBTC_ASSET_ID = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token';
const USDCX_ASSET_ID = 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx::usdcx-token';
const LIVE_STATUS_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'get-dog-mm-phase0-live-status.ps1');

function toNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'local-ai-agent/dog-mm-lp-live-pnl',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function fetchAddressTransactions(address, limit = 50) {
  return fetchJson(`https://api.hiro.so/extended/v1/address/${address}/transactions?limit=${limit}`);
}

function extractUint(repr, fieldName) {
  if (typeof repr !== 'string' || !fieldName) return 0;
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = repr.match(new RegExp(`\\(${escaped}\\s+u(\\d+)\\)`));
  return match ? toNumber(match[1], 0) : 0;
}

function extractResultListUint(repr) {
  if (typeof repr !== 'string') return 0;
  const match = repr.match(/\(results\s+\(list\s+u(\d+)\)\)/);
  return match ? toNumber(match[1], 0) : 0;
}

function isSuccessfulTx(tx) {
  return tx?.tx_status === 'success';
}

function isRouterCall(tx, functionName) {
  return tx?.contract_call?.contract_id === ROUTER_CONTRACT &&
    tx?.contract_call?.function_name === functionName;
}

function extractAddFromTx(tx) {
  if (!isSuccessfulTx(tx)) return null;
  if (!isRouterCall(tx, ROUTER_FUNCTION)) return null;

  const positionsRepr = tx?.contract_call?.function_args?.[0]?.repr || '';
  const txResultRepr = tx?.tx_result?.repr || '';
  const sbtcAmount = extractUint(positionsRepr, 'x-amount');
  const usdcxAmount = extractUint(positionsRepr, 'y-amount');
  const mintedDlp = extractResultListUint(txResultRepr);

  if (mintedDlp <= 0) return null;

  return {
    txid: tx.tx_id?.replace(/^0x/, '') || '',
    blockTimeIso: tx.block_time_iso || null,
    sbtcRaw: sbtcAmount,
    usdcxRaw: usdcxAmount,
    mintedDlpRaw: mintedDlp,
  };
}

function isWithdrawTx(tx) {
  return isSuccessfulTx(tx) && isRouterCall(tx, WITHDRAW_FUNCTION);
}

async function fetchLiveStatus() {
  const scriptPath = LIVE_STATUS_SCRIPT.replace(/\\/g, '\\\\');
  const command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`;
  const { execFileSync } = require('child_process');
  const raw = execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', LIVE_STATUS_SCRIPT], {
    cwd: path.resolve(__dirname, '..', '..', '..'),
    encoding: 'utf8',
    windowsHide: true,
  });
  return JSON.parse(raw);
}

async function main() {
  loadRuntimeEnv();

  const [txPage, liveStatus, prices] = await Promise.all([
    fetchAddressTransactions(ADDRESS, 50),
    fetchLiveStatus(),
    fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'),
  ]);

  const txs = (txPage.results || [])
    .slice()
    .sort((a, b) => new Date(a.block_time_iso || 0).getTime() - new Date(b.block_time_iso || 0).getTime());
  const lastWithdrawTs = txs
    .filter(isWithdrawTx)
    .reduce((latest, tx) => Math.max(latest, new Date(tx.block_time_iso || 0).getTime()), 0);
  const activePositionTxs = lastWithdrawTs > 0
    ? txs.filter(tx => new Date(tx.block_time_iso || 0).getTime() > lastWithdrawTs)
    : txs;

  const btcUsd = toNumber(prices?.bitcoin?.usd, NaN);
  const adds = activePositionTxs
    .map(extractAddFromTx)
    .filter(Boolean)
    .sort((a, b) => new Date(a.blockTimeIso).getTime() - new Date(b.blockTimeIso).getTime());

  const totalMintedDlpRaw = adds.reduce((sum, item) => sum + item.mintedDlpRaw, 0);
  const currentDlpRaw = toNumber(liveStatus?.lpTokenAmount, 0);
  const positionShare = totalMintedDlpRaw > 0 ? Math.min(1, currentDlpRaw / totalMintedDlpRaw) : NaN;

  const totalSbtcRaw = adds.reduce((sum, item) => sum + item.sbtcRaw, 0);
  const totalUsdcxRaw = adds.reduce((sum, item) => sum + item.usdcxRaw, 0);

  const costSbtc = (totalSbtcRaw * positionShare) / 100_000_000;
  const costUsdcx = (totalUsdcxRaw * positionShare) / 1_000_000;
  const costUsd = Number.isFinite(btcUsd) ? costSbtc * btcUsd + costUsdcx : NaN;

  const liveValueUsd = toNumber(liveStatus?.liquidity?.totalValueUsd, NaN);
  const earnedUsd = toNumber(liveStatus?.earned?.usd, NaN);
  const grossUsd = Number.isFinite(liveValueUsd) && Number.isFinite(costUsd) ? liveValueUsd - costUsd : NaN;
  const netUsd = Number.isFinite(grossUsd) && Number.isFinite(earnedUsd) ? grossUsd + earnedUsd : NaN;

  const summary = {
    generatedAtUtc: new Date().toISOString(),
    walletAddress: ADDRESS,
    pool: liveStatus?.pool || 'sBTC-USDCx',
    activeBinId: liveStatus?.unsignedBinId ?? null,
    coversActiveBin: liveStatus?.coversActiveBin === true,
    dlpBalance: String(currentDlpRaw || ''),
    market: {
      btcUsd: round(btcUsd, 2),
    },
    live: {
      tokenXAmountSbtc: round(toNumber(liveStatus?.liquidity?.tokenXAmount, NaN), 8),
      tokenYAmountUsdcx: round(toNumber(liveStatus?.liquidity?.tokenYAmount, NaN), 6),
      totalValueUsd: round(liveValueUsd, 6),
      earnedUsd: round(earnedUsd, 6),
    },
    costBasis: {
      addsFound: adds.length,
      totalMintedDlp: String(totalMintedDlpRaw || ''),
      currentPositionShare: round(positionShare, 8),
      sbtc: round(costSbtc, 8),
      usdcx: round(costUsdcx, 6),
      totalUsd: round(costUsd, 6),
    },
    pnl: {
      grossUsd: round(grossUsd, 6),
      netUsd: round(netUsd, 6),
    },
    adds,
    notes: [],
  };

  if (lastWithdrawTs > 0) {
    summary.notes.push(`Cost basis starts after the last successful LP withdraw at ${new Date(lastWithdrawTs).toISOString()}.`);
  }

  if (!Number.isFinite(positionShare) || positionShare <= 0) {
    summary.notes.push('Could not derive current position share from minted DLP history.');
  } else if (positionShare < 0.999999) {
    summary.notes.push('Cost basis is prorated because current DLP is lower than total historically minted DLP.');
  } else {
    summary.notes.push('Current DLP matches total minted DLP found in chain history for this address.');
  }

  if (adds.length === 0) {
    summary.notes.push('No successful LP add transactions were found in recent address history.');
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => {
  console.error(`DOG MM LP live PnL failed: ${error.message}`);
  process.exit(1);
});
