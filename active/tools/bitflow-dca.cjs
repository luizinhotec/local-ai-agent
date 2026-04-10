'use strict';
const https = require('https');
const { execSync } = require('child_process');
const { uintCV, noneCV, contractPrincipalCV, tupleCV, serializeCV } = require('@stacks/transactions');
require('dotenv').config({ path: '.env.local' });

const CONFIG = {
  targets: [
    { tokenId: 'token-sbtc', label: 'sBTC', allocation: 1.0 },
    // { tokenId: 'token-dog', label: 'DOG', allocation: 0.5 }, // aguardar pontis-bridge-DOG no Bitflow
  ],
  fromToken: 'token-stx',
  dailyBudgetUSD: 5.0,
  maxSlippagePct: 1.0,
  dryRun: process.argv.includes('--dry-run') || process.env.DCA_DRY_RUN === 'true',
  stacksAddress: process.env.STACKS_ADDRESS,
  privateKey: process.env.STACKS_PRIVATE_KEY,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '5998650775',
  priceApi: 'https://bitflow-analytics.vercel.app/api/prices/stx',
  bitflowApi: 'https://beta.bitflow.finance/api',
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendTelegram(msg) {
  if (!CONFIG.telegramToken) return;
  await httpPost(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`, { chat_id: CONFIG.telegramChatId, text: msg, parse_mode: 'HTML' });
}

async function getStxPrice() {
  const res = await httpGet(CONFIG.priceApi);
  return res.data;
}

// Contratos Bitflow
const BF = 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR';
const TOKEN_STX  = contractPrincipalCV(BF, 'token-stx-v-1-2');
const TOKEN_SBTC = contractPrincipalCV('SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4', 'sbtc-token');
const POOL_SBTC_STX = contractPrincipalCV(BF, 'xyk-pool-sbtc-stx-v-1-1');

const ROUTES = {
  'token-sbtc': {
    quoteFunc: 'get-quote-a',
    swapFunc:  'swap-helper-a',
    // get-quote-a args: amount, provider(none), xyk-tokens{a,b}, xyk-pools{a}
    buildArgs: (amountMicro) => [
      '0x' + serializeCV(uintCV(amountMicro)),
      '0x' + serializeCV(noneCV()),
      '0x' + serializeCV(tupleCV({ a: TOKEN_STX, b: TOKEN_SBTC })),
      '0x' + serializeCV(tupleCV({ a: POOL_SBTC_STX })),
    ],
  },
  // token-dog: aguardando pontis-bridge-DOG no Bitflow
  // Contratos mapeados, só descomentar quando liberado:
  // 'token-dog': {
  //   quoteFunc: 'get-quote-d',
  //   swapFunc:  'swap-helper-d',
  //   // xyk-tokens: STX→sBTC→sBTC→LIQ→LIQ→pBTC→pBTC→DOG (8 slots, 2 por hop)
  //   // xyk-pools: xyk-pool-sbtc-stx → xyk-pool-sbtc-liq → xyk-pool-pbtc-liq → xyk-pool-pbtc-dog
  //   buildArgs: (amountMicro) => [ ... ],
  // },
};

async function getBestQuote(toTokenId, amountStx) {
  const amountMicro = Math.round(amountStx * 1e6);
  const route = ROUTES[toTokenId];

  if (route === undefined) throw new Error(`Rota não configurada para ${toTokenId}`);
  if (route === null) throw new Error(`Rota indisponível: ${toTokenId} não suportado pelo Bitflow ainda`);

  const url = `https://node.bitflowapis.finance/v2/contracts/call-read/${BF}/xyk-swap-helper-v-1-3/${route.quoteFunc}`;
  const body = { sender: BF, arguments: route.buildArgs(amountMicro) };

  const res = await httpPost(url, body);
  if (!res.okay) throw new Error(`Quote falhou: ${res.cause || JSON.stringify(res)}`);
  return { route, quoteResult: res, amountMicro };
}

async function main() {
  console.log(`\n🤖 Bitflow DCA — ${new Date().toISOString()}`);
  console.log(`   Modo: ${CONFIG.dryRun ? 'DRY-RUN 🔵' : 'PRODUÇÃO 🔴'}`);
  const results = [];
  const stxPrice = await getStxPrice();
  console.log(`💲 STX: $${stxPrice.toFixed(4)}`);

  for (const target of CONFIG.targets) {
    const amountStx = (CONFIG.dailyBudgetUSD * target.allocation) / stxPrice;
    console.log(`\n─── ${target.label}: ${amountStx.toFixed(4)} STX`);
    try {
      const quote = await getBestQuote(target.tokenId, amountStx);
      console.log(`   Quote: ${JSON.stringify(quote).slice(0, 120)}`);
      if (CONFIG.dryRun) {
        console.log(`   [DRY-RUN] Swap simulado ✓`);
        results.push({ token: target.label, status: 'dry-run', amountStx });
      } else {
        console.log(`   ⚠️  Execução real requer validação dos contratos Keeper`);
        results.push({ token: target.label, status: 'pending', amountStx });
      }
    } catch(e) {
      console.error(`   ❌ ${e.message}`);
      results.push({ token: target.label, status: 'error', reason: e.message, amountStx });
    }
  }

  const summary = results.map(r => `${r.token}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`).join(' | ');
  console.log(`\n📊 Resumo: ${summary}`);

  if (!CONFIG.dryRun) {
    await sendTelegram(`🤖 <b>DCA Bitflow</b>\n${results.map(r => `• ${r.token}: ${r.status}${r.reason ? ` — ${r.reason}` : ''}`).join('\n')}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
