const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ecc = require('tiny-secp256k1');
const { BIP32Factory } = require('bip32');
const bip32 = BIP32Factory(ecc);
const { mnemonicToSeedSync } = require('@scure/bip39');
const bitcoin = require('bitcoinjs-lib');
const { Signer } = require('bip322-js');
const { generateWallet, getStxAddress } = require('@stacks/wallet-sdk');
const {
  broadcastTransaction,
  makeSTXTokenTransfer,
} = require('@stacks/transactions');
const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');

const HIRO_API = 'https://api.hiro.so';
const MEMPOOL_API = 'https://mempool.space';
const DEFAULT_DERIVATION_PATH = "m/84'/0'/0'/0/0";

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseInteger(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (['signature', 'walletPassword', 'mnemonic', 'wif', 'hex', 'senderKey', 'privateKey'].includes(key)) {
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
  return path.join(os.homedir(), '.aibtc', 'wallets.json');
}

function readWalletCatalog() {
  const catalogPath = getWalletCatalogPath();
  return readJsonIfExists(catalogPath);
}

function findWalletMatch(config) {
  const catalog = readWalletCatalog();
  if (!catalog?.wallets?.length) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'wallet_catalog_missing',
      catalogPath: getWalletCatalogPath(),
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
      catalogPath: getWalletCatalogPath(),
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
      createdAt: wallet.createdAt || null,
      lastUsed: wallet.lastUsed || null,
    },
  };
}

function decryptMnemonic(walletId, walletPassword) {
  const keystorePath = path.join(
    os.homedir(),
    '.aibtc',
    'wallets',
    walletId,
    'keystore.json'
  );
  const keystore = readJsonIfExists(keystorePath);
  if (!keystore?.encrypted) {
    throw new Error('keystore_missing_or_invalid');
  }
  const encrypted = keystore.encrypted;
  const key = crypto.scryptSync(
    walletPassword,
    Buffer.from(encrypted.salt, 'base64'),
    encrypted.scryptParams.keyLen,
    {
      N: encrypted.scryptParams.N,
      r: encrypted.scryptParams.r,
      p: encrypted.scryptParams.p,
    }
  );
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encrypted.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8').trim();
}

function deriveSignerFromSources(config, walletMatch) {
  let mnemonic = process.env.AIBTC_HEARTBEAT_MNEMONIC || process.env.CLIENT_MNEMONIC || '';
  let source = mnemonic ? 'env_mnemonic' : 'wallet_keystore';

  if (!mnemonic) {
    const walletPassword = process.env.AIBTC_WALLET_PASSWORD || '';
    if (!walletPassword) {
      return {
        ok: false,
        status: 'locked',
        reason: 'wallet_password_missing',
        source,
      };
    }
    if (!walletMatch.ok || !walletMatch.wallet?.id) {
      return {
        ok: false,
        status: 'not_ready',
        reason: 'wallet_match_missing',
        source,
      };
    }
    mnemonic = decryptMnemonic(walletMatch.wallet.id, walletPassword);
  }

  const seed = Buffer.from(mnemonicToSeedSync(mnemonic));
  const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
  const child = root.derivePath(process.env.AIBTC_HEARTBEAT_DERIVATION_PATH || DEFAULT_DERIVATION_PATH);
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: bitcoin.networks.bitcoin,
  });
  if (!payment.address) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'failed_to_derive_btc_address',
      source,
    };
  }
  if (payment.address !== config.btcAddress) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'derived_address_mismatch',
      source,
      derivedAddress: payment.address,
      expectedAddress: config.btcAddress,
    };
  }
  return {
    ok: true,
    status: 'ready',
    source,
    address: payment.address,
    wif: child.toWIF(),
    derivationPath: process.env.AIBTC_HEARTBEAT_DERIVATION_PATH || DEFAULT_DERIVATION_PATH,
  };
}

