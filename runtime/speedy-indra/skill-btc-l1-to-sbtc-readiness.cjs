const fs = require('fs');
const path = require('path');
const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');

const HIRO_API = 'https://api.hiro.so';
const BRIDGE_UI_URL = 'https://bridge.stx.eco';

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (['signature', 'walletPassword', 'mnemonic', 'wif', 'hex'].includes(key)) {
      sanitized[key] = item ? '[REDACTED]' : item;
      continue;
    }
    sanitized[key] = sanitizeValue(item);
  }
  return sanitized;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getWalletCatalogPath() {
  return path.join(process.env.USERPROFILE || '', '.aibtc', 'wallets.json');
}

function findWalletMatch(config) {
  const catalog = readJsonIfExists(getWalletCatalogPath());
  if (!catalog?.wallets?.length) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'wallet_catalog_missing',
    };
  }
  const matches = catalog.wallets
    .filter(wallet => wallet.address === config.stxAddress || wallet.btcAddress === config.btcAddress)
    .sort((left, right) => {
      const leftDate = new Date(left.lastUsed || left.createdAt || 0).getTime();
      const rightDate = new Date(right.lastUsed || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    });
  if (matches.length === 0) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'wallet_not_found_in_catalog',
    };
  }
  const wallet = matches[0];
  return {
    ok: true,
    status: 'ready',
    wallet: {
      id: wallet.id,
      name: wallet.name,
      stxAddress: wallet.address || null,
      btcAddress: wallet.btcAddress || null,
      taprootAddress: wallet.taprootAddress || null,
      network: wallet.network || null,
    },
  };
}

function checkSignerReadiness(walletMatch) {
  if (!walletMatch.ok) {
    return {
      ok: false,
      status: 'not_ready',
      reason: walletMatch.reason,
    };
  }
  const walletPassword = process.env.AIBTC_WALLET_PASSWORD || process.env.DOG_MM_WALLET_PASSWORD || '';
  const mnemonic = process.env.AIBTC_HEARTBEAT_MNEMONIC || process.env.CLIENT_MNEMONIC || '';
  if (!walletPassword && !mnemonic) {
    return {
      ok: false,
      status: 'locked',
      reason: 'wallet_signer_material_missing',
    };
  }
  return {
    ok: true,
    status: 'ready',
    source: mnemonic ? 'env_mnemonic' : 'wallet_keystore',
  };
}

async function fetchBtcBalance(address) {
  if (!address) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'missing_btc_address',
      balanceSats: 0,
    };
  }
  try {
    const response = await fetchJson(`https://mempool.space/api/address/${encodeURIComponent(address)}`);
    if (!response.ok) {
      return {
        ok: false,
        status: 'degraded',
        reason: 'btc_balance_lookup_failed',
        responseStatus: response.status,
        balanceSats: 0,
      };
    }
    const chainStats = response.body?.chain_stats || {};
    const mempoolStats = response.body?.mempool_stats || {};
    const funded = Number(chainStats.funded_txo_sum || 0) + Number(mempoolStats.funded_txo_sum || 0);
    const spent = Number(chainStats.spent_txo_sum || 0) + Number(mempoolStats.spent_txo_sum || 0);
    const balanceSats = Math.max(0, funded - spent);
    return {
      ok: true,
      status: balanceSats > 0 ? 'ready' : 'empty',
      address,
      balanceSats,
      txCount: Number(chainStats.tx_count || 0),
    };
  } catch (error) {
    return {
      ok: false,
      status: 'degraded',
      reason: 'btc_balance_lookup_failed',
      error: error.message,
      balanceSats: 0,
    };
  }
}

async function checkNetworkStatus() {
  const result = {
    btc: { ok: false, status: 'degraded' },
    stacks: { ok: false, status: 'degraded' },
  };
  try {
    const btc = await fetchJson('https://mempool.space/api/blocks/tip/height');
    result.btc = {
      ok: btc.ok,
      status: btc.ok ? 'ready' : 'degraded',
      responseStatus: btc.status,
      tipHeight: btc.ok ? Number(btc.body.raw || btc.body) : null,
    };
  } catch (error) {
    result.btc = {
      ok: false,
      status: 'degraded',
      reason: 'btc_network_probe_failed',
      error: error.message,
    };
  }

  try {
    const stacks = await fetchJson(`${HIRO_API}/v2/info`);
    result.stacks = {
      ok: stacks.ok,
      status: stacks.ok ? 'ready' : 'degraded',
      responseStatus: stacks.status,
      burnBlockHeight: stacks.body?.burn_block_height ?? null,
      stacksTipHeight: stacks.body?.stacks_tip_height ?? null,
    };
  } catch (error) {
    result.stacks = {
      ok: false,
      status: 'degraded',
      reason: 'stacks_network_probe_failed',
      error: error.message,
    };
  }
  return result;
}

