#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { loadRuntimeEnv } = require('./runtime-env.cjs');
const { generateWallet } = require('@stacks/wallet-sdk');
const {
  broadcastTransaction,
  contractPrincipalCV,
  falseCV,
  getAddressFromPrivateKey,
  listCV,
  makeContractCall,
  Pc,
  PostConditionMode,
  transactionToHex,
  trueCV,
  tupleCV,
  uintCV,
} = require('@stacks/transactions');

const DEFAULTS = {
  walletName: process.env.DOG_MM_WALLET_NAME || 'dog-mm-mainnet',
  expectedAddress: process.env.DOG_MM_EXPECTED_ADDRESS || '',
  inputToken: process.env.DOG_MM_INPUT_TOKEN || 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token',
  outputToken: process.env.DOG_MM_OUTPUT_TOKEN || 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx',
  amountIn: process.env.DOG_MM_AMOUNT_IN || '13479',
  ammStrategy: process.env.DOG_MM_AMM_STRATEGY || 'best',
  slippageTolerance: Number(process.env.DOG_MM_SLIPPAGE_TOLERANCE || 3),
  swapParametersType: process.env.DOG_MM_SWAP_PARAMETERS_TYPE || 'simple',
  inputTokenDecimals: process.env.DOG_MM_INPUT_TOKEN_DECIMALS || '',
  outputTokenDecimals: process.env.DOG_MM_OUTPUT_TOKEN_DECIMALS || '',
  inputTokenUsd: process.env.DOG_MM_INPUT_TOKEN_USD || '',
  outputTokenUsd: process.env.DOG_MM_OUTPUT_TOKEN_USD || '',
  stxUsd: process.env.DOG_MM_STX_USD || '',
  stateFile: path.resolve(__dirname, '..', '..', 'state', 'dog-mm', 'bitflow-last-swap-plan.json'),
  summaryFile: path.resolve(__dirname, '..', '..', 'state', 'dog-mm', 'bitflow-last-swap-plan.md'),
};

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    if (key === 'broadcast' || key === 'json-only') {
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

function parseOptionalNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scaleAtomicToHuman(value, decimals) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || !Number.isFinite(decimals)) return null;
  return amount / (10 ** decimals);
}

function ratioToBps(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return (value / base) * 10_000;
}

function percent(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return (value / base) * 100;
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

  if (matches.length > 1 && !walletName && !expectedAddress) {
    throw new Error(
      'Multiple wallets are available. Set --wallet-id, --wallet-name, or --expected-address (or DOG_MM_WALLET_NAME / DOG_MM_EXPECTED_ADDRESS).'
    );
  }

  return matches[0];
}

