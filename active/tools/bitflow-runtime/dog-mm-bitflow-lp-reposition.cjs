#!/usr/bin/env node
'use strict';

/**
 * dog-mm-bitflow-lp-reposition.cjs
 *
 * Verifica se a posição LP sBTC/USDCx na pool DLMM está out-of-range.
 * Se estiver:
 *   1. Remove toda a liquidez (remove-liquidity)
 *   2. Aguarda confirmação da tx via Hiro API
 *   3. Recoloca a liquidez no active bin atual (active-bin-offset 0)
 *
 * Usage:
 *   node dog-mm-bitflow-lp-reposition.cjs [--dry-run] [--broadcast] \
 *     [--wallet-password SENHA] [--out-of-range-tolerance 5]
 *
 * Flags:
 *   --broadcast               Envia txs na chain (default: dry-run)
 *   --out-of-range-tolerance  Bins de tolerância antes de considerar out-of-range (default: 5)
 *   --min-dlp                 DLP mínimo para aceitar no re-add (default: 1)
 *   --fee                     Fee STX em uSTX (default: 50000)
 *   --json-only               Output só JSON no stdout
 *
 * NOTA: ABI de withdraw-liquidity-same-multi verificado via Hiro API (2026-04-13).
 */

const fs   = require('fs');
const path = require('path');
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
  tupleCV,
  uintCV,
} = require('@stacks/transactions');

// ── Constantes ─────────────────────────────────────────────────────────────────

const HIRO_API      = 'https://api.hiro.so';
const BITFLOW_BFF_API = 'https://bff.bitflowapis.finance/api/app/v1';
const POOL_CONTRACT = 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-1';
const ROUTER_CONTRACT = 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-liquidity-router-v-1-1';
const X_TOKEN       = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token';
const Y_TOKEN       = 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx';
const POOL_TOKEN_KEY = `${POOL_CONTRACT}::pool-token`;
const BITFLOW_POOL_ID = 'dlmm_2';

const STATE_DIR  = path.resolve(__dirname, '..', '..', 'state', 'dog-mm');
const LP_PLAN    = path.resolve(STATE_DIR, 'bitflow-last-lp-add-plan.json');
const STATE_FILE = path.resolve(STATE_DIR, 'bitflow-last-lp-reposition.json');

const TX_POLL_INTERVAL_MS = 8000;
const TX_POLL_TIMEOUT_MS  = 300000; // 5 min
const WITHDRAW_SLIPPAGE_PERCENT = 1;

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(...args) {
  process.stderr.write(args.join(' ') + '\n');
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function splitContract(contractId) {
  const idx = contractId.indexOf('.');
  if (idx < 0) throw new Error(`Invalid contract id: ${contractId}`);
  return { address: contractId.slice(0, idx), name: contractId.slice(idx + 1) };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(json)}`);
  return json;
}

async function getJson(url) {
  const response = await fetch(url);
  const json = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(json)}`);
  return json;
}