async function checkSbtcBridgeReadiness(walletMatch) {
  let bridgeUi;
  try {
    bridgeUi = await fetchJson(BRIDGE_UI_URL);
  } catch (error) {
    bridgeUi = {
      ok: false,
      status: 0,
      body: { error: error.message },
    };
  }
  return {
    ok: bridgeUi.status < 500 && Boolean(walletMatch.wallet?.taprootAddress),
    status: bridgeUi.status < 500 && Boolean(walletMatch.wallet?.taprootAddress) ? 'partial' : 'not_ready',
    mode: 'manual_ui',
    bridgeUrl: BRIDGE_UI_URL,
    bridgeUiReachable: bridgeUi.status < 500,
    walletHasTaproot: Boolean(walletMatch.wallet?.taprootAddress),
    apiPossible: false,
    dependencies: walletMatch.wallet?.taprootAddress
      ? ['manual_bridge_required']
      : ['taproot_address_missing', 'manual_bridge_required'],
  };
}

async function runBtcL1ToSbtcReadinessSkill(options = {}) {
  const config = loadAgentConfig();
  const nowIso = new Date().toISOString();
  const statusOnly = parseBoolean(options.statusOnly, false);
  const dryRun = options.dryRun === undefined ? true : parseBoolean(options.dryRun, true);
  const persist = options.persist === undefined ? true : parseBoolean(options.persist, true);

  appendJsonLog('btc_l1_to_sbtc_readiness_started', { statusOnly, dryRun });

  const walletMatch = findWalletMatch(config);
  const signerReadiness = checkSignerReadiness(walletMatch);
  const btcWallet = await fetchBtcBalance(walletMatch.wallet?.btcAddress || config.btcAddress);
  const network = await checkNetworkStatus();
  const sbtcBridge = await checkSbtcBridgeReadiness(walletMatch);

  const blockers = [];
  if (!walletMatch.ok) blockers.push(walletMatch.reason || 'wallet_not_ready');
  if (!signerReadiness.ok) blockers.push(signerReadiness.reason || 'signer_not_ready');
  if (!btcWallet.ok) blockers.push(btcWallet.reason || 'btc_balance_unavailable');
  if (!network.btc.ok) blockers.push(network.btc.reason || 'btc_network_unavailable');
  if (!network.stacks.ok) blockers.push(network.stacks.reason || 'stacks_network_unavailable');
  if (!sbtcBridge.bridgeUiReachable) blockers.push('sbtc_bridge_ui_unreachable');
  if (!sbtcBridge.walletHasTaproot) blockers.push('taproot_address_missing');
  blockers.push('manual_bridge_required');

  const status =
    walletMatch.ok && signerReadiness.ok && btcWallet.ok && network.btc.ok && network.stacks.ok && sbtcBridge.bridgeUiReachable
      ? 'partial'
      : 'not_ready';

  const result = {
    ok: true,
    skill: 'btc-l1-to-sbtc-readiness',
    status,
    dryRun,
    statusOnly,
    btcWallet: sanitizeValue({
      ok: walletMatch.ok && signerReadiness.ok,
      address: walletMatch.wallet?.btcAddress || config.btcAddress,
      signerReady: signerReadiness.ok,
      balanceSats: btcWallet.balanceSats,
      wallet: walletMatch.wallet || null,
    }),
    sbtcBridge: sanitizeValue(sbtcBridge),
    network: sanitizeValue(network),
    blockers: [...new Set(blockers)],
    recommendation: 'manual_bridge_required',
  };

  if (persist) {
    const finalState = updateAgentState(current => {
      current.btcL1ReadinessStatus = {
        implemented: true,
        status: result.status,
        recommendation: result.recommendation,
      };
      current.lastBtcL1ReadinessCheckAt = nowIso;
      current.btcL1KnownBlockers = result.blockers;
      return current;
    });
    result.state = finalState;
    writeAgentStatus({
      checkedAt: nowIso,
      btcL1Readiness: finalState.btcL1ReadinessStatus,
    });
  }

  appendJsonLog('btc_l1_to_sbtc_readiness_completed', sanitizeValue({
    status: result.status,
    blockers: result.blockers,
  }));

  return result;
}

module.exports = {
  runBtcL1ToSbtcReadinessSkill,
};