function decryptMnemonic(walletId, walletPassword) {
  const keystorePath = path.join(
    os.homedir(),
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

function parseTypedValue(value) {
  switch (value.type) {
    case 'uint':
      return uintCV(BigInt(value.value));
    case 'true':
      return trueCV();
    case 'false':
      return falseCV();
    case 'contract': {
      const contract = splitContractId(value.value);
      return contractPrincipalCV(contract.address, contract.name);
    }
    case 'tuple': {
      const parsed = {};
      for (const [key, inner] of Object.entries(value.value)) {
        parsed[key] = parseTypedValue(inner);
      }
      return tupleCV(parsed);
    }
    default:
      throw new Error(`Unsupported typed clarity value: ${value.type}`);
  }
}

function applyCondition(principal, conditionCode, amount) {
  switch (conditionCode) {
    case 'less_than_or_equal_to':
      return principal.willSendLte(amount);
    case 'less_than':
      return principal.willSendLt(amount);
    case 'greater_than_or_equal_to':
      return principal.willSendGte(amount);
    case 'greater_than':
      return principal.willSendGt(amount);
    case 'equal_to':
      return principal.willSendEq(amount);
    default:
      throw new Error(`Unsupported post condition code: ${conditionCode}`);
  }
}

function buildPostCondition(spec, senderAddress) {
  const principalAddress = spec.sender_address === 'tx-sender' ? senderAddress : spec.sender_address;
  const principal = Pc.principal(principalAddress);
  const condition = applyCondition(principal, spec.condition_code, BigInt(spec.amount));

  switch (spec.post_condition_type) {
    case 'standard_fungible':
    case 'contract_fungible':
      return condition.ft(spec.token_contract, spec.token_asset_name);
    case 'standard_stx':
    case 'contract_stx':
      return condition.ustx();
    default:
      throw new Error(`Unsupported post condition type: ${spec.post_condition_type}`);
  }
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function buildFeeDiagnostics(transaction, selectedRoute, swapResponse) {
  const txHex = transactionToHex(transaction);
  const txBytes = Buffer.byteLength(txHex, 'hex');
  const feeMicroStx = Number(transaction.auth.spendingCondition.fee.toString());
  const feeStx = feeMicroStx / 1_000_000;
  const feePerByte = txBytes > 0 ? feeMicroStx / txBytes : 0;

  return {
    txBytes,
    txHexLength: txHex.length,
    feeMicroStx,
    feeStx,
    feePerByte,
    routeHops: selectedRoute.total_hops,
    routePathLength: Array.isArray(selectedRoute.route_path) ? selectedRoute.route_path.length : 0,
    executionPathLength: Array.isArray(selectedRoute.execution_path) ? selectedRoute.execution_path.length : 0,
    postConditionCount: Array.isArray(swapResponse.post_conditions) ? swapResponse.post_conditions.length : 0,
    typedParameterCount: Array.isArray(swapResponse.swap_parameters_typed)
      ? swapResponse.swap_parameters_typed.length
      : 0,
  };
}

function buildProfitDiagnostics(options, selectedRoute, feeDiagnostics) {
  const inputTokenDecimals = parseOptionalNumber(options.inputTokenDecimals, selectedRoute.input_token_decimals);
  const outputTokenDecimals = parseOptionalNumber(options.outputTokenDecimals, selectedRoute.output_token_decimals);
  const inputTokenUsd = parseOptionalNumber(options.inputTokenUsd);
  const outputTokenUsd = parseOptionalNumber(options.outputTokenUsd);
  const stxUsd = parseOptionalNumber(options.stxUsd);

  const inputAmountHuman = scaleAtomicToHuman(options.amountIn, inputTokenDecimals);
  const expectedOutputHuman = scaleAtomicToHuman(selectedRoute.amount_out, outputTokenDecimals);
  const minOutputHuman = scaleAtomicToHuman(selectedRoute.min_amount_out, outputTokenDecimals);
  const networkFeeMicroStx = feeDiagnostics.feeMicroStx;
  const networkFeeStx = feeDiagnostics.feeStx;
  const networkFeeUsd = Number.isFinite(stxUsd) ? networkFeeStx * stxUsd : null;

  const missingFields = [];
  if (!Number.isFinite(inputTokenDecimals)) missingFields.push('inputTokenDecimals');
  if (!Number.isFinite(outputTokenDecimals)) missingFields.push('outputTokenDecimals');
  if (!Number.isFinite(inputTokenUsd)) missingFields.push('inputTokenUsd');
  if (!Number.isFinite(outputTokenUsd)) missingFields.push('outputTokenUsd');
  if (!Number.isFinite(stxUsd)) missingFields.push('stxUsd');

  const inputUsd =
    Number.isFinite(inputAmountHuman) && Number.isFinite(inputTokenUsd)
      ? inputAmountHuman * inputTokenUsd
      : null;
  const expectedOutputUsd =
    Number.isFinite(expectedOutputHuman) && Number.isFinite(outputTokenUsd)
      ? expectedOutputHuman * outputTokenUsd
      : null;
  const minOutputUsd =
    Number.isFinite(minOutputHuman) && Number.isFinite(outputTokenUsd)
      ? minOutputHuman * outputTokenUsd
      : null;

  const grossProfitUsd =
    Number.isFinite(expectedOutputUsd) && Number.isFinite(inputUsd)
      ? expectedOutputUsd - inputUsd
      : null;
  const worstCaseProfitUsd =
    Number.isFinite(minOutputUsd) && Number.isFinite(inputUsd)
      ? minOutputUsd - inputUsd
      : null;
  const netProfitUsd =
    Number.isFinite(grossProfitUsd) && Number.isFinite(networkFeeUsd)
      ? grossProfitUsd - networkFeeUsd
      : null;
  const worstCaseNetProfitUsd =
    Number.isFinite(worstCaseProfitUsd) && Number.isFinite(networkFeeUsd)
      ? worstCaseProfitUsd - networkFeeUsd
      : null;

  const netProfitBps = ratioToBps(netProfitUsd, inputUsd);
  const worstCaseNetProfitBps = ratioToBps(worstCaseNetProfitUsd, inputUsd);
  const feeAsPercentOfInput = percent(networkFeeUsd, inputUsd);
  const feeAsPercentOfExpectedOutput = percent(networkFeeUsd, expectedOutputUsd);
  const feeAsPercentOfGrossProfit =
    Number.isFinite(networkFeeUsd) && Number.isFinite(grossProfitUsd) && grossProfitUsd !== 0
      ? (networkFeeUsd / Math.abs(grossProfitUsd)) * 100
      : null;

  return {
    complete: missingFields.length === 0,
    missingFields,
    inputTokenDecimals,
    outputTokenDecimals,
    inputTokenUsd,
    outputTokenUsd,
    stxUsd,
    inputAmountHuman,
    expectedOutputHuman,
    minOutputHuman,
    inputUsd,
    expectedOutputUsd,
    minOutputUsd,
    networkFeeMicroStx,
    networkFeeStx,
    networkFeeUsd,
    grossProfitUsd,
    worstCaseProfitUsd,
    netProfitUsd,
    worstCaseNetProfitUsd,
    netProfitBps,
    worstCaseNetProfitBps,
    feeAsPercentOfInput,
    feeAsPercentOfExpectedOutput,
    feeAsPercentOfGrossProfit,
  };
}

function writeOutputs(result, stateFile, summaryFile) {
  ensureDirectory(stateFile);
  ensureDirectory(summaryFile);
  fs.writeFileSync(stateFile, JSON.stringify(result, null, 2));

  const lines = [
    '# DOG MM Bitflow Swap Plan',
    '',
    `- generated_at_utc: ${result.generatedAtUtc}`,
    `- mode: ${result.broadcast ? 'broadcast' : 'dry_run'}`,
    `- wallet_name: ${result.wallet.name}`,
    `- wallet_id: ${result.wallet.id}`,
    `- sender_address: ${result.wallet.address}`,
    `- input_token: ${result.inputToken}`,
    `- output_token: ${result.outputToken}`,
    `- amount_in: ${result.amountIn}`,
    `- amm_strategy: ${result.ammStrategy}`,
    `- slippage_tolerance: ${result.slippageTolerance}`,
    `- quote_amount_out: ${result.quote.amountOut}`,
    `- quote_min_amount_out: ${result.quote.minAmountOut}`,
    `- route_hops: ${result.quote.totalHops}`,
    `- swap_contract: ${result.swap.contract}`,
    `- swap_function: ${result.swap.functionName}`,
    `- nonce: ${result.transaction.nonce}`,
    `- fee: ${result.transaction.fee}`,
    `- txid: ${result.transaction.txid}`,
    '',
    '## Fee Diagnostics',
    '',
    `- tx_bytes: ${result.feeDiagnostics.txBytes}`,
    `- fee_stx: ${result.feeDiagnostics.feeStx}`,
    `- fee_per_byte: ${result.feeDiagnostics.feePerByte}`,
    `- post_condition_count: ${result.feeDiagnostics.postConditionCount}`,
    `- typed_parameter_count: ${result.feeDiagnostics.typedParameterCount}`,
    `- execution_path_length: ${result.feeDiagnostics.executionPathLength}`,
    '',
    '## Profit Diagnostics',
    '',
    `- complete: ${result.profitDiagnostics.complete}`,
    `- missing_fields: ${result.profitDiagnostics.missingFields.join(', ') || 'none'}`,
    `- input_token_decimals: ${result.profitDiagnostics.inputTokenDecimals ?? 'n/a'}`,
    `- output_token_decimals: ${result.profitDiagnostics.outputTokenDecimals ?? 'n/a'}`,
    `- input_token_usd: ${result.profitDiagnostics.inputTokenUsd ?? 'n/a'}`,
    `- output_token_usd: ${result.profitDiagnostics.outputTokenUsd ?? 'n/a'}`,
    `- stx_usd: ${result.profitDiagnostics.stxUsd ?? 'n/a'}`,
    `- input_amount_human: ${result.profitDiagnostics.inputAmountHuman ?? 'n/a'}`,
    `- expected_output_human: ${result.profitDiagnostics.expectedOutputHuman ?? 'n/a'}`,
    `- min_output_human: ${result.profitDiagnostics.minOutputHuman ?? 'n/a'}`,
    `- input_usd: ${result.profitDiagnostics.inputUsd ?? 'n/a'}`,
    `- expected_output_usd: ${result.profitDiagnostics.expectedOutputUsd ?? 'n/a'}`,
    `- min_output_usd: ${result.profitDiagnostics.minOutputUsd ?? 'n/a'}`,
    `- network_fee_usd: ${result.profitDiagnostics.networkFeeUsd ?? 'n/a'}`,
    `- gross_profit_usd: ${result.profitDiagnostics.grossProfitUsd ?? 'n/a'}`,
    `- worst_case_profit_usd: ${result.profitDiagnostics.worstCaseProfitUsd ?? 'n/a'}`,
    `- net_profit_usd: ${result.profitDiagnostics.netProfitUsd ?? 'n/a'}`,
    `- worst_case_net_profit_usd: ${result.profitDiagnostics.worstCaseNetProfitUsd ?? 'n/a'}`,
    `- net_profit_bps: ${result.profitDiagnostics.netProfitBps ?? 'n/a'}`,
    `- worst_case_net_profit_bps: ${result.profitDiagnostics.worstCaseNetProfitBps ?? 'n/a'}`,
    `- fee_as_percent_of_input: ${result.profitDiagnostics.feeAsPercentOfInput ?? 'n/a'}`,
    `- fee_as_percent_of_expected_output: ${result.profitDiagnostics.feeAsPercentOfExpectedOutput ?? 'n/a'}`,
    `- fee_as_percent_of_gross_profit: ${result.profitDiagnostics.feeAsPercentOfGrossProfit ?? 'n/a'}`,
    '',
    '## Execution Path',
    '',
  ];

  result.quote.executionPath.forEach((step, index) => {
    lines.push(
      `${index + 1}. ${step.pool_trait} | ${step.function_name} | expected_bin_id=${step.expected_bin_id}`
    );
  });

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
    inputToken: args['input-token'] || DEFAULTS.inputToken,
    outputToken: args['output-token'] || DEFAULTS.outputToken,
    amountIn: args['amount-in'] || DEFAULTS.amountIn,
    ammStrategy: args['amm-strategy'] || DEFAULTS.ammStrategy,
    preferredAmm: args['preferred-amm'] || '',
    slippageTolerance: Number(args['slippage-tolerance'] || DEFAULTS.slippageTolerance),
    swapParametersType: args['swap-parameters-type'] || DEFAULTS.swapParametersType,
    inputTokenDecimals: args['input-token-decimals'] || DEFAULTS.inputTokenDecimals,
    outputTokenDecimals: args['output-token-decimals'] || DEFAULTS.outputTokenDecimals,
    inputTokenUsd: args['input-token-usd'] || DEFAULTS.inputTokenUsd,
    outputTokenUsd: args['output-token-usd'] || DEFAULTS.outputTokenUsd,
    stxUsd: args['stx-usd'] || DEFAULTS.stxUsd,
    provider: args.provider || '',
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

  const quoteRequest = {
    input_token: options.inputToken,
    output_token: options.outputToken,
    amount_in: options.amountIn,
    amm_strategy: options.ammStrategy,
    slippage_tolerance: options.slippageTolerance,
  };

  if (options.preferredAmm) {
    quoteRequest.preferred_amm = options.preferredAmm;
  }

  const quoteResponse = await postJson(
    'https://bff.bitflowapis.finance/api/quotes/v1/quote/multi',
    quoteRequest
  );

  if (!quoteResponse.success || !Array.isArray(quoteResponse.routes) || quoteResponse.routes.length === 0) {
    throw new Error(`Bitflow quote returned no routes: ${JSON.stringify(quoteResponse)}`);
  }

  const selectedRoute = quoteResponse.routes[0];
  const swapRequest = {
    execution_path: selectedRoute.execution_path,
    amount_in: options.amountIn,
    amount_out: selectedRoute.amount_out,
    input_token: options.inputToken,
    output_token: options.outputToken,
    input_token_decimals: selectedRoute.input_token_decimals,
    output_token_decimals: selectedRoute.output_token_decimals,
    slippage_tolerance: selectedRoute.slippage_tolerance,
    swap_parameters_type: options.swapParametersType,
  };

  if (options.provider) {
    swapRequest.provider = options.provider;
  }

  const swapResponse = await postJson('https://bff.bitflowapis.finance/api/quotes/v1/swap', swapRequest);

  if (!swapResponse.success) {
    throw new Error(`Bitflow swap planner failed: ${JSON.stringify(swapResponse)}`);
  }

  const router = splitContractId(swapResponse.swap_contract);
  const functionArgs = [listCV(swapResponse.swap_parameters_typed.map(parseTypedValue))];
  const postConditions = swapResponse.post_conditions.map(spec => buildPostCondition(spec, senderAddress));

  const transaction = await makeContractCall({
    contractAddress: router.address,
    contractName: router.name,
    functionName: swapResponse.function_name,
    functionArgs,
    senderKey,
    network: 'mainnet',
    postConditionMode: PostConditionMode.Deny,
    postConditions,
    validateWithAbi: true,
  });

  const feeDiagnostics = buildFeeDiagnostics(transaction, selectedRoute, swapResponse);
  const profitDiagnostics = buildProfitDiagnostics(options, selectedRoute, feeDiagnostics);
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
    inputToken: options.inputToken,
    outputToken: options.outputToken,
    amountIn: options.amountIn,
    ammStrategy: options.ammStrategy,
    slippageTolerance: options.slippageTolerance,
    quote: {
      amountOut: selectedRoute.amount_out,
      minAmountOut: selectedRoute.min_amount_out,
      totalHops: selectedRoute.total_hops,
      routePath: selectedRoute.route_path,
      executionPath: selectedRoute.execution_path,
      executionDetails: selectedRoute.execution_details,
    },
    swap: {
      contract: swapResponse.swap_contract,
      functionName: swapResponse.function_name,
      typedParameters: swapResponse.swap_parameters_typed,
      postConditions: swapResponse.post_conditions,
    },
    transaction: {
      nonce: transaction.auth.spendingCondition.nonce.toString(),
      fee: transaction.auth.spendingCondition.fee.toString(),
      txid: transaction.txid(),
      hex: transactionToHex(transaction),
    },
    feeDiagnostics,
    profitDiagnostics,
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

  console.log(`DOG MM Bitflow swap executor: ${options.broadcast ? 'broadcast' : 'dry-run'} complete`);
  console.log(`sender_address: ${senderAddress}`);
  console.log(`quote_amount_out: ${result.quote.amountOut}`);
  console.log(`quote_min_amount_out: ${result.quote.minAmountOut}`);
  console.log(`txid: ${result.transaction.txid}`);
  console.log(`nonce: ${result.transaction.nonce}`);
  console.log(`fee: ${result.transaction.fee}`);
  console.log(`tx_bytes: ${result.feeDiagnostics.txBytes}`);
  console.log(`fee_stx: ${result.feeDiagnostics.feeStx}`);
  console.log(`fee_per_byte: ${result.feeDiagnostics.feePerByte.toFixed(2)}`);
  console.log(`post_condition_count: ${result.feeDiagnostics.postConditionCount}`);
  console.log(`typed_parameter_count: ${result.feeDiagnostics.typedParameterCount}`);
  console.log(`execution_path_length: ${result.feeDiagnostics.executionPathLength}`);
  console.log(`profit_complete: ${result.profitDiagnostics.complete ? 'yes' : 'no'}`);
  console.log(`input_usd: ${result.profitDiagnostics.inputUsd ?? 'n/a'}`);
  console.log(`expected_output_usd: ${result.profitDiagnostics.expectedOutputUsd ?? 'n/a'}`);
  console.log(`min_output_usd: ${result.profitDiagnostics.minOutputUsd ?? 'n/a'}`);
  console.log(`network_fee_usd: ${result.profitDiagnostics.networkFeeUsd ?? 'n/a'}`);
  console.log(`net_profit_usd: ${result.profitDiagnostics.netProfitUsd ?? 'n/a'}`);
  console.log(`worst_case_net_profit_usd: ${result.profitDiagnostics.worstCaseNetProfitUsd ?? 'n/a'}`);
  console.log(`net_profit_bps: ${result.profitDiagnostics.netProfitBps ?? 'n/a'}`);
  if (!result.profitDiagnostics.complete) {
    console.log(`profit_missing_fields: ${result.profitDiagnostics.missingFields.join(', ')}`);
  }
  console.log(`state_file: ${options.stateFile}`);
  console.log(`summary_file: ${options.summaryFile}`);
  if (result.broadcastResponse) {
    console.log(`broadcast_response: ${JSON.stringify(result.broadcastResponse)}`);
  }
}

main().catch(error => {
  console.error(`DOG MM Bitflow swap executor failed: ${error.message}`);
  process.exit(1);
});
