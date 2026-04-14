'use strict';
/**
 * bitflow-dca.cjs - DCA diario na Bitflow
 * Estrategia: $5 USD/dia em sBTC (DOG aguardando suporte)
 * Usa endpoint confirmado: node.bitflowapis.finance
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const {
  uintCV, noneCV, contractPrincipalCV, tupleCV, serializeCV,
  makeContractCall, broadcastTransaction, AnchorMode, PostConditionMode,
} = require('@stacks/transactions');
const { STACKS_MAINNET } = require('@stacks/network');
require('dotenv').config({ path: '.env.local' });

const CONFIG = {
  targets: [
    { tokenId: 'token-sbtc', label: 'sBTC', allocation: 1.0 },
    // { tokenId: 'token-dog', label: 'DOG', allocation: 0.5 }, // aguardar suporte Bitflow
  ],
  dailyBudgetUSD: 5.0,
  maxSlippagePct: 1.0,
  dryRun: process.argv.includes('--dry-run') || process.env.DCA_DRY_RUN === 'true',
  privateKey: process.env.STACKS_PRIVATE_KEY,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '5998650775',
  priceApi: 'https://bitflow-analytics.vercel.app/api/prices/stx',
  logPath: path.join(__dirname, 'logs', 'bitflow-dca.log'),
};

// Contratos Bitflow (confirmados ao vivo)
const BF = 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR';
const TOKEN_STX  = contractPrincipalCV(BF, 'token-stx-v-1-2');
const TOKEN_SBTC = contractPrincipalCV('SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4', 'sbtc-token');
const POOL_SBTC_STX = contractPrincipalCV(BF, 'xyk-pool-sbtc-stx-v-1-1');

const ROUTES = {
  'token-sbtc': {
    quoteFunc: 'get-quote-a',
    swapFunc: 'swap-helper-a',
    buildQuoteArgs: (n) => [
      '0x' + serializeCV(uintCV(n)),
      '0x' + serializeCV(noneCV()),
      '0x' + serializeCV(tupleCV({ a: TOKEN_STX, b: TOKEN_SBTC })),
      '0x' + serializeCV(tupleCV({ a: POOL_SBTC_STX })),
    ],
    buildSwapArgs: (n) => [
      uintCV(n), uintCV(1), noneCV(),
      tupleCV({ a: TOKEN_STX, b: TOKEN_SBTC }),
      tupleCV({ a: POOL_SBTC_STX }),
    ],
  },
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('Parse: ' + d.slice(0,100))); } });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const p = JSON.stringify(body); const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname+(u.search||''), method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('Parse: ' + d.slice(0,100))); } });
    });
    req.on('error', reject); req.write(p); req.end();
  });
}

async function sendTelegram(msg) {
  if (!CONFIG.telegramToken) { console.log('[TELEGRAM SKIP] Sem token'); return; }
  try {
    await httpPost('https://api.telegram.org/bot'+CONFIG.telegramToken+'/sendMessage', { chat_id: CONFIG.telegramChatId, text: msg, parse_mode: 'HTML' });
  } catch(e) { console.error('[TELEGRAM ERROR]', e.message); }
}

async function getStxPrice() {
  const r = await httpGet(CONFIG.priceApi);
  if (!r.data || typeof r.data !== 'number') throw new Error('Preco STX invalido: ' + JSON.stringify(r));
  return r.data;
}

async function getBestQuote(tokenId, amountStx) {
  const route = ROUTES[tokenId];
  if (!route) throw new Error('Rota nao configurada: ' + tokenId);
  const n = Math.round(amountStx * 1e6);
  const url = 'https://node.bitflowapis.finance/v2/contracts/call-read/'+BF+'/xyk-swap-helper-v-1-3/'+route.quoteFunc;
  const res = await httpPost(url, { sender: BF, arguments: route.buildQuoteArgs(n) });
  if (!res.okay) throw new Error('Quote falhou: ' + JSON.stringify(res));
  return { route, quoteResult: res, amountMicro: n };
}

async function executeSwap(tokenId, quote) {
  const { route, amountMicro } = quote;
  const tx = await makeContractCall({
    contractAddress: BF,
    contractName: 'xyk-swap-helper-v-1-3',
    functionName: route.swapFunc,
    functionArgs: route.buildSwapArgs(amountMicro),
    senderKey: CONFIG.privateKey,
    network: STACKS_MAINNET,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
    fee: 2000,
  });
  const result = await broadcastTransaction({ transaction: tx, network: STACKS_MAINNET });
  if (result.error) throw new Error('Broadcast falhou: ' + result.error + ' - ' + (result.reason||''));
  return result.txid;
}

function logResult(results) {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), results }) + '\n';
    fs.appendFileSync(CONFIG.logPath, line);
  } catch(e) { console.error('[LOG ERROR]', e.message); }
}

const STATE_PATH = path.join(__dirname, 'state', 'bitflow-dca-last-run.json');

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function checkIdempotency() {
  try {
    if (!fs.existsSync(STATE_PATH)) return;
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (state.date === todayUtc()) {
      console.log('⏭ Já executou hoje (' + state.date + ') às ' + state.executedAt + ' — abortando.');
      process.exit(0);
    }
  } catch (e) {
    console.warn('[STATE] Erro ao ler last-run, continuando:', e.message);
  }
}

function saveState(txids) {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({
      date: todayUtc(),
      executedAt: new Date().toISOString(),
      txids,
    }, null, 2));
  } catch (e) {
    console.error('[STATE] Erro ao salvar last-run:', e.message);
  }
}

async function main() {
  const start = Date.now();
  checkIdempotency();

  console.log('\n🤖 Bitflow DCA Bot — ' + new Date().toISOString());
  console.log('   Modo: ' + (CONFIG.dryRun ? 'DRY-RUN 🔵' : 'PRODUCAO 🔴'));
  console.log('   Budget: $' + CONFIG.dailyBudgetUSD + ' USD/dia');
  console.log('   Targets: ' + CONFIG.targets.map(t => t.label).join(', '));

  if (!CONFIG.dryRun && !CONFIG.privateKey) {
    console.error('❌ STACKS_PRIVATE_KEY nao configurada');
    process.exit(1);
  }

  const results = [];
  const stxPrice = await getStxPrice();
  console.log('💲 STX: $' + stxPrice.toFixed(4));

  for (const target of CONFIG.targets) {
    const amountStx = (CONFIG.dailyBudgetUSD * target.allocation) / stxPrice;
    console.log('\n─── ' + target.label + ' (' + (target.allocation*100) + '% do budget) ───');
    console.log('   Budget: $' + (CONFIG.dailyBudgetUSD * target.allocation).toFixed(2) + ' = ' + amountStx.toFixed(4) + ' STX');

    const result = { token: target.label, amountStx };
    try {
      const quote = await getBestQuote(target.tokenId, amountStx);
      console.log('   Quote: OK ✓');
      if (CONFIG.dryRun) {
        console.log('   [DRY-RUN] Swap simulado ✓');
        result.status = 'dry-run';
      } else {
        const txid = await executeSwap(target.tokenId, quote);
        console.log('   ✅ Swap enviado! txid: ' + txid);
        console.log('   🔗 https://explorer.hiro.so/txid/' + txid + '?chain=mainnet');
        result.status = 'ok';
        result.txid = txid;
      }
    } catch(e) {
      console.error('   ❌ Erro: ' + e.message);
      result.status = 'error';
      result.reason = e.message;
    }
    results.push(result);
  }

  const elapsed = ((Date.now()-start)/1000).toFixed(1);
  const ok = results.filter(r => r.status === 'ok' || r.status === 'dry-run').length;
  console.log('\n✅ Concluido: ' + ok + '/' + results.length + ' swaps em ' + elapsed + 's');

  logResult(results);

  const successTxids = results.filter(r => r.txid).map(r => r.txid);
  if (!CONFIG.dryRun && ok > 0) {
    saveState(successTxids);
  }

  const tgMsg = '🤖 <b>Bitflow DCA</b>\n' +
    '💲 STX: <b>$' + stxPrice.toFixed(4) + '</b>\n\n' +
    results.map(r => {
      if (r.status === 'ok') return '✅ <b>' + r.token + '</b>: ' + r.amountStx.toFixed(4) + ' STX\n  <a href="https://explorer.hiro.so/txid/'+r.txid+'?chain=mainnet">ver tx</a>';
      if (r.status === 'dry-run') return '🔵 <b>' + r.token + '</b>: dry-run';
      return '❌ <b>' + r.token + '</b>: ' + r.reason;
    }).join('\n') +
    (CONFIG.dryRun ? '\n\n🔵 <i>dry-run</i>' : '') +
    '\n⏱ ' + elapsed + 's';

  if (!CONFIG.dryRun) await sendTelegram(tgMsg);
}

main().catch(e => {
  console.error('\nFatal:', e.message);
  sendTelegram('❌ <b>Bitflow DCA falhou</b>\n' + e.message).finally(() => process.exit(1));
});
