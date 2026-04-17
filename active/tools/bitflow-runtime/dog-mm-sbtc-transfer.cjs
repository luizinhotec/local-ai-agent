#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { loadRuntimeEnv } = require('./runtime-env.cjs');
const { generateWallet } = require('@stacks/wallet-sdk');
const {
  broadcastTransaction,
  makeContractCall,
  noneCV,
  PostConditionMode,
  standardPrincipalCV,
  transactionToHex,
  uintCV,
} = require('@stacks/transactions');

const SBTC_CONTRACT = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token';

const DEFAULTS = {
  walletName: process.env.AIBTC_WALLET_NAME || 'agent-mainnet',
  walletId: process.env.AIBTC_WALLET_ID || '',
  expectedAddress: process.env.AIBTC_EXPECTED_ADDRESS || '',
  recipient: process.env.DOG_MM_EXPECTED_ADDRESS || '',
  amount: '',
  fee: process.env.SBTC_TRANSFER_FEE || '50000',
};

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const [rawKey, inlineValue] = current.slice(2).split('=');
    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
      continue;
    }
    if (rawKey === 'broadcast' || rawKey === 'json-only') {
      parsed[rawKey] = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`);
    }
    parsed[rawKey] = next;
    i += 1;
  }
  return parsed;
}

function loadWalletCatalog() {
  const catalogPath = path.join(os.homedir(), '.aibtc', 'wallets.json');
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
}

function chooseWallet(catalog, walletName, expectedAddress, walletId) {
  if (walletId) {
    const byId = catalog.wallets.find(wallet => wallet.id === walletId);
    if (!byId) throw new Error(`Wallet id not found: ${walletId}`);
    return byId;
  }

  const matches = catalog.wallets
    .filter(wallet => !walletName || wallet.name === walletName)
    .filter(wallet => !expectedAddress || wallet.address === expectedAddress)
    .sort((left, right) => {
      const leftDate = new Date(left.lastUsed || left.createdAt || 0).getTime();
      const rightDate = new Date(right.lastUsed || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    });

  if (matches.length === 0) {
    const filters = [];
    if (walletName) filters.push(`name=${walletName}`);
    if (expectedAddress) filters.push(`address=${expectedAddress}`);
    throw new Error(`No wallet matched the requested selector${filters.length ? ` (${filters.join(', ')})` : ''}.`);
  }

  return matches[0];
}

function decryptMnemonic(walletId, walletPassword) {
  const keystorePath = path.join(os.homedir(), '.aibtc', 'wallets', walletId, 'keystore.json');
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
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8').trim();
}

async function deriveSenderKey(mnemonic, accountIndex = 0) {
  const wallet = await generateWallet({
    secretKey: mnemonic,
    password: 'bitflow-runtime',
  });
  const account = wallet.accounts[accountIndex];
  if (!account) throw new Error(`Account index ${accountIndex} not found in derived wallet`);
  return account.stxPrivateKey;
}

function splitContractId(contractId) {
  const index = contractId.indexOf('.');
  if (index < 0) throw new Error(`Invalid contract identifier: ${contractId}`);
  return {
    address: contractId.slice(0, index),
    name: contractId.slice(index + 1),
  };
}

async function main() {
  loadRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const options = {
    walletName: args['wallet-name'] || DEFAULTS.walletName,
    walletId: args['wallet-id'] || DEFAULTS.walletId,
    expectedAddress: args['expected-address'] || DEFAULTS.expectedAddress,
    recipient: args.recipient || DEFAULTS.recipient,
    amount: args.amount || DEFAULTS.amount,
    fee: args.fee || DEFAULTS.fee,
    broadcast: Boolean(args.broadcast),
    jsonOnly: Boolean(args['json-only']),
  };

  if (!options.amount) throw new Error('Missing --amount');
  if (!options.recipient) throw new Error('Missing --recipient');

  const walletPassword = process.env.AIBTC_WALLET_PASSWORD || process.env.DOG_MM_WALLET_PASSWORD || '';
  if (!walletPassword) throw new Error('Missing AIBTC_WALLET_PASSWORD / DOG_MM_WALLET_PASSWORD');

  const catalog = loadWalletCatalog();
  const wallet = chooseWallet(catalog, options.walletName, options.expectedAddress, options.walletId);
  const mnemonic = decryptMnemonic(wallet.id, walletPassword);
  const senderKey = await deriveSenderKey(mnemonic);
  const token = splitContractId(SBTC_CONTRACT);

  const tx = await makeContractCall({
    contractAddress: token.address,
    contractName: token.name,
    functionName: 'transfer',
    functionArgs: [
      uintCV(BigInt(options.amount)),
      standardPrincipalCV(wallet.address),
      standardPrincipalCV(options.recipient),
      noneCV(),
    ],
    senderKey,
    network: 'mainnet',
    fee: BigInt(options.fee),
    postConditionMode: PostConditionMode.Allow,
    postConditions: [],
    validateWithAbi: true,
  });

  const result = {
    generatedAtUtc: new Date().toISOString(),
    broadcast: options.broadcast,
    tokenContract: SBTC_CONTRACT,
    sender: {
      walletId: wallet.id,
      walletName: wallet.name,
      address: wallet.address,
    },
    recipient: options.recipient,
    amount: options.amount,
    transaction: {
      nonce: tx.auth.spendingCondition.nonce.toString(),
      fee: tx.auth.spendingCondition.fee.toString(),
      txid: tx.txid(),
      hex: transactionToHex(tx),
    },
  };

  if (options.broadcast) {
    result.broadcastResponse = await broadcastTransaction({
      transaction: tx,
      network: 'mainnet',
    });
  }

  if (options.jsonOnly) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`DOG MM sBTC transfer ${options.broadcast ? 'broadcast complete' : 'dry run'}\n`);
  process.stdout.write(`sender_wallet: ${wallet.name}\n`);
  process.stdout.write(`sender_address: ${wallet.address}\n`);
  process.stdout.write(`recipient_address: ${options.recipient}\n`);
  process.stdout.write(`amount: ${options.amount}\n`);
  process.stdout.write(`txid: ${result.transaction.txid}\n`);
  process.stdout.write(`nonce: ${result.transaction.nonce}\n`);
  process.stdout.write(`fee: ${result.transaction.fee}\n`);
  if (result.broadcastResponse) {
    process.stdout.write(`broadcast_response: ${JSON.stringify(result.broadcastResponse)}\n`);
  }
}

main().catch(error => {
  process.stderr.write(`DOG MM sBTC transfer failed: ${error.message}\n`);
  process.exit(1);
});