async function deriveStacksSignerFromSources(config, walletMatch) {
  let mnemonic = process.env.AIBTC_HEARTBEAT_MNEMONIC || process.env.CLIENT_MNEMONIC || '';
  let source = mnemonic ? 'env_mnemonic' : 'wallet_keystore';

  if (!mnemonic) {
    const walletPassword = process.env.AIBTC_WALLET_PASSWORD || '';
    if (!walletPassword) {
      return {
        ok: false,
        status: 'locked',
        reason: 'wallet_password_missing',
        source,
      };
    }
    if (!walletMatch.ok || !walletMatch.wallet?.id) {
      return {
        ok: false,
        status: 'not_ready',
        reason: 'wallet_match_missing',
        source,
      };
    }
    mnemonic = decryptMnemonic(walletMatch.wallet.id, walletPassword);
  }

  const wallet = await generateWallet({
    secretKey: mnemonic,
    password: 'speedy-indra-wallet-actions',
  });
  const account = wallet.accounts?.[0];
  if (!account?.stxPrivateKey) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'failed_to_derive_stx_private_key',
      source,
    };
  }
  const derivedAddress = getStxAddress({
    account,
    network: 'mainnet',
  });
  if (derivedAddress !== config.stxAddress) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'derived_stx_address_mismatch',
      source,
      derivedAddress,
      expectedAddress: config.stxAddress,
    };
  }

  return {
    ok: true,
    status: 'ready',
    source,
    address: derivedAddress,
    senderKey: account.stxPrivateKey,
    accountIndex: account.index ?? 0,
  };
}

async function checkBtcBalance(address) {
  if (!address) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'missing_btc_address',
    };
  }
  try {
    const response = await fetchJson(`${MEMPOOL_API}/api/address/${encodeURIComponent(address)}`);
    if (!response.ok) {
      return {
        ok: false,
        status: 'degraded',
        reason: 'btc_balance_lookup_failed',
        response,
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
      hasFunds: balanceSats > 0,
    };
  } catch (error) {
    return {
      ok: false,
      status: 'degraded',
      reason: 'btc_balance_lookup_failed',
      error: error.message,
    };
  }
}

function findTokenBalance(fungibleTokens, needle) {
  const lowerNeedle = needle.toLowerCase();
  for (const [key, value] of Object.entries(fungibleTokens || {})) {
    if (key.toLowerCase().includes(lowerNeedle)) {
      return {
        tokenKey: key,
        balance: Number(value?.balance || 0),
      };
    }
  }
  return {
    tokenKey: null,
    balance: 0,
  };
}

