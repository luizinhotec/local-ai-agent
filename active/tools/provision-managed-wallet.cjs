#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ecc = require('tiny-secp256k1');
const { BIP32Factory } = require('bip32');
const bip32 = BIP32Factory(ecc);
const { mnemonicToSeedSync } = require('@scure/bip39');
const bitcoin = require('bitcoinjs-lib');
const { generateWallet, getStxAddress } = require('@stacks/wallet-sdk');
bitcoin.initEccLib(ecc);

const DEFAULTS = {
  walletName: process.env.AIBTC_MANAGED_WALLET_NAME || 'agent-mainnet',
  walletId: process.env.AIBTC_MANAGED_WALLET_ID || '',
  network: process.env.AIBTC_MANAGED_WALLET_NETWORK || 'mainnet',
  btcDerivationPath: process.env.AIBTC_MANAGED_WALLET_BTC_DERIVATION_PATH || "m/84'/0'/0'/0/0",
  taprootDerivationPath: process.env.AIBTC_MANAGED_WALLET_BTC_TAPROOT_PATH || "m/86'/0'/0'/0/0",
};

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const [key, value] = current.slice(2).split('=');
    if (value !== undefined) {
      parsed[key] = value;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeMnemonic(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getCatalogPath() {
  return path.join(os.homedir(), '.aibtc', 'wallets.json');
}

function getWalletDirectory(walletId) {
  return path.join(os.homedir(), '.aibtc', 'wallets', walletId);
}

function deriveBitcoinAddresses(mnemonic, btcDerivationPath, taprootDerivationPath) {
  const seed = Buffer.from(mnemonicToSeedSync(mnemonic));
  const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);

  const segwitChild = root.derivePath(btcDerivationPath);
  const segwitPayment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(segwitChild.publicKey),
    network: bitcoin.networks.bitcoin,
  });
  if (!segwitPayment.address) {
    throw new Error('failed_to_derive_btc_address');
  }

  const taprootChild = root.derivePath(taprootDerivationPath);
  const taprootPayment = bitcoin.payments.p2tr({
    internalPubkey: Buffer.from(taprootChild.publicKey).subarray(1, 33),
    network: bitcoin.networks.bitcoin,
  });

  return {
    btcAddress: segwitPayment.address,
    taprootAddress: taprootPayment.address || null,
    btcDerivationPath,
    taprootDerivationPath,
  };
}

async function deriveStacksAddress(mnemonic, network) {
  const wallet = await generateWallet({
    secretKey: mnemonic,
    password: 'managed-wallet-provisioner',
  });
  const account = wallet.accounts?.[0];
  if (!account?.stxPrivateKey) {
    throw new Error('failed_to_derive_stx_private_key');
  }

  return getStxAddress({
    account,
    network,
  });
}

function encryptMnemonic(mnemonic, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const scryptParams = {
    N: 16384,
    r: 8,
    p: 1,
    keyLen: 32,
  };
  const key = crypto.scryptSync(password, salt, scryptParams.keyLen, {
    N: scryptParams.N,
    r: scryptParams.r,
    p: scryptParams.p,
  });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(mnemonic, 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    authTag: authTag.toString('base64'),
    scryptParams,
  };
}

function upsertWallet(catalog, entry) {
  const wallets = Array.isArray(catalog.wallets) ? [...catalog.wallets] : [];
  const existingIndex = wallets.findIndex(wallet =>
    wallet.id === entry.id ||
    wallet.address === entry.address ||
    wallet.btcAddress === entry.btcAddress
  );

  if (existingIndex >= 0) {
    const previous = wallets[existingIndex];
    wallets[existingIndex] = {
      ...previous,
      ...entry,
      createdAt: previous.createdAt || entry.createdAt,
      lastUsed: previous.lastUsed || entry.lastUsed || null,
    };
  } else {
    wallets.push(entry);
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    wallets,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mnemonic = normalizeMnemonic(process.env.AIBTC_MANAGED_WALLET_MNEMONIC);
  const password = String(process.env.AIBTC_MANAGED_WALLET_PASSWORD || '');
  const walletName = args.name || DEFAULTS.walletName;
  const walletId = args['wallet-id'] || DEFAULTS.walletId || crypto.randomUUID();
  const network = args.network || DEFAULTS.network;
  const btcDerivationPath = args['btc-derivation-path'] || DEFAULTS.btcDerivationPath;
  const taprootDerivationPath = args['taproot-derivation-path'] || DEFAULTS.taprootDerivationPath;

  if (!mnemonic) {
    throw new Error('missing AIBTC_MANAGED_WALLET_MNEMONIC');
  }
  if (!password) {
    throw new Error('missing AIBTC_MANAGED_WALLET_PASSWORD');
  }
  if (network !== 'mainnet') {
    throw new Error(`unsupported network: ${network}`);
  }

  const bitcoinAddresses = deriveBitcoinAddresses(mnemonic, btcDerivationPath, taprootDerivationPath);
  const stxAddress = await deriveStacksAddress(mnemonic, network);
  const encrypted = encryptMnemonic(mnemonic, password);
  const now = new Date().toISOString();

  const walletDirectory = getWalletDirectory(walletId);
  ensureDirectory(walletDirectory);

  const keystorePath = path.join(walletDirectory, 'keystore.json');
  const keystore = {
    version: 1,
    walletId,
    network,
    createdAt: now,
    encrypted,
  };
  fs.writeFileSync(keystorePath, JSON.stringify(keystore, null, 2));

  const catalogPath = getCatalogPath();
  ensureDirectory(path.dirname(catalogPath));
  const currentCatalog = readJsonIfExists(catalogPath) || { version: 1, wallets: [] };
  const updatedCatalog = upsertWallet(currentCatalog, {
    id: walletId,
    name: walletName,
    address: stxAddress,
    btcAddress: bitcoinAddresses.btcAddress,
    taprootAddress: bitcoinAddresses.taprootAddress,
    network,
    btcDerivationPath,
    taprootDerivationPath,
    createdAt: now,
    lastUsed: null,
  });
  fs.writeFileSync(catalogPath, JSON.stringify(updatedCatalog, null, 2));

  console.log(JSON.stringify({
    ok: true,
    wallet: {
      id: walletId,
      name: walletName,
      stxAddress,
      btcAddress: bitcoinAddresses.btcAddress,
      taprootAddress: bitcoinAddresses.taprootAddress,
      network,
      catalogPath,
      keystorePath,
    },
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
