#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadRuntimeEnv } = require('./runtime-env.cjs');
const { generateWallet } = require('@stacks/wallet-sdk');
const {
  broadcastTransaction,
  contractPrincipalCV,
  cvToValue,
  deserializeCV,
  getAddressFromPrivateKey,
  intCV,
  listCV,
  makeContractCall,
  noneCV,
  PostConditionMode,
  someCV,
  transactionToHex,
  tupleCV,
  uintCV,
} = require('@stacks/transactions');

const DEFAULTS = {
  walletName: process.env.DOG_MM_WALLET_NAME || 'dog-mm-mainnet',
  expectedAddress: process.env.DOG_MM_EXPECTED_ADDRESS || '',
  routerContract: 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-liquidity-router-v-1-1',
  poolContract: 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-1',
  xToken: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token',
  yToken: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx',
  xAmount: '19021',
  yAmount: '9890354',
  activeBinOffset: '0',
  minDlp: '1',
  maxXLiquidityFee: '1000',
  maxYLiquidityFee: '100000',
  maxDeviation: '2',
  fee: '50000',
  stateFile: path.resolve(__dirname, '..', '..', 'state', 'dog-mm', 'bitflow-last-lp-add-plan.json'),
  summaryFile: path.resolve(__dirname, '..', '..', 'state', 'dog-mm', 'bitflow-last-lp-add-plan.md'),
};

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    if (key === 'broadcast' || key === 'json-only' || key === 'no-tolerance') {
      parsed[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function loadWalletCatalog() {
  const catalogPath = path.join(process.env.USERPROFILE, '.aibtc', 'wallets.json');
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

  if (matches.length > 1 && !walletName && !expectedAddress) {
    throw new Error(
      'Multiple wallets are available. Set --wallet-id, --wallet-name, or --expected-address (or DOG_MM_WALLET_NAME / DOG_MM_EXPECTED_ADDRESS).'
    );
  }

  return matches[0];
}

function decryptMnemonic(walletId, walletPassword) {
  const keystorePath = path.join(
    process.env.USERPROFILE,
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

async function deriveSenderKey(mnemonic) {
  const wallet = await generateWallet({
    secretKey: mnemonic,
    password: 'bitflow-runtime',
  });
  return wallet.accounts[0].stxPrivateKey;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(json)}`);
  }
  return json;
}

function splitContractId(contractId) {
  const index = contractId.indexOf('.');
  if (index < 0) throw new Error(`Invalid contract identifier: ${contractId}`);
  return {
    address: contractId.slice(0, index),
    name: contractId.slice(index + 1),
  };
}

async function getPoolForAdd(poolContract, senderAddress) {
  const pool = splitContractId(poolContract);
  const response = await postJson(
    `https://api.hiro.so/v2/contracts/call-read/${pool.address}/${pool.name}/get-pool-for-add`,
    {
      sender: senderAddress,
      arguments: [],
    }
  );

  if (!response.okay || !response.result) {
    throw new Error(`Pool get-pool-for-add failed: ${JSON.stringify(response)}`);
  }

  const decoded = cvToValue(deserializeCV(response.result));
  return {
    raw: response,
    decoded,
    activeBinId: decoded.value['active-bin-id'].value,
    binStep: decoded.value['bin-step'].value,
    coreAddress: decoded.value['core-address'].value,
  };
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeOutputs(result, stateFile, summaryFile) {
  ensureDirectory(stateFile);
  ensureDirectory(summaryFile);
  fs.writeFileSync(stateFile, JSON.stringify(result, null, 2));

  const lines = [
    '# DOG MM Bitflow LP Add Plan',
    '',
    `- generated_at_utc: ${result.generatedAtUtc}`,
    `- mode: ${result.broadcast ? 'broadcast' : 'dry_run'}`,
    `- wallet_name: ${result.wallet.name}`,
    `- wallet_id: ${result.wallet.id}`,
    `- sender_address: ${result.wallet.address}`,
    `- router_contract: ${result.routerContract}`,
    `- pool_contract: ${result.poolContract}`,
    `- x_token: ${result.xToken}`,
    `- y_token: ${result.yToken}`,
    `- x_amount: ${result.position.xAmount}`,
    `- y_amount: ${result.position.yAmount}`,
    `- active_bin_offset: ${result.position.activeBinOffset}`,
    `- expected_bin_id: ${result.position.expectedBinId}`,
    `- max_deviation: ${result.position.maxDeviation}`,
    `- min_dlp: ${result.position.minDlp}`,
    `- max_x_liquidity_fee: ${result.position.maxXLiquidityFee}`,
    `- max_y_liquidity_fee: ${result.position.maxYLiquidityFee}`,
    `- nonce: ${result.transaction.nonce}`,
    `- fee: ${result.transaction.fee}`,
    `- txid: ${result.transaction.txid}`,
    '',
    '## Position',
    '',
    `- signed_active_bin_id_from_pool: ${result.poolMetadata.signedActiveBinId}`,
    `- pool_bin_step: ${result.poolMetadata.binStep}`,
    `- pool_core_address: ${result.poolMetadata.coreAddress}`,
  ];

  if (result.broadcastResponse) {
    lines.push('', '## Broadcast', '', `- response: ${JSON.stringify(result.broadcastResponse)}`);
  }

  fs.writeFileSync(summaryFile, `${lines.join('\n')}\n`);
}

async function main() {
  loadRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const options = {
    walletName: args['wallet-name'] || DEFAULTS.walletName,
    walletId: args['wallet-id'] || '',
    expectedAddress: args['expected-address'] || DEFAULTS.expectedAddress,
    walletPassword: args['wallet-password'] || process.env.DOG_MM_WALLET_PASSWORD || '',
    routerContract: args['router-contract'] || DEFAULTS.routerContract,
    poolContract: args['pool-contract'] || DEFAULTS.poolContract,
    xToken: args['x-token'] || DEFAULTS.xToken,
    yToken: args['y-token'] || DEFAULTS.yToken,
    xAmount: args['x-amount'] || DEFAULTS.xAmount,
    yAmount: args['y-amount'] || DEFAULTS.yAmount,
    activeBinOffset: args['active-bin-offset'] || DEFAULTS.activeBinOffset,
    minDlp: args['min-dlp'] || DEFAULTS.minDlp,
    maxXLiquidityFee: args['max-x-liquidity-fee'] || DEFAULTS.maxXLiquidityFee,
    maxYLiquidityFee: args['max-y-liquidity-fee'] || DEFAULTS.maxYLiquidityFee,
    expectedBinId: args['expected-bin-id'] || '',
    maxDeviation: args['max-deviation'] || DEFAULTS.maxDeviation,
    fee: args.fee || DEFAULTS.fee,
    noTolerance: Boolean(args['no-tolerance']),
    broadcast: Boolean(args.broadcast),
    jsonOnly: Boolean(args['json-only']),
    stateFile: args['state-file'] ? path.resolve(args['state-file']) : DEFAULTS.stateFile,
    summaryFile: args['summary-file'] ? path.resolve(args['summary-file']) : DEFAULTS.summaryFile,
  };

  if (!options.walletPassword) {
    throw new Error('Missing wallet password. Use --wallet-password or DOG_MM_WALLET_PASSWORD.');
  }

  const walletCatalog = loadWalletCatalog();
  const wallet = chooseWallet(
    walletCatalog,
    options.walletName,
    options.expectedAddress,
    options.walletId
  );
  const mnemonic = decryptMnemonic(wallet.id, options.walletPassword);
  const senderKey = await deriveSenderKey(mnemonic);
  const senderAddress = getAddressFromPrivateKey(senderKey, 'mainnet');

  if (senderAddress !== wallet.address) {
    throw new Error(
      `Derived sender address ${senderAddress} does not match wallet catalog address ${wallet.address}.`
    );
  }

  if (options.expectedAddress && senderAddress !== options.expectedAddress) {
    throw new Error(
      `Derived sender address ${senderAddress} does not match expected address ${options.expectedAddress}.`
    );
  }

  const poolMetadata = await getPoolForAdd(options.poolContract, senderAddress);
  const expectedBinId = options.expectedBinId || poolMetadata.activeBinId;

  const router = splitContractId(options.routerContract);
  const poolTrait = splitContractId(options.poolContract);
  const xTokenTrait = splitContractId(options.xToken);
  const yTokenTrait = splitContractId(options.yToken);

  const positions = [
    tupleCV({
      'active-bin-id-offset': intCV(BigInt(options.activeBinOffset)),
      'max-x-liquidity-fee': uintCV(BigInt(options.maxXLiquidityFee)),
      'max-y-liquidity-fee': uintCV(BigInt(options.maxYLiquidityFee)),
      'min-dlp': uintCV(BigInt(options.minDlp)),
      'x-amount': uintCV(BigInt(options.xAmount)),
      'y-amount': uintCV(BigInt(options.yAmount)),
    }),
  ];

  const toleranceCv = options.noTolerance
    ? noneCV()
    : someCV(
        tupleCV({
          'expected-bin-id': intCV(BigInt(expectedBinId)),
          'max-deviation': uintCV(BigInt(options.maxDeviation)),
        })
      );

  const transaction = await makeContractCall({
    contractAddress: router.address,
    contractName: router.name,
    functionName: 'add-relative-liquidity-same-multi',
    functionArgs: [
      listCV(positions),
      contractPrincipalCV(poolTrait.address, poolTrait.name),
      contractPrincipalCV(xTokenTrait.address, xTokenTrait.name),
      contractPrincipalCV(yTokenTrait.address, yTokenTrait.name),
      toleranceCv,
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
    wallet: {
      id: wallet.id,
      name: wallet.name,
      address: wallet.address,
      btcAddress: wallet.btcAddress,
      taprootAddress: wallet.taprootAddress,
    },
    routerContract: options.routerContract,
    poolContract: options.poolContract,
    xToken: options.xToken,
    yToken: options.yToken,
    poolMetadata: {
      signedActiveBinId: poolMetadata.activeBinId,
      binStep: poolMetadata.binStep,
      coreAddress: poolMetadata.coreAddress,
    },
    position: {
      activeBinOffset: options.activeBinOffset,
      expectedBinId: String(expectedBinId),
      maxDeviation: options.noTolerance ? '' : options.maxDeviation,
      minDlp: options.minDlp,
      maxXLiquidityFee: options.maxXLiquidityFee,
      maxYLiquidityFee: options.maxYLiquidityFee,
      xAmount: options.xAmount,
      yAmount: options.yAmount,
      fee: options.fee,
    },
    transaction: {
      nonce: transaction.auth.spendingCondition.nonce.toString(),
      fee: transaction.auth.spendingCondition.fee.toString(),
      txid: transaction.txid(),
      hex: transactionToHex(transaction),
    },
  };

  if (options.broadcast) {
    result.broadcastResponse = await broadcastTransaction({
      transaction,
      network: 'mainnet',
    });
  }

  writeOutputs(result, options.stateFile, options.summaryFile);

  if (options.jsonOnly) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log(`DOG MM Bitflow LP add executor: ${options.broadcast ? 'broadcast' : 'dry-run'} complete`);
  console.log(`sender_address: ${senderAddress}`);
  console.log(`signed_active_bin_id: ${poolMetadata.activeBinId}`);
  console.log(`txid: ${result.transaction.txid}`);
  console.log(`nonce: ${result.transaction.nonce}`);
  console.log(`fee: ${result.transaction.fee}`);
  console.log(`state_file: ${options.stateFile}`);
  console.log(`summary_file: ${options.summaryFile}`);
  if (result.broadcastResponse) {
    console.log(`broadcast_response: ${JSON.stringify(result.broadcastResponse)}`);
  }
}

main().catch(error => {
  console.error(`DOG MM Bitflow LP add executor failed: ${error.message}`);
  process.exit(1);
});