async function checkStacksBalances(stxAddress) {
  if (!stxAddress) {
    return {
      ok: false,
      status: 'not_ready',
      reason: 'missing_stx_address',
    };
  }
  try {
    const response = await fetchJson(`${HIRO_API}/extended/v1/address/${encodeURIComponent(stxAddress)}/balances`);
    if (!response.ok) {
      return {
        ok: false,
        status: 'degraded',
        reason: 'stacks_balance_lookup_failed',
        response,
      };
    }
    const stx = response.body?.stx || {};
    const fungibleTokens = response.body?.fungible_tokens || {};
    const sbtc = findTokenBalance(fungibleTokens, '.sbtc-token');
    const usdcx = findTokenBalance(fungibleTokens, '.usdcx');
    return {
      ok: true,
      status: 'ready',
      stxAddress,
      stxMicroStx: Number(stx.balance || 0),
      sbtcSats: sbtc.balance,
      usdcxBaseUnits: usdcx.balance,
      tokenKeys: {
        sbtc: sbtc.tokenKey,
        usdcx: usdcx.tokenKey,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 'degraded',
      reason: 'stacks_balance_lookup_failed',
      error: error.message,
    };
  }
}

async function checkNetworkStatus() {
  const checks = {
    btc: null,
    stacks: null,
  };

  try {
    const btc = await fetchJson(`${MEMPOOL_API}/api/blocks/tip/height`);
    checks.btc = {
      ok: btc.ok,
      status: btc.ok ? 'ready' : 'degraded',
      tipHeight: btc.ok ? Number(btc.body) || Number(btc.body?.raw) || null : null,
      responseStatus: btc.status,
    };
  } catch (error) {
    checks.btc = {
      ok: false,
      status: 'degraded',
      reason: 'btc_network_probe_failed',
      error: error.message,
    };
  }

  try {
    const stacks = await fetchJson(`${HIRO_API}/v2/info`);
    checks.stacks = {
      ok: stacks.ok,
      status: stacks.ok ? 'ready' : 'degraded',
      burnBlockHeight: stacks.body?.burn_block_height ?? null,
      stacksTipHeight: stacks.body?.stacks_tip_height ?? null,
      responseStatus: stacks.status,
    };
  } catch (error) {
    checks.stacks = {
      ok: false,
      status: 'degraded',
      reason: 'stacks_network_probe_failed',
      error: error.message,
    };
  }

  return checks;
}

function buildDependencyReadiness(walletMatch) {
  const catalogPath = getWalletCatalogPath();
  const keystorePath = walletMatch.ok
    ? path.join(os.homedir(), '.aibtc', 'wallets', walletMatch.wallet.id, 'keystore.json')
    : null;
  return {
    catalogPresent: fs.existsSync(catalogPath),
    keystorePresent: keystorePath ? fs.existsSync(keystorePath) : false,
    walletMatch: walletMatch.ok,
    walletId: walletMatch.wallet?.id || null,
    walletName: walletMatch.wallet?.name || null,
    network: walletMatch.wallet?.network || null,
  };
}

function resolveWalletMicroTargetAddress(config, walletMatch) {
  const sourceAddress = walletMatch.wallet?.stxAddress || config.stxAddress || null;
  const explicitTarget = String(config.walletActions.microTargetAddress || '').trim();
  if (explicitTarget) {
    return {
      ok: true,
      address: explicitTarget,
      source: 'env_wallet_micro_target_address',
      sourceAddress,
    };
  }

  const catalog = readWalletCatalog();
  const controlledCandidates = (catalog?.wallets || [])
    .map(wallet => ({
      address: wallet.address || null,
      walletId: wallet.id || null,
      walletName: wallet.name || null,
      createdAt: wallet.createdAt || null,
      lastUsed: wallet.lastUsed || null,
    }))
    .filter(wallet => wallet.address && wallet.address !== sourceAddress);

  if (controlledCandidates.length > 0) {
    const preferred = controlledCandidates.sort((left, right) => {
      const leftDate = new Date(left.lastUsed || left.createdAt || 0).getTime();
      const rightDate = new Date(right.lastUsed || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    })[0];
    return {
      ok: true,
      address: preferred.address,
      source: 'controlled_wallet_catalog',
      walletId: preferred.walletId,
      walletName: preferred.walletName,
      sourceAddress,
    };
  }

  return {
    ok: false,
    address: null,
    source: explicitTarget ? 'env_wallet_micro_target_address' : 'missing',
    sourceAddress,
    reason: 'wallet_micro_target_missing',
  };
}

function buildMicroActionPlan(config, balances, signerReadiness, nowIso) {
  const probeMessage = `Speedy Indra wallet probe | ${config.stxAddress} | ${config.btcAddress} | ${nowIso}`;
  const suggestedAmountMicroStx = Math.max(
    1,
    Math.min(config.walletActions.microAmountUstx, config.walletActions.maxValueSats)
  );
  return {
    actionType: 'btc_signer_probe',
    status: signerReadiness.ok ? 'ready_for_explicit_live' : 'blocked',
    dryRunDefault: config.walletActions.dryRunDefault,
    liveApprovalRequiredForValueTransfer: config.walletActions.requireApprovalForLive,
    valueTransferImplemented: true,
    probeMessage,
    proofFormat: 'bip322',
    maxValueSats: config.walletActions.maxValueSats,
    valueActionPlan: {
      actionType: 'controlled_transfer_stx_micro',
      status: 'planned_only',
      approvalRequired: true,
      executorAvailable: true,
      reason: null,
      suggestedAmountMicroStx,
      maxFeeMicroStx: config.walletActions.microMaxFeeUstx,
      targetAddress: config.walletActions.microTargetAddress || null,
      memo: 'speedy-indra-micro',
    },
    balancesSnapshot: {
      stxMicroStx: balances?.stacks?.stxMicroStx ?? null,
      sbtcSats: balances?.stacks?.sbtcSats ?? null,
      btcSats: balances?.btc?.balanceSats ?? null,
    },
  };
}

function buildKnownBlockers(featureEnabled, walletMatch, networkStatus, signerReadiness, balances, config) {
  const blockers = [];
  if (!featureEnabled) blockers.push('feature_disabled');
  if (!walletMatch.ok) blockers.push(walletMatch.reason || 'wallet_not_available');
  if (!networkStatus.btc?.ok) blockers.push('btc_network_unavailable');
  if (!networkStatus.stacks?.ok) blockers.push('stacks_network_unavailable');
  if (!signerReadiness.ok) blockers.push(signerReadiness.reason || 'signer_not_ready');
  if (!balances.btc?.hasFunds) blockers.push('btc_balance_empty_or_unavailable');
  if (!balances.stacks?.ok) blockers.push('stacks_balances_unavailable');
  if ((balances.stacks?.stxMicroStx || 0) <= 0) blockers.push('stx_balance_empty_or_unavailable');
  if (config.walletActions.requireApprovalForLive) blockers.push('wallet_live_requires_approval');
  return [...new Set(blockers)];
}

function signProbeMessage(signerReadiness, message) {
  const signature = Signer.sign(signerReadiness.wif, signerReadiness.address, message);
  return {
    ok: true,
    actionType: 'btc_signer_probe',
    signedAt: new Date().toISOString(),
    message,
    address: signerReadiness.address,
    signature,
  };
}

async function buildStxMicroTransferPlan(
  config,
  walletMatch,
  stacksSignerReadiness,
  balances,
  options = {}
) {
  const requestedAmount = parseInteger(options.amountUstx || options['amount-ustx'], null);
  const amountMicroStx = Math.max(
    1,
    Math.min(
      requestedAmount || config.walletActions.microAmountUstx,
      config.walletActions.maxValueSats
    )
  );
  const targetResolution = resolveWalletMicroTargetAddress(config, walletMatch);
  const sourceAddress = stacksSignerReadiness.address || config.stxAddress;
  const targetAddress = targetResolution.address;
  const approvalRequired = config.walletActions.requireApprovalForLive;
  const balanceMicroStx = Number(balances?.stacks?.stxMicroStx || 0);
  const plan = {
    actionType: 'controlled_transfer_stx_micro',
    sourceAddress,
    targetAddress,
    targetSource: targetResolution.source,
    amountMicroStx,
    requestedAmountMicroStx: requestedAmount,
    memo: 'speedy-indra-micro',
    dryRunDefault: config.walletActions.dryRunDefault,
    approvalRequired,
    executorAvailable: stacksSignerReadiness.ok,
    signerReady: stacksSignerReadiness.ok,
    feeEstimateMicroStx: null,
    nonce: null,
    txid: null,
    sufficientBalance: false,
    status: 'blocked',
    reason: null,
    blockers: [],
    prerequisites: {
      featureEnabled: config.featureFlags.walletActions,
      stacksSignerReady: stacksSignerReadiness.ok,
      stacksBalanceKnown: Number.isFinite(balanceMicroStx),
      stacksNetworkReady: true,
      targetResolved: targetResolution.ok,
    },
  };

  if (!config.featureFlags.walletActions) {
    plan.reason = 'feature_disabled';
    plan.blockers.push('feature_disabled');
    return plan;
  }

  if (!stacksSignerReadiness.ok) {
    plan.reason = stacksSignerReadiness.reason || 'stacks_signer_not_ready';
    plan.blockers.push(plan.reason);
    return plan;
  }

  if (!targetResolution.ok || !targetAddress) {
    plan.reason = targetResolution.reason || 'wallet_micro_target_missing';
    plan.blockers.push(plan.reason);
    return plan;
  }

  if (targetAddress === sourceAddress) {
    plan.reason = 'wallet_micro_target_equals_source';
    plan.blockers.push(plan.reason);
    return plan;
  }

  if (amountMicroStx > config.walletActions.maxValueSats) {
    plan.reason = 'amount_above_wallet_max_value';
    plan.blockers.push(plan.reason);
    return plan;
  }

  try {
    const transaction = await makeSTXTokenTransfer({
      recipient: targetAddress,
      amount: BigInt(amountMicroStx),
      senderKey: stacksSignerReadiness.senderKey,
      network: 'mainnet',
      memo: plan.memo,
    });
    const spendingCondition = transaction.auth?.spendingCondition;
    const feeEstimateMicroStx = Number(spendingCondition?.fee?.toString?.() || 0);
    const nonce = spendingCondition?.nonce?.toString?.() || null;
    const txid = transaction.txid();
    const totalCostMicroStx = amountMicroStx + feeEstimateMicroStx;
    plan.transaction = transaction;
    plan.feeEstimateMicroStx = feeEstimateMicroStx;
    plan.nonce = nonce;
    plan.txid = txid;
    plan.totalCostMicroStx = totalCostMicroStx;
    plan.sufficientBalance = balanceMicroStx >= totalCostMicroStx;

    if (feeEstimateMicroStx > config.walletActions.microMaxFeeUstx) {
      plan.reason = 'fee_above_wallet_micro_limit';
      plan.blockers.push(plan.reason);
      return plan;
    }

    if (!plan.sufficientBalance) {
      plan.reason = 'insufficient_stx_for_amount_plus_fee';
      plan.blockers.push(plan.reason);
      return plan;
    }

    plan.status = 'ready_for_explicit_live';
    return plan;
  } catch (error) {
    plan.reason = 'stx_micro_transfer_build_failed';
    plan.blockers.push(plan.reason);
    plan.error = error.message;
    return plan;
  }
}

async function executeStxMicroTransfer(plan) {
  if (!plan?.transaction) {
    return {
      executed: false,
      status: 'blocked',
      actionType: 'controlled_transfer_stx_micro',
      reason: 'transaction_not_built',
    };
  }

  const broadcastResponse = await broadcastTransaction({
    transaction: plan.transaction,
    network: 'mainnet',
  });

  if (broadcastResponse?.error || !broadcastResponse?.txid) {
    return {
      executed: false,
      status: 'failed',
      actionType: 'controlled_transfer_stx_micro',
      reason: 'broadcast_failed',
      broadcastResponse,
    };
  }

  return {
    executed: true,
    status: 'completed',
    actionType: 'controlled_transfer_stx_micro',
    txid: broadcastResponse.txid,
    feeMicroStx: plan.feeEstimateMicroStx,
    amountMicroStx: plan.amountMicroStx,
    recipient: plan.targetAddress,
    broadcastResponse,
  };
}

async function runWalletActionsSkill(options = {}) {
  const config = loadAgentConfig();
  const nowIso = new Date().toISOString();
  const statusOnly = parseBoolean(options.statusOnly, false);
  const dryRun =
    options.dryRun === undefined ? config.walletActions.dryRunDefault : parseBoolean(options.dryRun, true);
  const force = parseBoolean(options.force, false);
  const approveLive = parseBoolean(options.approveLive, false);
  const micro = parseBoolean(options.micro, false);
  const featureEnabled = config.featureFlags.walletActions;

  appendJsonLog('wallet_skill_started', {
    statusOnly,
    dryRun,
    force,
    approveLive,
    micro,
  });

  const walletMatch = findWalletMatch(config);
  const dependencyReadiness = buildDependencyReadiness(walletMatch);
  const networkStatus = await checkNetworkStatus();
  appendJsonLog('wallet_network_checked', sanitizeValue({ networkStatus }));

  const balances = {
    btc: await checkBtcBalance(walletMatch.wallet?.btcAddress || config.btcAddress),
    stacks: await checkStacksBalances(walletMatch.wallet?.stxAddress || config.stxAddress),
  };
  appendJsonLog('wallet_balance_checked', sanitizeValue({ balances }));

  let signerReadiness;
  try {
    signerReadiness = deriveSignerFromSources(config, walletMatch);
  } catch (error) {
    signerReadiness = {
      ok: false,
      status: 'not_ready',
      reason: error.message,
    };
  }
  appendJsonLog('wallet_signer_checked', sanitizeValue({ signerReadiness, dependencyReadiness }));

  let stacksSignerReadiness;
  try {
    stacksSignerReadiness = await deriveStacksSignerFromSources(config, walletMatch);
  } catch (error) {
    stacksSignerReadiness = {
      ok: false,
      status: 'not_ready',
      reason: error.message,
    };
  }
  appendJsonLog('wallet_stx_signer_checked', sanitizeValue({ stacksSignerReadiness }));

  const knownBlockers = buildKnownBlockers(
    featureEnabled,
    walletMatch,
    networkStatus,
    signerReadiness,
    balances,
    config
  );
  const microActionPlan = buildMicroActionPlan(config, balances, signerReadiness, nowIso);
  const stxMicroTransferPlan = await buildStxMicroTransferPlan(
    config,
    walletMatch,
    stacksSignerReadiness,
    balances,
    options
  );
  const { transaction: _transaction, ...sanitizedStxMicroTransferPlan } = stxMicroTransferPlan;
  microActionPlan.valueActionPlan = sanitizeValue({
    ...microActionPlan.valueActionPlan,
    ...sanitizedStxMicroTransferPlan,
  });

  const walletStatus = {
    implemented: true,
    ready:
      walletMatch.ok &&
      networkStatus.btc?.ok &&
      networkStatus.stacks?.ok &&
      balances.stacks?.ok &&
      signerReadiness.ok &&
      stacksSignerReadiness.ok,
    status: knownBlockers.length === 0 ? 'ready' : 'partial',
    wallet: walletMatch.wallet || null,
    balances: sanitizeValue(balances),
    network: sanitizeValue(networkStatus),
    signerReadiness: sanitizeValue({
      ok: signerReadiness.ok,
      status: signerReadiness.status,
      source: signerReadiness.source || null,
      derivationPath: signerReadiness.derivationPath || null,
      address: signerReadiness.address || null,
      reason: signerReadiness.reason || null,
    }),
    stacksSignerReadiness: sanitizeValue({
      ok: stacksSignerReadiness.ok,
      status: stacksSignerReadiness.status,
      source: stacksSignerReadiness.source || null,
      address: stacksSignerReadiness.address || null,
      reason: stacksSignerReadiness.reason || null,
    }),
    dependencyReadiness,
    approvalRequiredForValueActions: config.walletActions.requireApprovalForLive,
  };

  const plan = {
    walletStatus,
    knownBlockers,
    microAction: microActionPlan,
  };
  appendJsonLog('wallet_plan_built', sanitizeValue(plan));

  let actionResult = {
    executed: false,
    status: 'skipped',
    actionType: micro ? 'controlled_transfer_stx_micro' : 'btc_signer_probe',
    reason: dryRun
      ? 'dry_run_default'
      : statusOnly
      ? 'status_only'
      : micro
      ? 'manual_live_requires_explicit_approval'
      : 'manual_execution_only',
  };

  if (!dryRun && !statusOnly) {
    if (micro) {
      appendJsonLog('wallet_live_micro_requested', sanitizeValue({
        approveLive,
        amountMicroStx: stxMicroTransferPlan.amountMicroStx,
        targetAddress: stxMicroTransferPlan.targetAddress,
        feeEstimateMicroStx: stxMicroTransferPlan.feeEstimateMicroStx,
      }));

      if (!approveLive || !config.walletActions.requireApprovalForLive) {
        actionResult = {
          executed: false,
          status: 'blocked',
          actionType: 'controlled_transfer_stx_micro',
          reason: !approveLive
            ? 'approve_live_missing'
            : 'wallet_live_approval_policy_disabled',
          approvalRequired: true,
        };
      } else if (stxMicroTransferPlan.status !== 'ready_for_explicit_live') {
        actionResult = {
          executed: false,
          status: 'blocked',
          actionType: 'controlled_transfer_stx_micro',
          reason: stxMicroTransferPlan.reason || 'micro_transfer_not_ready',
          blockers: stxMicroTransferPlan.blockers || [],
        };
      } else {
        try {
          actionResult = await executeStxMicroTransfer(stxMicroTransferPlan);
        } catch (error) {
          actionResult = {
            executed: false,
            status: 'failed',
            actionType: 'controlled_transfer_stx_micro',
            reason: 'broadcast_failed',
            error: error.message,
          };
        }
      }
    } else if (signerReadiness.ok) {
      actionResult = signProbeMessage(signerReadiness, microActionPlan.probeMessage);
    } else {
      actionResult = {
        executed: false,
        status: 'blocked',
        actionType: 'btc_signer_probe',
        reason: signerReadiness.reason || 'signer_not_ready',
      };
    }

    if (actionResult.executed) {
      appendJsonLog('wallet_micro_action_completed', sanitizeValue(actionResult));
    } else {
      appendJsonLog('wallet_micro_action_skipped', sanitizeValue(actionResult));
    }
  } else {
    appendJsonLog('wallet_micro_action_skipped', sanitizeValue(actionResult));
  }

  const finalState = updateAgentState(current => {
    current.walletStatus = walletStatus;
    current.walletChecks += 1;
    current.lastWalletCheckAt = nowIso;
    current.walletKnownBlockers = knownBlockers;
    current.walletLastPlan = sanitizeValue(plan);
    if (!dryRun && !statusOnly) {
      current.walletActionsAttempted += 1;
      current.lastWalletActionAt = nowIso;
      current.lastWalletActionTxId = actionResult.txid || null;
      current.lastWalletActionOutcome = actionResult.reason || actionResult.status || 'unknown';
      if (actionResult.executed) {
        current.walletActionsSucceeded += 1;
      } else {
        current.walletActionsFailed += 1;
      }
    }
    current.skills.walletActions = {
      ...current.skills.walletActions,
      enabled: featureEnabled,
      lastRunAt: nowIso,
      lastSuccessAt: actionResult.executed ? nowIso : current.skills.walletActions.lastSuccessAt,
      lastFailureAt:
        !dryRun && !statusOnly && !actionResult.executed ? nowIso : current.skills.walletActions.lastFailureAt,
      lastSkipReason: actionResult.executed ? null : actionResult.reason,
      lastOutcome: actionResult.executed ? 'completed' : !dryRun && !statusOnly ? 'blocked' : 'checked',
      lastAttemptMode: dryRun ? 'dry_run' : statusOnly ? 'status_only' : 'live',
      lastStatusCode: 200,
      errorCount:
        !dryRun && !statusOnly && !actionResult.executed
          ? current.skills.walletActions.errorCount + 1
          : current.skills.walletActions.errorCount,
    };
    return current;
  });

  writeAgentStatus({
    checkedAt: nowIso,
    wallet: finalState.walletStatus,
    walletPlan: finalState.walletLastPlan,
  });

  appendJsonLog('wallet_skill_completed', {
    ok: true,
    dryRun,
    statusOnly,
    blockerCount: knownBlockers.length,
    actionExecuted: actionResult.executed,
  });

  return {
    ok: true,
    skill: 'wallet-actions',
    dryRun,
    statusOnly,
    micro,
    walletStatus: sanitizeValue(walletStatus),
    plan: sanitizeValue(plan),
    action: sanitizeValue(actionResult),
    state: finalState,
  };
}

module.exports = {
  runWalletActionsSkill,
};
