#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ecc = require('tiny-secp256k1');
const { BIP32Factory } = require('bip32');
const bip32 = BIP32Factory(ecc);
const { mnemonicToSeedSync } = require('@scure/bip39');
const bitcoin = require('bitcoinjs-lib');
const { Signer, Verifier } = require('bip322-js');

const DEFAULTS = {
  displayName: 'Speedy Indra',
  btcAddress: 'bc1q7maxug87p9ul7cl8yvmv6za8aqxfpfea0h6tc9',
  stxAddress: 'SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT',
  derivationPath: "m/84'/0'/0'/0/0",
  helperBaseUrl: 'http://127.0.0.1:8765',
  apiBaseUrl: 'https://aibtc.com',
  minIntervalMs: 5 * 60 * 1000,
  walletName: 'leather',
  walletId: '',
  walletPassword: '',
};

function parseArgs(argv) {
  const flags = {
    dryRun: false,
    force: false,
    statusOnly: false,
    help: false,
  };
  const values = {};
  for (const arg of argv) {
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (arg === '--force') {
      flags.force = true;
      continue;
    }
    if (arg === '--status-only') {
      flags.statusOnly = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
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
  console.log(`AIBTC heartbeat CLI

Usage:
  node active/tools/aibtc-heartbeat-cli.cjs [--status-only] [--dry-run] [--force]

Environment:
  AIBTC_HEARTBEAT_MNEMONIC or CLIENT_MNEMONIC   optional mnemonic used to derive the BTC signer
  AIBTC_WALLET_PASSWORD                         optional managed wallet password used to decrypt the keystore
  AIBTC_WALLET_NAME                             default leather
  AIBTC_WALLET_ID                               optional wallet id override
  AIBTC_HEARTBEAT_BTC_ADDRESS                   expected BTC address
  AIBTC_HEARTBEAT_STX_ADDRESS                   STX address used in local logs
  AIBTC_HEARTBEAT_DISPLAY_NAME                  display name used in local logs
  AIBTC_HEARTBEAT_DERIVATION_PATH               default m/84'/0'/0'/0/0
  AIBTC_HELPER_BASE_URL                         default http://127.0.0.1:8765
  AIBTC_API_BASE_URL                            default https://aibtc.com

Behavior:
  --status-only  fetch remote heartbeat orientation without signing
  --dry-run      derive address and prepare signed payload without posting
  --force        skip local 5 minute guard
  --wallet-name=<name>  managed wallet name used if no mnemonic is provided
  --wallet-id=<id>      managed wallet id used if no mnemonic is provided
`);
}

function readConfig(values) {
  return {
    displayName: process.env.AIBTC_HEARTBEAT_DISPLAY_NAME || DEFAULTS.displayName,
    btcAddress: process.env.AIBTC_HEARTBEAT_BTC_ADDRESS || DEFAULTS.btcAddress,
    stxAddress: process.env.AIBTC_HEARTBEAT_STX_ADDRESS || DEFAULTS.stxAddress,
    derivationPath: process.env.AIBTC_HEARTBEAT_DERIVATION_PATH || DEFAULTS.derivationPath,
    helperBaseUrl: process.env.AIBTC_HELPER_BASE_URL || DEFAULTS.helperBaseUrl,
    apiBaseUrl: process.env.AIBTC_API_BASE_URL || DEFAULTS.apiBaseUrl,
    mnemonic: process.env.AIBTC_HEARTBEAT_MNEMONIC || process.env.CLIENT_MNEMONIC || '',
    walletName: values['wallet-name'] || process.env.AIBTC_WALLET_NAME || DEFAULTS.walletName,
    walletId: values['wallet-id'] || process.env.AIBTC_WALLET_ID || DEFAULTS.walletId,
    walletPassword: process.env.AIBTC_WALLET_PASSWORD || DEFAULTS.walletPassword,
  };
}

function loadWalletCatalog() {
  const catalogPath = path.join(process.env.USERPROFILE || '', '.aibtc', 'wallets.json');
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
}

function chooseWallet(catalog, walletName, expectedAddress, walletId) {
  if (walletId) {
    const byId = catalog.wallets.find(wallet => wallet.id === walletId);
    if (!byId) {
      throw new Error(`wallet id not found: ${walletId}`);
    }
    return byId;
  }

  const matches = catalog.wallets
    .filter(wallet => wallet.name === walletName)
    .filter(wallet => !expectedAddress || wallet.btcAddress === expectedAddress)
    .sort((left, right) => {
      const leftDate = new Date(left.lastUsed || left.createdAt || 0).getTime();
      const rightDate = new Date(right.lastUsed || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    });

  if (matches.length === 0) {
    throw new Error(
      `no wallet named ${walletName} matched the expected BTC address ${expectedAddress}`
    );
  }

  return matches[0];
}

function decryptMnemonic(walletId, walletPassword) {
  const keystorePath = path.join(
    process.env.USERPROFILE || '',
    '.aibtc',
    'wallets',
    walletId,
    'keystore.json'
  );
  const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf8'));
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

function deriveSigner(config) {
  let mnemonic = config.mnemonic;
  let wallet = null;

  if (!mnemonic) {
    if (!config.walletPassword) {
      throw new Error(
        'missing signer source: set AIBTC_HEARTBEAT_MNEMONIC/CLIENT_MNEMONIC or provide AIBTC_WALLET_PASSWORD for the managed wallet'
      );
    }
    const catalog = loadWalletCatalog();
    wallet = chooseWallet(catalog, config.walletName, config.btcAddress, config.walletId);
    mnemonic = decryptMnemonic(wallet.id, config.walletPassword);
  }
  const seed = Buffer.from(mnemonicToSeedSync(mnemonic));
  const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
  const child = root.derivePath(config.derivationPath);
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: bitcoin.networks.bitcoin,
  });
  if (!payment.address) {
    throw new Error('failed to derive p2wpkh address');
  }
  if (payment.address !== config.btcAddress) {
    throw new Error(`derived address ${payment.address} does not match expected ${config.btcAddress}`);
  }
  return {
    address: payment.address,
    wif: child.toWIF(),
    wallet,
  };
}

function extractLastCheckIn(statusBody) {
  return (
    statusBody?.orientation?.lastActiveAt ||
    statusBody?.orientation?.lastCheckInAt ||
    statusBody?.lastCheckInAt ||
    null
  );
}

function computeWindow(lastCheckInAtIso) {
  if (!lastCheckInAtIso) {
    return {
      readyNow: true,
      waitMs: 0,
      nextCheckInAt: null,
      lastCheckInAt: null,
    };
  }
  const lastMs = Date.parse(lastCheckInAtIso);
  if (Number.isNaN(lastMs)) {
    return {
      readyNow: true,
      waitMs: 0,
      nextCheckInAt: null,
      lastCheckInAt: lastCheckInAtIso,
    };
  }
  const nextMs = lastMs + DEFAULTS.minIntervalMs;
  const waitMs = Math.max(0, nextMs - Date.now());
  return {
    readyNow: waitMs === 0,
    waitMs,
    nextCheckInAt: new Date(nextMs).toISOString(),
    lastCheckInAt: lastCheckInAtIso,
  };
}

function buildHeartbeatMessage(timestampIso) {
  return `AIBTC Check-In | ${timestampIso}`;
}

async function tryLogEvent(config, type, details) {
  const payload = {
    type,
    displayName: config.displayName,
    btcAddress: config.btcAddress,
    stxAddress: config.stxAddress,
    details,
  };
  try {
    return await fetchJson(`${config.helperBaseUrl}/api/log-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return {
      status: 0,
      body: { error: error.message, source: 'helper_log_event' },
    };
  }
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  const config = readConfig(values);
  const statusUrl = `${config.apiBaseUrl}/api/heartbeat?address=${encodeURIComponent(config.btcAddress)}`;
  const statusResult = await fetchJson(statusUrl);
  const lastCheckInAt = extractLastCheckIn(statusResult.body);
  const windowInfo = computeWindow(lastCheckInAt);

  if (flags.statusOnly) {
    console.log(JSON.stringify({ config: { ...config, mnemonic: undefined }, statusResult, windowInfo }, null, 2));
    return;
  }

  if (!flags.force && !windowInfo.readyNow) {
    console.log(JSON.stringify({
      ok: false,
      skipped: true,
      reason: 'heartbeat_not_ready',
      statusResult,
      windowInfo,
    }, null, 2));
    return;
  }

  const signer = deriveSigner(config);
  const timestampIso = new Date().toISOString();
  const message = buildHeartbeatMessage(timestampIso);
  const signature = Signer.sign(signer.wif, signer.address, message);
  const verified = Verifier.verifySignature(signer.address, message, signature);
  if (!verified) {
    throw new Error('locally generated heartbeat signature did not verify');
  }

  const payload = {
    signature,
    timestamp: timestampIso,
    btcAddress: signer.address,
  };

  if (flags.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      signerAddress: signer.address,
      derivationPath: config.derivationPath,
      timestampIso,
      message,
      payload,
      statusResult,
      windowInfo,
    }, null, 2));
    return;
  }

  const postResult = await fetchJson(`${config.apiBaseUrl}/api/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const finalStatusResult = await fetchJson(statusUrl);
  const logType = postResult.status === 200 ? 'heartbeat_success' : 'heartbeat_attempt';
  const logResult = await tryLogEvent(config, logType, {
    timestampIso,
    postResult,
    statusResult: finalStatusResult,
  });

    console.log(JSON.stringify({
      ok: postResult.status === 200,
      signerAddress: signer.address,
      signerWallet: signer.wallet
        ? {
            id: signer.wallet.id,
            name: signer.wallet.name,
            address: signer.wallet.address,
            btcAddress: signer.wallet.btcAddress,
          }
        : null,
      derivationPath: config.derivationPath,
      timestampIso,
      message,
    postResult,
    statusResult: finalStatusResult,
    logResult,
  }, null, 2));

  if (postResult.status !== 200) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
  }, null, 2));
  process.exit(1);
});