// ── CLI args ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (!cur.startsWith('--')) continue;
    const key = cur.slice(2);
    if (key === 'broadcast' || key === 'json-only') {
      parsed[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}`);
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

// ── Wallet ─────────────────────────────────────────────────────────────────────

async function deriveSenderKey(mnemonic, accountIndex = 0) {
  const wallet = await generateWallet({ secretKey: mnemonic, password: 'bitflow-runtime' });
  const account = wallet.accounts[accountIndex];
  if (!account) throw new Error(`Account index ${accountIndex} not found in derived wallet`);
  return account.stxPrivateKey;
}

// ── On-chain reads ─────────────────────────────────────────────────────────────

async function getPoolState(senderAddress) {
  const pool = splitContract(POOL_CONTRACT);
  const response = await postJson(
    `${HIRO_API}/v2/contracts/call-read/${pool.address}/${pool.name}/get-pool-for-add`,
    { sender: senderAddress, arguments: [] }
  );
  if (!response.okay || !response.result) {
    throw new Error(`get-pool-for-add failed: ${JSON.stringify(response)}`);
  }
  const decoded = cvToValue(deserializeCV(response.result));
  const v = decoded.value;
  return {
    activeBinId: Number(v['active-bin-id'].value),
    binStep:     Number(v['bin-step'].value),
    coreAddress: v['core-address'].value,
    poolName:    v['pool-name'].value,
  };
}

async function getUserDlpBalance(address) {
  const balances = await getJson(`${HIRO_API}/extended/v1/address/${address}/balances`);
  const ft = balances.fungible_tokens || {};
  const entry = ft[POOL_TOKEN_KEY];
  return entry ? BigInt(entry.balance) : 0n;
}

async function getUserOccupiedBins(address) {
  const response = await getJson(`${BITFLOW_BFF_API}/users/${address}/positions/${BITFLOW_POOL_ID}/bins?fresh=true`);
  const bins = Array.isArray(response?.bins) ? response.bins : [];
  return bins
    .map((bin) => ({
      binId: Number(bin.bin_id),
      signedBinId: Number(bin.bin_id) >= 500 ? Number(bin.bin_id) - 500 : Number(bin.bin_id),
      amount: BigInt(bin.userLiquidity),
    }))
    .filter((bin) => Number.isFinite(bin.binId) && bin.amount > 0n);
}

async function getPoolBinsMap() {
  const response = await getJson(`${BITFLOW_BFF_API.replace('/app/v1', '/quotes/v1')}/bins/${BITFLOW_POOL_ID}`);
  const bins = Array.isArray(response?.bins) ? response.bins : [];
  return new Map(
    bins.map((bin) => [
      Number(bin.bin_id),
      {
        reserveX: BigInt(bin.reserve_x || '0'),
        reserveY: BigInt(bin.reserve_y || '0'),
        liquidity: BigInt(bin.liquidity || '0'),
      },
    ])
  );
}

function withWithdrawalMinimums(occupiedBins, poolBinsMap, slippagePercent = WITHDRAW_SLIPPAGE_PERCENT) {
  const slippageNumerator = BigInt(Math.max(0, 100 - slippagePercent));
  const slippageDenominator = 100n;

  return occupiedBins.map((bin) => {
    const poolBin = poolBinsMap.get(bin.binId);
    if (!poolBin || poolBin.liquidity <= 0n) {
      return {
        ...bin,
        minXAmount: 0n,
        minYAmount: 0n,
      };
    }

    const liquidityToRemove = bin.amount;
    const minXAmount = (poolBin.reserveX * liquidityToRemove * slippageNumerator) / (poolBin.liquidity * slippageDenominator);
    const minYAmount = (poolBin.reserveY * liquidityToRemove * slippageNumerator) / (poolBin.liquidity * slippageDenominator);

    return {
      ...bin,
      minXAmount,
      minYAmount,
    };
  });
}

async function pollTxConfirmation(txid, timeoutMs = TX_POLL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  log(`  polling tx ${txid}...`);
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, TX_POLL_INTERVAL_MS));
    try {
      const tx = await getJson(`${HIRO_API}/extended/v1/tx/${txid}`);
      const status = tx.tx_status;
      log(`  tx status: ${status}`);
      if (status === 'success') return { ok: true, status };
      if (status === 'abort_by_response' || status === 'abort_by_post_condition') {
        return { ok: false, status, error: tx.tx_result?.repr || 'aborted' };
      }
    } catch (e) {
      log(`  poll error (retrying): ${e.message}`);
    }
  }
  return { ok: false, status: 'timeout', error: `tx not confirmed within ${timeoutMs}ms` };
}

// ── Range check ────────────────────────────────────────────────────────────────

function checkInRange(currentActiveBin, entryBin, tolerance) {
  if (entryBin === null) {
    log('  entry bin unknown (no state file) — assuming out-of-range for safety');
    return false;
  }
  const delta = Math.abs(currentActiveBin - entryBin);
  return delta <= tolerance;
}

// ── Transactions ───────────────────────────────────────────────────────────────

async function buildRemoveLiquidityTx(options) {
  // ABI verificado via Hiro:
  // GET /v2/contracts/interface/SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD/dlmm-liquidity-router-v-1-1
  //
  // withdraw-liquidity-same-multi(
  //   positions: list(326) of { amount: uint, bin-id: int, min-x-amount: uint,
  //                             min-y-amount: uint, pool-trait: trait },
  //   x-token-trait: trait,
  //   y-token-trait: trait,
  //   min-x-amount-total: uint,
  //   min-y-amount-total: uint
  // )
  const { senderKey, dlpAmount, entryBinId, fee } = options;

  if (entryBinId === null || entryBinId === undefined) {
    throw new Error(
      'entryBinId é obrigatório para withdraw-liquidity-same-multi. ' +
      'Certifique-se de que bitflow-last-lp-add-plan.json existe com position.expectedBinId.'
    );
  }

  const router = splitContract(ROUTER_CONTRACT);
  const pool   = splitContract(POOL_CONTRACT);
  const xTok   = splitContract(X_TOKEN);
  const yTok   = splitContract(Y_TOKEN);

  // positions: lista com uma entrada por bin ocupado.
  // Para posição single-bin (active-bin-offset 0), é um único tuple.
  const positions = [
    tupleCV({
      'amount':       uintCV(dlpAmount),
      'bin-id':       intCV(BigInt(entryBinId)),   // bin absoluto do depósito
      'min-x-amount': uintCV(0n),                  // 0 = aceita qualquer (reposicionamento)
      'min-y-amount': uintCV(0n),
      'pool-trait':   contractPrincipalCV(pool.address, pool.name),
    }),
  ];

  return makeContractCall({
    contractAddress: router.address,
    contractName:    router.name,
    functionName:    'withdraw-liquidity-same-multi',
    functionArgs: [
      listCV(positions),
      contractPrincipalCV(xTok.address, xTok.name),  // x-token-trait
      contractPrincipalCV(yTok.address, yTok.name),  // y-token-trait
      uintCV(0n),                                    // min-x-amount-total
      uintCV(0n),                                    // min-y-amount-total
    ],
    senderKey,
    network:           'mainnet',
    fee:               BigInt(fee),
    postConditionMode: PostConditionMode.Allow,
    postConditions:    [],
    validateWithAbi:   true,
  });
}

async function buildAddLiquidityTx(options) {
  const { senderKey, xAmount, yAmount, minDlp, maxDeviation, fee, expectedBinId } = options;
  const router = splitContract(ROUTER_CONTRACT);
  const pool   = splitContract(POOL_CONTRACT);
  const xTok   = splitContract(X_TOKEN);
  const yTok   = splitContract(Y_TOKEN);

  const positions = [
    tupleCV({
      'active-bin-id-offset': intCV(0n),              // bin atual
      'max-x-liquidity-fee':  uintCV(1000n),
      'max-y-liquidity-fee':  uintCV(100000n),
      'min-dlp':              uintCV(BigInt(minDlp)),
      'x-amount':             uintCV(BigInt(xAmount)),
      'y-amount':             uintCV(BigInt(yAmount)),
    }),
  ];

  const toleranceCv = someCV(
    tupleCV({
      'expected-bin-id': intCV(BigInt(expectedBinId)),
      'max-deviation':   uintCV(BigInt(maxDeviation)),
    })
  );

  return makeContractCall({
    contractAddress: router.address,
    contractName:    router.name,
    functionName:    'add-relative-liquidity-same-multi',
    functionArgs: [
      listCV(positions),
      contractPrincipalCV(pool.address, pool.name),
      contractPrincipalCV(xTok.address, xTok.name),
      contractPrincipalCV(yTok.address, yTok.name),
      toleranceCv,
    ],
    senderKey,
    network:           'mainnet',
    fee:               BigInt(fee),
    postConditionMode: PostConditionMode.Allow,
    postConditions:    [],
    validateWithAbi:   true,
  });
}

async function buildRemoveLiquidityTxFromOccupiedBins(options) {
  const { senderKey, occupiedBins, fee, activeBinId } = options;

  if (!Array.isArray(occupiedBins) || occupiedBins.length === 0) {
    throw new Error('No occupied bins found for LP removal.');
  }

  const router = splitContract(ROUTER_CONTRACT);
  const pool   = splitContract(POOL_CONTRACT);
  const xTok   = splitContract(X_TOKEN);
  const yTok   = splitContract(Y_TOKEN);

  const positions = occupiedBins.map((bin) => tupleCV({
    'active-bin-id-offset': intCV(BigInt(bin.signedBinId - activeBinId)),
    'amount':       uintCV(bin.amount),
    'min-x-amount': uintCV(bin.minXAmount ?? 0n),
    'min-y-amount': uintCV(bin.minYAmount ?? 0n),
    'pool-trait':   contractPrincipalCV(pool.address, pool.name),
  }));

  const totalMinXAmount = occupiedBins.reduce((sum, bin) => sum + (bin.minXAmount ?? 0n), 0n);
  const totalMinYAmount = occupiedBins.reduce((sum, bin) => sum + (bin.minYAmount ?? 0n), 0n);

  return makeContractCall({
    contractAddress: router.address,
    contractName:    router.name,
    functionName:    'withdraw-relative-liquidity-same-multi',
    functionArgs: [
      listCV(positions),
      contractPrincipalCV(xTok.address, xTok.name),
      contractPrincipalCV(yTok.address, yTok.name),
      uintCV(totalMinXAmount),
      uintCV(totalMinYAmount),
    ],
    senderKey,
    network:           'mainnet',
    fee:               BigInt(fee),
    postConditionMode: PostConditionMode.Allow,
    postConditions:    [],
    validateWithAbi:   true,
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  loadRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));

  const broadcast    = Boolean(args.broadcast);
  const jsonOnly     = Boolean(args['json-only']);
  const tolerance    = Number(args['out-of-range-tolerance'] || 5);
  const minDlp       = args['min-dlp'] || '1';
  const fee          = args.fee || '50000';
  const maxDeviation = args['max-deviation'] || '5';

  if (!jsonOnly) {
    log('🔄 DOG-MM Bitflow LP Reposition');
    log(`   Modo: ${broadcast ? 'BROADCAST 🔴' : 'DRY-RUN 🔵'}`);
    log(`   Tolerância out-of-range: ±${tolerance} bins`);
  }

  // ── Wallet setup ──────────────────────────────────────────────────────────
  const seedPhrase      = process.env.DOG_MM_SEED_PHRASE || '';
  const accountIndex    = parseInt(process.env.DOG_MM_ACCOUNT_INDEX || '0', 10);
  const expectedAddress = process.env.DOG_MM_EXPECTED_ADDRESS || '';
  const walletName      = process.env.DOG_MM_WALLET_NAME || 'dog-mm-mainnet';

  if (!seedPhrase) {
    throw new Error('Missing seed phrase. Set DOG_MM_SEED_PHRASE.');
  }

  const senderKey     = await deriveSenderKey(seedPhrase, accountIndex);
  const senderAddress = getAddressFromPrivateKey(senderKey, 'mainnet');

  if (expectedAddress && senderAddress !== expectedAddress) {
    throw new Error(
      `Derived address ${senderAddress} does not match DOG_MM_EXPECTED_ADDRESS ${expectedAddress}.`
    );
  }

  if (!jsonOnly) log(`   Wallet: ${senderAddress}`);

  // ── Lê estado da pool e saldo ─────────────────────────────────────────────
  const [poolState, dlpBalance] = await Promise.all([
    getPoolState(senderAddress),
    getUserDlpBalance(senderAddress),
  ]);

  if (!jsonOnly) {
    log(`   Active bin: ${poolState.activeBinId}`);
    log(`   DLP balance: ${dlpBalance.toString()}`);
  }

  if (dlpBalance === 0n) {
    const result = {
      generatedAtUtc: new Date().toISOString(),
      status: 'no_position',
      message: 'Nenhum DLP encontrado na carteira — sem posição ativa.',
      activeBinId: poolState.activeBinId,
      dlpBalance: '0',
    };
    if (jsonOnly) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else log('   ℹ️  Sem posição LP ativa. Nada a fazer.');
    writeJson(STATE_FILE, result);
    return;
  }

  // ── Lê bin de entrada do state file (se disponível) ───────────────────────
  const lpPlan = readJson(LP_PLAN);
  const entryBin = lpPlan?.position?.expectedBinId != null
    ? Number(lpPlan.position.expectedBinId)
    : null;

  if (!jsonOnly) log(`   Entry bin: ${entryBin !== null ? entryBin : 'desconhecido (sem state file)'}`);

  // ── Verifica se está in-range ─────────────────────────────────────────────
  const inRange = checkInRange(poolState.activeBinId, entryBin, tolerance);

  if (!jsonOnly) {
    log(`   Range status: ${inRange ? '✅ IN-RANGE' : '⚠️  OUT-OF-RANGE'}`);
  }

  if (inRange) {
    const result = {
      generatedAtUtc: new Date().toISOString(),
      status: 'in_range',
      activeBinId: poolState.activeBinId,
      entryBin,
      dlpBalance: dlpBalance.toString(),
      message: `Posição in-range (delta ≤ ${tolerance} bins). Nenhuma ação necessária.`,
    };
    if (jsonOnly) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else log('   ✅ Posição in-range. Nenhuma ação necessária.');
    writeJson(STATE_FILE, result);
    return;
  }

  // ── OUT-OF-RANGE: remove + re-add ─────────────────────────────────────────
  if (!jsonOnly) log('\n📤 Removendo liquidez...');

  const occupiedBinsRaw = await getUserOccupiedBins(senderAddress);
  const poolBinsMap = await getPoolBinsMap();
  const occupiedBins = withWithdrawalMinimums(occupiedBinsRaw, poolBinsMap);
  if (!jsonOnly) {
    log(`   Occupied bins: ${occupiedBins.map((bin) => `${bin.binId}:${bin.amount.toString()}`).join(', ') || 'none'}`);
  }

  const removeTx = await buildRemoveLiquidityTxFromOccupiedBins({
    senderKey,
    occupiedBins,
    fee,
    activeBinId: poolState.activeBinId,
  });
  const removeTxid = removeTx.txid();

  if (!jsonOnly) log(`   txid (remove): ${removeTxid}`);

  let removeBroadcastResponse = null;
  let removeConfirmation = null;

  if (broadcast) {
    removeBroadcastResponse = await broadcastTransaction({ transaction: removeTx, network: 'mainnet' });
    if (removeBroadcastResponse.error) {
      throw new Error(`Remove broadcast failed: ${removeBroadcastResponse.error} — ${removeBroadcastResponse.reason || ''}`);
    }
    if (!jsonOnly) log(`   Broadcast OK. Aguardando confirmação...`);
    removeConfirmation = await pollTxConfirmation(removeTxid);
    if (!removeConfirmation.ok) {
      throw new Error(`Remove tx falhou: ${removeConfirmation.error}`);
    }
    if (!jsonOnly) log(`   ✅ Remove confirmado.`);
  } else {
    if (!jsonOnly) log(`   [DRY-RUN] Remove simulado.`);
  }

  // ── Re-lê saldo após remoção para usar os valores reais ───────────────────
  // Em dry-run usamos os valores do plan ou estimativas conservadoras
  let xAmount, yAmount;
  if (broadcast && removeConfirmation?.ok) {
    const newBalances = await getJson(`${HIRO_API}/extended/v1/address/${senderAddress}/balances`);
    const ft = newBalances.fungible_tokens || {};
    xAmount = ft['SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token']?.balance || '0';
    yAmount = ft['SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx::usdcx-token']?.balance || '0';
    if (!jsonOnly) log(`   Saldo pós-remove: sBTC=${xAmount} sats, USDCx=${yAmount} raw`);
  } else {
    // Dry-run: usa valores do plan anterior ou defaults
    xAmount = lpPlan?.position?.xAmount || '19021';
    yAmount = lpPlan?.position?.yAmount || '9890354';
    if (!jsonOnly) log(`   [DRY-RUN] Usando x=${xAmount}, y=${yAmount} (do plan anterior)`);
  }

  // ── Re-add no bin atual ───────────────────────────────────────────────────
  if (!jsonOnly) log('\n📥 Re-adicionando liquidez no bin atual...');

  // Lê o bin atual novamente para garantir que usamos o mais recente
  const freshPoolState = await getPoolState(senderAddress);
  if (!jsonOnly) log(`   Active bin (fresh): ${freshPoolState.activeBinId}`);

  const addTx = await buildAddLiquidityTx({
    senderKey,
    xAmount,
    yAmount,
    minDlp,
    maxDeviation,
    fee,
    expectedBinId: freshPoolState.activeBinId,
  });
  const addTxid = addTx.txid();

  if (!jsonOnly) log(`   txid (add): ${addTxid}`);

  let addBroadcastResponse = null;
  let addConfirmation = null;

  if (broadcast) {
    addBroadcastResponse = await broadcastTransaction({ transaction: addTx, network: 'mainnet' });
    if (addBroadcastResponse.error) {
      throw new Error(`Add broadcast failed: ${addBroadcastResponse.error} — ${addBroadcastResponse.reason || ''}`);
    }
    if (!jsonOnly) log(`   Broadcast OK. Aguardando confirmação...`);
    addConfirmation = await pollTxConfirmation(addTxid);
    if (!addConfirmation.ok) {
      throw new Error(`Add tx falhou: ${addConfirmation.error}`);
    }
    if (!jsonOnly) log(`   ✅ Re-add confirmado.`);
  } else {
    if (!jsonOnly) log(`   [DRY-RUN] Re-add simulado.`);
  }

  // ── Salva resultado ───────────────────────────────────────────────────────
  const result = {
    generatedAtUtc:   new Date().toISOString(),
    broadcast,
    status:           broadcast ? 'repositioned' : 'dry_run',
    wallet:           { name: walletName, address: senderAddress, accountIndex },
    poolContract:     POOL_CONTRACT,
    entryBin,
    occupiedBins:     occupiedBins.map((bin) => ({
      binId: bin.binId,
      signedBinId: bin.signedBinId,
      amount: bin.amount.toString(),
      minXAmount: (bin.minXAmount ?? 0n).toString(),
      minYAmount: (bin.minYAmount ?? 0n).toString(),
    })),
    activeBinAtStart: poolState.activeBinId,
    activeBinAtReAdd: freshPoolState.activeBinId,
    dlpRemoved:       dlpBalance.toString(),
    position: { xAmount, yAmount },
    remove: {
      txid:              removeTxid,
      broadcastResponse: removeBroadcastResponse,
      confirmation:      removeConfirmation,
    },
    add: {
      txid:              addTxid,
      broadcastResponse: addBroadcastResponse,
      confirmation:      addConfirmation,
    },
  };

  writeJson(STATE_FILE, result);

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    log('\n✅ Reposicionamento concluído.');
    log(`   State salvo: ${STATE_FILE}`);
    if (broadcast) {
      log(`   Remove txid: ${removeTxid}`);
      log(`   Add txid:    ${addTxid}`);
    }
  }
}

main().catch(error => {
  process.stderr.write(`\n❌ Reposition falhou: ${error.message}\n`);
  process.exit(1);
});
