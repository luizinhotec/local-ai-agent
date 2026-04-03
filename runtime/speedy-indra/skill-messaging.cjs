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
  createPaymentClient,
  privateKeyToAccount,
  decodePaymentRequired,
  getPaymentResponseFromHeaders,
} = require('x402-stacks');
const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { appendJsonLog } = require('./lib/agent-logger.cjs');
const { readAgentState, updateAgentState, writeAgentStatus } = require('./lib/agent-state.cjs');

const API_BASE_URL = 'https://aibtc.com';
const HIRO_API = 'https://api.hiro.so';
const DEFAULT_REPLY_TEMPLATES = [
  'Recebido. Estou ativando um loop operacional mais consistente e sigo acompanhando seu agente.',
  'Mensagem recebida. Estou consolidando heartbeat, inbox e automacao segura no Speedy Indra.',
  'Recebido. Vou manter o agente mais ativo e com resposta operacional objetiva nas proximas rodadas.',
];
const EXPERIMENTAL_REPLY_TEMPLATES = [
  { id: 'exp-ops-01', text: 'Recebido. Estou testando um loop mais frequente com replies curtos e verificacao objetiva de resultados.' },
  { id: 'exp-social-02', text: 'Mensagem recebida. Estou experimentando presenca social controlada, sem flood, com resposta curta e observavel.' },
  { id: 'exp-achv-03', text: 'Recebido. Estou validando rotinas pequenas para ampliar atividade do agente e detectar achievements novos.' },
];
const DEFAULT_OUTBOUND_TEMPLATES = [
  'Speedy Indra online. Estou ativando heartbeat resiliente e inbox controlada.',
  'Speedy Indra em operacao. Foco atual: presenca recorrente, inbox limpa e automacao segura.',
  'Speedy Indra ativo. Estou consolidando runtime, messaging controlado e observabilidade local.',
];

function resolveMessagingPolicy(config) {
  const featureEnabled = Boolean(config.featureFlags.messaging);
  const safeRepliesOnly = Boolean(config.messaging.safeRepliesOnly);
  const fullOutboundEnabled = Boolean(config.messaging.fullOutboundEnabled);

  if (!featureEnabled) {
    return {
      enabled: false,
      valid: true,
      policyMode: 'disabled',
      activePolicy: 'disabled',
      outboundAllowed: false,
      reason: 'feature_disabled',
    };
  }

  if (safeRepliesOnly && fullOutboundEnabled) {
    return {
      enabled: true,
      valid: false,
      policyMode: 'invalid',
      activePolicy: 'invalid',
      outboundAllowed: false,
      reason: 'invalid_policy_combination',
    };
  }

  if (safeRepliesOnly) {
    return {
      enabled: true,
      valid: true,
      policyMode: 'safe_replies_only',
      activePolicy: 'safe_replies_only',
      outboundAllowed: false,
      reason: 'safe_replies_only_active',
    };
  }

  if (fullOutboundEnabled) {
    return {
      enabled: true,
      valid: true,
      policyMode: 'full_outbound',
      activePolicy: 'full_outbound',
      outboundAllowed: true,
      reason: 'full_outbound_explicitly_enabled',
    };
  }

  return {
    enabled: true,
    valid: false,
    policyMode: 'invalid',
    activePolicy: 'invalid',
    outboundAllowed: false,
    reason: 'messaging_policy_ambiguous_fail_closed',
  };
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (['signature', 'payment-signature', 'walletPassword', 'mnemonic'].includes(key)) {
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
    headers: Object.fromEntries(response.headers.entries()),
  };
}

function readWalletCatalog() {
  const catalogPath = path.join(os.homedir(), '.aibtc', 'wallets.json');
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
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

function chooseWallet(catalog, walletName, expectedAddress, walletId) {
  if (walletId) {
    const exact = catalog.wallets.find(wallet => wallet.id === walletId);
    if (!exact) {
      throw new Error(`wallet id not found: ${walletId}`);
    }
    return exact;
  }

  const matches = (catalog.wallets || [])
    .filter(wallet => wallet.name === walletName)
    .filter(wallet => !expectedAddress || wallet.btcAddress === expectedAddress)
    .sort((left, right) => {
      const leftDate = new Date(left.lastUsed || left.createdAt || 0).getTime();
      const rightDate = new Date(right.lastUsed || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    });

  if (matches.length === 0) {
    throw new Error(`no wallet named ${walletName} matched the expected BTC address ${expectedAddress}`);
  }

  return matches[0];
}

function deriveSigner(config) {
  let mnemonic = process.env.AIBTC_HEARTBEAT_MNEMONIC || process.env.CLIENT_MNEMONIC || '';
  let wallet = null;
  const walletPassword = process.env.AIBTC_WALLET_PASSWORD || '';

  if (!mnemonic) {
    if (!walletPassword) {
      throw new Error(
        'missing signer source: set AIBTC_HEARTBEAT_MNEMONIC/CLIENT_MNEMONIC or provide AIBTC_WALLET_PASSWORD'
      );
    }
    const catalog = readWalletCatalog();
    wallet = chooseWallet(
      catalog,
      process.env.AIBTC_WALLET_NAME || 'leather',
      config.btcAddress,
      process.env.AIBTC_WALLET_ID || ''
    );
    mnemonic = decryptMnemonic(wallet.id, walletPassword);
  }

  const seed = Buffer.from(mnemonicToSeedSync(mnemonic));
  const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
  const child = root.derivePath(process.env.AIBTC_HEARTBEAT_DERIVATION_PATH || "m/84'/0'/0'/0/0");
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

async function deriveStacksPaymentAccount(config) {
  let mnemonic = process.env.AIBTC_HEARTBEAT_MNEMONIC || process.env.CLIENT_MNEMONIC || '';
  let wallet = null;
  const walletPassword = process.env.AIBTC_WALLET_PASSWORD || '';

  if (!mnemonic) {
    if (!walletPassword) {
      throw new Error(
        'missing signer source: set AIBTC_HEARTBEAT_MNEMONIC/CLIENT_MNEMONIC or provide AIBTC_WALLET_PASSWORD'
      );
    }
    const catalog = readWalletCatalog();
    wallet = chooseWallet(
      catalog,
      process.env.AIBTC_WALLET_NAME || 'leather',
      config.btcAddress,
      process.env.AIBTC_WALLET_ID || ''
    );
    mnemonic = decryptMnemonic(wallet.id, walletPassword);
  }

  const generatedWallet = await generateWallet({
    secretKey: mnemonic,
    password: 'speedy-indra-messaging',
  });
  const account = generatedWallet.accounts?.[0];
  if (!account?.stxPrivateKey) {
    throw new Error('failed_to_derive_stx_private_key');
  }

  const derivedAddress = getStxAddress({
    account,
    network: 'mainnet',
  });
  if (derivedAddress !== config.stxAddress) {
    throw new Error(`derived STX address ${derivedAddress} does not match expected ${config.stxAddress}`);
  }

  return {
    wallet,
    account: privateKeyToAccount(account.stxPrivateKey, 'mainnet'),
    stxPrivateKey: account.stxPrivateKey,
    stxAddress: derivedAddress,
  };
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

async function fetchWalletBalances(stxAddress) {
  const response = await fetchJson(`${HIRO_API}/extended/v1/address/${encodeURIComponent(stxAddress)}/balances`);
  if (!response.ok) {
    return {
      ok: false,
      reason: 'stacks_balance_lookup_failed',
      response,
    };
  }

  const stx = response.body?.stx || {};
  const fungibleTokens = response.body?.fungible_tokens || {};
  const sbtc = findTokenBalance(fungibleTokens, '.sbtc-token');
  return {
    ok: true,
    stxMicroStx: Number(stx.balance || 0),
    sbtcSats: sbtc.balance,
    tokenKeys: {
      sbtc: sbtc.tokenKey,
    },
  };
}

async function buildPaymentReadiness(config, paymentDetails) {
  const amount = Number(paymentDetails?.selectedOption?.amountNumber || 0);
  const assetType = paymentDetails?.selectedOption?.assetType || 'unknown';
  const maxAllowed = Number(config.messaging.maxPaymentSats || config.safety.maxTxValueSats || 0);

  let walletReady = false;
  let signer = null;
  let signerError = null;
  try {
    signer = await deriveStacksPaymentAccount(config);
    walletReady = true;
  } catch (error) {
    signerError = error.message;
  }

  let balances = null;
  let balanceLookupError = null;
  if (walletReady) {
    balances = await fetchWalletBalances(config.stxAddress);
    if (!balances.ok) {
      balanceLookupError = balances.reason || 'stacks_balance_lookup_failed';
    }
  }

  const balanceSufficient =
    walletReady && balances?.ok
      ? assetType === 'stx'
        ? balances.stxMicroStx >= amount
        : assetType === 'sbtc'
        ? balances.sbtcSats >= amount
        : false
      : false;

  return {
    walletReady,
    signer,
    signerError,
    balances,
    balanceLookupError,
    balanceSufficient,
    assetType,
    amount,
    maxAllowed,
    paymentAllowedByLimit: maxAllowed <= 0 ? true : amount <= maxAllowed,
  };
}

function extractPaymentRequiredDetails(response) {
  const headerValue = response?.headers?.['payment-required'] || response?.headers?.['Payment-Required'];
  const headerPayload = decodePaymentRequired(headerValue);
  const paymentRequired = headerPayload || response?.body || null;
  if (!paymentRequired || paymentRequired.x402Version !== 2 || !Array.isArray(paymentRequired.accepts)) {
    return null;
  }

  const selectedOption = paymentRequired.accepts.find(option => option?.network === 'stacks:1') || null;
  if (!selectedOption) {
    return {
      paymentRequired,
      selectedOption: null,
    };
  }

  const asset = String(selectedOption.asset || '').toLowerCase();
  const assetType = asset === 'stx' ? 'stx' : asset.includes('.sbtc-token') ? 'sbtc' : 'unknown';

  return {
    paymentRequired,
    selectedOption: {
      ...selectedOption,
      assetType,
      amountNumber: Number(selectedOption.amount || 0),
    },
  };
}

async function executePaidMessageSend(item, request, paymentDetails, config) {
  const readiness = await buildPaymentReadiness(config, paymentDetails);
  if (!readiness.walletReady) {
    return {
      ok: false,
      skipped: false,
      reason: 'payment_wallet_not_ready',
      payment: {
        walletReady: false,
        signerError: readiness.signerError,
      },
    };
  }
  if (!readiness.balances?.ok) {
    return {
      ok: false,
      skipped: false,
      reason: readiness.balanceLookupError || 'stacks_balance_lookup_failed',
      payment: sanitizeValue({
        walletReady: true,
        balances: readiness.balances,
      }),
    };
  }

  if (!Number.isFinite(readiness.amount) || readiness.amount <= 0) {
    return {
      ok: false,
      skipped: false,
      reason: 'payment_amount_invalid',
      payment: sanitizeValue(paymentDetails),
    };
  }
  if (!readiness.paymentAllowedByLimit) {
    return {
      ok: false,
      skipped: true,
      reason: 'payment_amount_above_safe_limit',
      payment: sanitizeValue(readiness),
    };
  }
  if (!readiness.balanceSufficient) {
    return {
      ok: false,
      skipped: true,
      reason: 'payment_balance_insufficient',
      payment: sanitizeValue(readiness),
    };
  }

  const api = createPaymentClient(readiness.signer.account, {
    baseURL: API_BASE_URL,
    timeout: 60000,
  });

  const response = await api.post(`/api/inbox/${encodeURIComponent(item.targetBtcAddress)}`, request, {
    headers: {
      'content-type': 'application/json',
    },
  });
  const paymentResponse = getPaymentResponseFromHeaders(response);
  return {
    ok: response.status >= 200 && response.status < 300,
    skipped: false,
    dryRun: false,
    action: 'send_inbox_message_after_payment',
    item: sanitizeValue(item),
    request: sanitizeValue(request),
    response: {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      body: sanitizeValue(response.data),
      headers: sanitizeValue(response.headers),
    },
    payment: {
      assetType: readiness.assetType,
      amount: readiness.amount,
      payTo: paymentDetails.selectedOption?.payTo || null,
      network: paymentDetails.selectedOption?.network || null,
      walletReady: true,
      balances: sanitizeValue(readiness.balances),
      paymentResponse: sanitizeValue(paymentResponse),
      txId: paymentResponse?.transaction || null,
    },
  };
}

function buildReplyMessage(messageId, reply) {
  return `Inbox Reply | ${messageId} | ${reply}`;
}

function buildReadMessage(messageId) {
  return `Inbox Read | ${messageId}`;
}

function summarizeInboxMessage(message, reply) {
  return {
    messageId: message.messageId,
    fromAddress: message.fromAddress,
    peerBtcAddress: message.peerBtcAddress || null,
    peerDisplayName: message.peerDisplayName || null,
    content: message.content,
    sentAt: message.sentAt,
    readAt: message.readAt || null,
    repliedAt: message.repliedAt || reply?.repliedAt || null,
    paymentSatoshis: message.paymentSatoshis,
  };
}

function trimReplyHistory(entries) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return (entries || [])
    .filter(entry => new Date(entry.at || entry.timestamp || 0).getTime() >= cutoff)
    .slice(-50);
}

function buildReplyHistory(inboxMessages, outboxResult) {
  const byMessageId = new Map();
  for (const message of inboxMessages || []) {
    if (!message.repliedAt) {
      continue;
    }
    byMessageId.set(message.messageId, {
      at: message.repliedAt,
      messageId: message.messageId,
      peerBtcAddress: message.peerBtcAddress || null,
      peerDisplayName: message.peerDisplayName || null,
    });
  }

  for (const reply of outboxResult?.body?.outbox?.replies || []) {
    if (!byMessageId.has(reply.messageId)) {
      byMessageId.set(reply.messageId, {
        at: reply.repliedAt || null,
        messageId: reply.messageId,
        peerBtcAddress: reply.toBtcAddress || null,
        peerDisplayName: null,
      });
    }
  }

  return Array.from(byMessageId.values())
    .sort((left, right) => new Date(left.at || 0).getTime() - new Date(right.at || 0).getTime())
    .slice(-10);
}

function buildExperimentId(candidate, templateId) {
  return `msgexp_${sha256(`${candidate.messageId}:${templateId}`).slice(0, 10)}`;
}

function pickReplyVariant(config, candidate) {
  if (config.messaging.experimentalEnabled) {
    const selected = EXPERIMENTAL_REPLY_TEMPLATES[
      Number.parseInt(sha256(`${candidate.messageId}:${candidate.peerBtcAddress || candidate.fromAddress}`).slice(0, 8), 16) %
        EXPERIMENTAL_REPLY_TEMPLATES.length
    ];
    const experimentId = buildExperimentId(candidate, selected.id);
    return {
      templateId: selected.id,
      experimentId,
      replyText: `${selected.text} [exp:${experimentId}]`,
      experimental: true,
    };
  }

  const replyText = pickTemplate(
    DEFAULT_REPLY_TEMPLATES,
    `${candidate.messageId}:${candidate.peerBtcAddress || candidate.fromAddress}`
  );
  return {
    templateId: `default_${sha256(replyText).slice(0, 8)}`,
    experimentId: null,
    replyText,
    experimental: false,
  };
}

function canReplyToTarget(state, config, candidate) {
  const target = candidate.peerBtcAddress || candidate.fromAddress;
  const cooldownMs = config.messaging.cooldownMin * 60 * 1000;
  const lastReply = (state.lastReplyTargets || [])
    .filter(entry => entry.peerBtcAddress === target)
    .sort((left, right) => new Date(right.at || 0).getTime() - new Date(left.at || 0).getTime())[0];
  if (lastReply?.at) {
    const lastAt = new Date(lastReply.at).getTime();
    if (Number.isFinite(lastAt) && Date.now() - lastAt < cooldownMs) {
      return { allowed: false, reason: 'reply_target_cooldown_active' };
    }
  }
  return { allowed: true };
}

function selectReplyCandidates(inboxResponse, state, config, options = {}) {
  const inboxMessages = inboxResponse?.body?.inbox?.messages || [];
  const replies = inboxResponse?.body?.inbox?.replies || {};
  const maxRepliesPerCycle = Math.max(
    0,
    Number.isFinite(Number(options.maxRepliesPerCycle))
      ? Number(options.maxRepliesPerCycle)
      : config.messaging.maxRepliesPerCycle
  );
  const unreadCandidates = inboxMessages
    .filter(message => !message.repliedAt && !replies[message.messageId])
    .slice(0, maxRepliesPerCycle);

  const candidates = [];
  const blockedCandidates = [];
  for (const candidate of unreadCandidates) {
    const replySafety = canReplyToTarget(state, config, candidate);
    if (!replySafety.allowed) {
      blockedCandidates.push({
        candidate: summarizeInboxMessage(candidate),
        reason: replySafety.reason,
      });
      continue;
    }
    candidates.push(candidate);
  }

  return {
    candidates,
    blockedCandidates,
    skippedReason:
      candidates.length === 0
        ? blockedCandidates.length > 0
          ? blockedCandidates[0].reason || 'reply_skipped_by_rule'
          : 'no_reply_candidate'
        : null,
  };
}

function computeReplyAnalytics(replyHistory) {
  const history = trimReplyHistory(replyHistory);
  const total = history.length;
  const successes = history.filter(entry => entry.success).length;
  const failures = history.filter(entry => !entry.success).length;
  const templateCounters = {};
  const achievementsDetected = [];

  for (const entry of history) {
    templateCounters[entry.templateId] = (templateCounters[entry.templateId] || 0) + 1;
    if (entry.achievementId) {
      achievementsDetected.push({
        at: entry.at,
        achievementId: entry.achievementId,
        templateId: entry.templateId,
        target: entry.target,
      });
    }
  }

  return {
    history,
    templateCounters,
    metrics: {
      total,
      successes,
      failures,
      successRate: total > 0 ? Number((successes / total).toFixed(4)) : 0,
      achievementsDetected: achievementsDetected.slice(-20),
    },
  };
}

function trimMessageWindow(entries) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  return (entries || []).filter(entry => new Date(entry.at).getTime() >= cutoff);
}

function trimRecentHashes(entries) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return (entries || []).filter(entry => new Date(entry.at).getTime() >= cutoff).slice(-50);
}

function pickTemplate(templates, seed) {
  const index = Number.parseInt(sha256(seed).slice(0, 8), 16) % templates.length;
  return templates[index];
}

function buildQueueItem({ targetBtcAddress, targetStxAddress, targetDisplayName, content, source }) {
  const normalizedContent = String(content || '').trim();
  return {
    id: `queue_${Date.now()}_${crypto.randomUUID()}`,
    targetBtcAddress,
    targetStxAddress: targetStxAddress || null,
    targetDisplayName: targetDisplayName || null,
    content: normalizedContent,
    contentHash: sha256(normalizedContent),
    source: source || 'manual',
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
    lastAttemptAt: null,
    lastError: null,
    lastStatusCode: null,
  };
}

async function fetchAgent(address) {
  return fetchJson(`${API_BASE_URL}/api/agents/${encodeURIComponent(address)}`);
}

async function fetchInbox(address, limit) {
  return fetchJson(
    `${API_BASE_URL}/api/inbox/${encodeURIComponent(address)}?view=received&limit=${limit}`
  );
}

async function fetchOutbox(address, limit) {
  return fetchJson(`${API_BASE_URL}/api/outbox/${encodeURIComponent(address)}?limit=${limit}`);
}

function queueFromAllowlist(state, config) {
  const pendingTargets = new Set((state.outboundQueue || []).map(item => item.targetBtcAddress));
  const seeded = [];

  for (const target of config.safety.targetAllowlist) {
    if (!target || target === config.btcAddress || pendingTargets.has(target)) {
      continue;
    }
    seeded.push(
      buildQueueItem({
        targetBtcAddress: target,
        content: pickTemplate(
          DEFAULT_OUTBOUND_TEMPLATES,
          `${target}:${new Date().toISOString().slice(0, 10)}`
        ),
        source: 'allowlist_seed',
      })
    );
    pendingTargets.add(target);
  }

  return seeded;
}

function canSendToTarget(state, config, item, force) {
  if (!force && config.safety.targetAllowlist.length > 0) {
    const targetAllowed =
      config.safety.targetAllowlist.includes(item.targetBtcAddress) ||
      (item.targetStxAddress && config.safety.targetAllowlist.includes(item.targetStxAddress));
    if (!targetAllowed) {
      return { allowed: false, reason: 'target_not_allowlisted' };
    }
  }

  const recentWindow = trimMessageWindow(state.messageWindow || []);
  if (!force && recentWindow.length >= config.safety.maxMessagesPerHour) {
    return { allowed: false, reason: 'hourly_limit_reached' };
  }

  const lastByTarget = state.lastMessageByTarget?.[item.targetBtcAddress];
  if (!force && lastByTarget?.sentAt) {
    const lastAt = new Date(lastByTarget.sentAt).getTime();
    const cooldownMs = config.messaging.cooldownMin * 60 * 1000;
    if (Number.isFinite(lastAt) && Date.now() - lastAt < cooldownMs) {
      return { allowed: false, reason: 'target_cooldown_active' };
    }
  }

  const recentHashes = trimRecentHashes(state.recentMessageHashes || []);
  if (!force && recentHashes.some(entry => entry.hash === item.contentHash)) {
    return { allowed: false, reason: 'duplicate_content_recent' };
  }

  return { allowed: true };
}

async function processOutboundItem(item, state, config, options) {
  const isPaymentCompletion = item.status === 'payment_required';
  const safety = canSendToTarget(state, config, item, options.force);
  if (!isPaymentCompletion && !safety.allowed) {
    return {
      ok: true,
      skipped: true,
      reason: safety.reason,
      item: sanitizeValue(item),
    };
  }

  let resolvedItem = { ...item };
  if (!resolvedItem.targetStxAddress || !resolvedItem.targetDisplayName) {
    const agentLookup = await fetchAgent(item.targetBtcAddress);
    if (agentLookup.ok) {
      resolvedItem = {
        ...resolvedItem,
        targetStxAddress: agentLookup.body?.agent?.stxAddress || resolvedItem.targetStxAddress,
        targetDisplayName: agentLookup.body?.agent?.displayName || resolvedItem.targetDisplayName,
      };
    }
  }

  const request = {
    toBtcAddress: resolvedItem.targetBtcAddress,
    toStxAddress: resolvedItem.targetStxAddress,
    content: resolvedItem.content,
    paymentSatoshis: config.messaging.paymentSatoshis,
  };

  if (!request.toBtcAddress || !request.toStxAddress) {
    return {
      ok: false,
      skipped: false,
      reason: 'target_resolution_incomplete',
      item: sanitizeValue(resolvedItem),
      request: sanitizeValue(request),
    };
  }

  if (options.dryRun && !(isPaymentCompletion && options.payRequired)) {
    return {
      ok: true,
      dryRun: true,
      action: 'send_inbox_message',
      item: sanitizeValue(resolvedItem),
      request: sanitizeValue(request),
    };
  }

  const response = await fetchJson(`${API_BASE_URL}/api/inbox/${encodeURIComponent(resolvedItem.targetBtcAddress)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const paymentDetails = response.status === 402 ? extractPaymentRequiredDetails(response) : null;

  if (response.status === 402 && isPaymentCompletion && options.payRequired) {
    const paymentReadiness = await buildPaymentReadiness(config, paymentDetails);
    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        action: 'pay_and_send_inbox_message',
        item: sanitizeValue(resolvedItem),
        request: sanitizeValue(request),
        paymentRequired: true,
        payment: sanitizeValue({
          ...paymentDetails,
          readiness: paymentReadiness,
        }),
      };
    }

    if (!options.approveLive) {
      return {
        ok: false,
        skipped: true,
        dryRun: false,
        action: 'pay_and_send_inbox_message',
        reason: 'approve_live_missing',
        item: sanitizeValue(resolvedItem),
        request: sanitizeValue(request),
        paymentRequired: true,
        payment: sanitizeValue({
          ...paymentDetails,
          readiness: paymentReadiness,
        }),
      };
    }

    if (!paymentDetails?.selectedOption) {
      return {
        ok: false,
        skipped: false,
        dryRun: false,
        action: 'pay_and_send_inbox_message',
        reason: 'payment_option_unavailable',
        item: sanitizeValue(resolvedItem),
        request: sanitizeValue(request),
        paymentRequired: true,
        payment: sanitizeValue(paymentDetails),
      };
    }

    const paidSendResult = await executePaidMessageSend(resolvedItem, request, paymentDetails, config);
    return {
      ...paidSendResult,
      paymentRequired: true,
      item: sanitizeValue(resolvedItem),
      request: sanitizeValue(request),
    };
  }

  return {
    ok: response.ok,
    dryRun: false,
    action: 'send_inbox_message',
    item: sanitizeValue(resolvedItem),
    request: sanitizeValue(request),
    response: sanitizeValue(response),
    paymentRequired: response.status === 402,
    payment: sanitizeValue(paymentDetails),
  };
}

async function maybeReplyToInbox(inboxResponse, state, config, options) {
  const candidateSelection = selectReplyCandidates(inboxResponse, state, config, options);
  const candidates = candidateSelection.candidates;

  if (candidates.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: candidateSelection.skippedReason || 'no_reply_candidate',
      blockedCandidates: candidateSelection.blockedCandidates,
    };
  }

  const signer = deriveSigner(config);
  const results = [];
  for (const candidate of candidates) {
    const replySafety = canReplyToTarget(state, config, candidate);
    const variant = pickReplyVariant(config, candidate);
    if (!replySafety.allowed) {
      results.push({
        ok: true,
        skipped: true,
        dryRun: options.dryRun,
        reason: replySafety.reason,
        candidate: summarizeInboxMessage(candidate),
        templateId: variant.templateId,
        experimentId: variant.experimentId,
      });
      continue;
    }
    const replyRequest = {
      messageId: candidate.messageId,
      reply: variant.replyText,
      signature: Signer.sign(
        signer.wif,
        signer.address,
        buildReplyMessage(candidate.messageId, variant.replyText)
      ),
    };
    const markReadRequest = {
      messageId: candidate.messageId,
      signature: Signer.sign(signer.wif, signer.address, buildReadMessage(candidate.messageId)),
    };

    if (options.dryRun) {
      results.push({
        ok: true,
        dryRun: true,
        candidate: summarizeInboxMessage(candidate),
        templateId: variant.templateId,
        experimentId: variant.experimentId,
        replyRequest: sanitizeValue(replyRequest),
        markReadRequest: sanitizeValue(markReadRequest),
      });
      continue;
    }

    const replyResponse = await fetchJson(`${API_BASE_URL}/api/outbox/${encodeURIComponent(config.btcAddress)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(replyRequest),
    });

    let readResponse = null;
    if (replyResponse.ok) {
      readResponse = await fetchJson(
        `${API_BASE_URL}/api/inbox/${encodeURIComponent(config.btcAddress)}/${encodeURIComponent(candidate.messageId)}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(markReadRequest),
        }
      );
    }
    const readAccepted = !readResponse || readResponse.ok || readResponse.status === 409;

    results.push({
      ok: replyResponse.ok && readAccepted,
      dryRun: false,
      candidate: summarizeInboxMessage(candidate),
      templateId: variant.templateId,
      experimentId: variant.experimentId,
      experimental: variant.experimental,
      replyRequest: sanitizeValue(replyRequest),
      markReadRequest: sanitizeValue(markReadRequest),
      replyResponse: sanitizeValue(replyResponse),
      readResponse: sanitizeValue(readResponse),
    });
  }

  const aggregateOk = results.every(item => item.ok);
  if (options.dryRun) {
    return {
      ok: aggregateOk,
      dryRun: true,
      repliedCount: results.length,
      results,
    };
  }

  return {
    ok: aggregateOk,
    dryRun: false,
    repliedCount: results.length,
    results,
  };
}

async function executeManualReplyCandidate(candidate, state, config, options = {}) {
  const dryRun = parseBoolean(options.dryRun, true);
  const liveRouteName = options.liveRouteName || 'bounty_reply_manual_approved';

  if (!candidate || typeof candidate !== 'object') {
    return {
      ok: false,
      dryRun,
      reason: 'missing_required_candidate_fields',
      failureClass: 'validation',
      liveRouteName,
    };
  }

  const requiredFields = ['messageId', 'peerBtcAddress', 'content'];
  const missingRequiredFields = requiredFields.filter(field => !candidate[field]);
  if (missingRequiredFields.length > 0) {
    return {
      ok: false,
      dryRun,
      reason: 'missing_required_candidate_fields',
      failureClass: 'validation',
      liveRouteName,
      missingRequiredFields,
      candidate: sanitizeValue(summarizeInboxMessage(candidate)),
    };
  }

  const messagingPolicy = resolveMessagingPolicy(config);
  if (!messagingPolicy.enabled) {
    return {
      ok: false,
      dryRun,
      reason: 'messaging_feature_disabled',
      failureClass: 'policy',
      liveRouteName,
      candidate: sanitizeValue(summarizeInboxMessage(candidate)),
    };
  }
  if (!messagingPolicy.valid) {
    return {
      ok: false,
      dryRun,
      reason: 'messaging_policy_invalid',
      failureClass: 'policy',
      liveRouteName,
      candidate: sanitizeValue(summarizeInboxMessage(candidate)),
    };
  }

  const replySafety = canReplyToTarget(state, config, candidate);
  const variant = pickReplyVariant(config, candidate);
  if (!replySafety.allowed) {
    return {
      ok: false,
      dryRun,
      reason: replySafety.reason,
      failureClass: 'policy',
      liveRouteName,
      candidate: sanitizeValue(summarizeInboxMessage(candidate)),
      templateId: variant.templateId,
      experimentId: variant.experimentId,
    };
  }

  let signer = null;
  try {
    signer = deriveSigner(config);
  } catch (error) {
    return {
      ok: false,
      dryRun,
      reason: 'reply_signer_not_ready',
      failureClass: 'wallet',
      liveRouteName,
      error: error.message,
      candidate: sanitizeValue(summarizeInboxMessage(candidate)),
      templateId: variant.templateId,
      experimentId: variant.experimentId,
    };
  }

  const replyRequest = {
    messageId: candidate.messageId,
    reply: variant.replyText,
    signature: Signer.sign(
      signer.wif,
      signer.address,
      buildReplyMessage(candidate.messageId, variant.replyText)
    ),
  };
  const markReadRequest = {
    messageId: candidate.messageId,
    signature: Signer.sign(signer.wif, signer.address, buildReadMessage(candidate.messageId)),
  };

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      status: 'executed_dry_run',
      reason: 'dry_run_preconditions_validated',
      actionType: 'reply',
      liveRouteName,
      candidate: sanitizeValue(summarizeInboxMessage(candidate)),
      templateId: variant.templateId,
      experimentId: variant.experimentId,
      experimental: variant.experimental,
      replyRequest: sanitizeValue(replyRequest),
      markReadRequest: sanitizeValue(markReadRequest),
    };
  }

  try {
    const replyResponse = await fetchJson(`${API_BASE_URL}/api/outbox/${encodeURIComponent(config.btcAddress)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(replyRequest),
    });

    let readResponse = null;
    if (replyResponse.ok) {
      readResponse = await fetchJson(
        `${API_BASE_URL}/api/inbox/${encodeURIComponent(config.btcAddress)}/${encodeURIComponent(candidate.messageId)}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(markReadRequest),
        }
      );
    }

    const readAccepted = !readResponse || readResponse.ok || readResponse.status === 409;
    if (replyResponse.ok && readAccepted) {
      return {
        ok: true,
        dryRun: false,
        status: 'executed_live',
        reason: 'live_reply_executed',
        actionType: 'reply',
        liveRouteName,
        candidate: sanitizeValue(summarizeInboxMessage(candidate)),
        templateId: variant.templateId,
        experimentId: variant.experimentId,
        experimental: variant.experimental,
        replyRequest: sanitizeValue(replyRequest),
        markReadRequest: sanitizeValue(markReadRequest),
        replyResponse: sanitizeValue(replyResponse),
        readResponse: sanitizeValue(readResponse),
      };
    }

    const responseStatus = readResponse && !readAccepted
      ? readResponse.status
      : replyResponse.status;
    const retryable = responseStatus >= 500;
    return {
      ok: false,
      dryRun: false,
      status: 'execution_failed',
      reason: replyResponse.ok ? 'reply_mark_read_failed' : 'reply_request_failed',
      failureClass: retryable ? 'transient_remote_failure' : 'remote_rejected',
      retryable,
      liveRouteName,
      candidate: sanitizeValue(summarizeInboxMessage(candidate)),
      templateId: variant.templateId,
      experimentId: variant.experimentId,
      experimental: variant.experimental,
      replyRequest: sanitizeValue(replyRequest),
      markReadRequest: sanitizeValue(markReadRequest),
      replyResponse: sanitizeValue(replyResponse),
      readResponse: sanitizeValue(readResponse),
    };
  } catch (error) {
    return {
      ok: false,
      dryRun: false,
      status: 'execution_failed',
      reason: 'reply_network_error',
      failureClass: 'transient_network_error',
      retryable: true,
      liveRouteName,
      error: error.message,
      candidate: sanitizeValue(summarizeInboxMessage(candidate)),
      templateId: variant.templateId,
      experimentId: variant.experimentId,
      experimental: variant.experimental,
    };
  }
}

async function runMessagingSkill(options = {}) {
  const config = loadAgentConfig();
  const nowIso = new Date().toISOString();
  const dryRun =
    options.dryRun === undefined ? config.messaging.dryRunDefault : parseBoolean(options.dryRun);
  const statusOnly = parseBoolean(options.statusOnly, false);
  const seedAllowlist = parseBoolean(options.seedAllowlist, false);
  const replyPending = parseBoolean(options.replyPending, false);
  const payRequired = parseBoolean(options.payRequired, false);
  const force = parseBoolean(options.force, false);
  const maxRepliesPerCycle = Number(options['max-replies-per-cycle'] || config.messaging.maxRepliesPerCycle);
  const maxPayments = Math.max(
    0,
    Number(options['max-payments'] || config.messaging.maxPaymentsPerCycle || 1)
  );
  const messagingPolicy = resolveMessagingPolicy(config);

  if (!messagingPolicy.enabled && !statusOnly) {
    appendJsonLog('messaging_feature_status', {
      enabled: false,
      policyMode: messagingPolicy.policyMode,
      reason: messagingPolicy.reason,
      dryRun,
      statusOnly,
      replyPending,
      payRequired,
    });
    const state = updateAgentState(current => {
      current.skills.messaging = {
        ...current.skills.messaging,
        enabled: false,
        policyMode: messagingPolicy.policyMode,
        activePolicy: messagingPolicy.activePolicy,
        lastRunAt: nowIso,
        lastSkipReason: messagingPolicy.reason,
        lastOutcome: 'skipped',
        lastActionType: payRequired ? 'payment' : replyPending ? 'reply' : statusOnly ? 'status' : 'none',
        lastActionResult: messagingPolicy.reason,
      };
      current.lastMessagingRunAt = nowIso;
      return current;
    });
    return {
      ok: true,
      skipped: true,
      reason: messagingPolicy.reason,
      dryRun,
      state,
    };
  }

  if (!messagingPolicy.valid) {
    appendJsonLog('messaging_feature_status', {
      enabled: true,
      policyMode: messagingPolicy.policyMode,
      reason: messagingPolicy.reason,
      dryRun,
      statusOnly,
      replyPending,
      payRequired,
    });
    const state = updateAgentState(current => {
      current.skills.messaging = {
        ...current.skills.messaging,
        enabled: true,
        policyMode: messagingPolicy.policyMode,
        activePolicy: messagingPolicy.activePolicy,
        lastRunAt: nowIso,
        lastSkipReason: messagingPolicy.reason,
        lastOutcome: 'blocked',
        lastActionType: payRequired ? 'payment' : replyPending ? 'reply' : statusOnly ? 'status' : 'none',
        lastActionResult: messagingPolicy.reason,
      };
      current.lastMessagingRunAt = nowIso;
      return current;
    });
    return {
      ok: true,
      skipped: true,
      reason: messagingPolicy.reason,
      dryRun,
      featureEnabled: true,
      policyMode: messagingPolicy.policyMode,
      state,
    };
  }

  appendJsonLog('messaging_skill_started', {
    dryRun,
    statusOnly,
    seedAllowlist,
    replyPending,
    payRequired,
    maxPayments,
    featureEnabled: messagingPolicy.enabled,
    policyMode: messagingPolicy.policyMode,
    experimental: config.messaging.experimentalEnabled,
  });
  appendJsonLog('messaging_feature_status', {
    enabled: messagingPolicy.enabled,
    policyMode: messagingPolicy.policyMode,
    activePolicy: messagingPolicy.activePolicy,
    outboundAllowed: messagingPolicy.outboundAllowed,
    reason: messagingPolicy.reason,
    dryRun,
    statusOnly,
    replyPending,
    payRequired,
  });

  let inboxResult = await fetchInbox(config.btcAddress, config.messaging.inboxFetchLimit);
  const outboxResult = await fetchOutbox(config.btcAddress, config.messaging.inboxFetchLimit);

  const previousState = readAgentState();
  const outboundBlockedByPolicy =
    !messagingPolicy.outboundAllowed &&
    ((options['enqueue-target'] && options.content) || seedAllowlist);
  const paymentBlockedByPolicy =
    payRequired &&
    !messagingPolicy.outboundAllowed &&
    (previousState.outboundQueue || []).some(item => item.status === 'payment_required');
  const manualSeed = messagingPolicy.outboundAllowed && options['enqueue-target'] && options.content
    ? [
        buildQueueItem({
          targetBtcAddress: String(options['enqueue-target']),
          content: String(options.content),
          source: 'manual_cli',
        }),
      ]
    : [];
  const allowlistSeed = messagingPolicy.outboundAllowed && seedAllowlist ? queueFromAllowlist(previousState, config) : [];

  let replyResult = {
    ok: true,
    skipped: true,
    reason: replyPending ? 'reply_not_attempted' : 'reply_disabled_for_run',
  };
  if (replyPending && inboxResult.ok) {
    replyResult = await maybeReplyToInbox(inboxResult, previousState, config, { dryRun, maxRepliesPerCycle });
    if (!dryRun && (replyResult.results || []).some(item => item.replyResponse?.ok)) {
      inboxResult = await fetchInbox(config.btcAddress, config.messaging.inboxFetchLimit);
    }
  }

  const inboxMessages = (inboxResult.body?.inbox?.messages || []).map(message =>
    summarizeInboxMessage(message, inboxResult.body?.inbox?.replies?.[message.messageId])
  );
  const replyHistory = buildReplyHistory(inboxMessages, outboxResult);

  const preparedState = updateAgentState(current => {
    current.lastMessagingRunAt = nowIso;
    current.unreadCount = inboxResult.body?.inbox?.unreadCount || 0;
    current.inboxMessages = inboxMessages.slice(0, 10);
    current.outboundQueue = [...(current.outboundQueue || []), ...manualSeed, ...allowlistSeed];
    current.messageWindow = trimMessageWindow(current.messageWindow || []);
    current.recentMessageHashes = trimRecentHashes(current.recentMessageHashes || []);
      current.skills.messaging = {
        ...current.skills.messaging,
        enabled: messagingPolicy.enabled,
        policyMode: messagingPolicy.policyMode,
        activePolicy: messagingPolicy.activePolicy,
        lastRunAt: nowIso,
        lastStatusCode: inboxResult.status,
        lastAttemptMode: dryRun ? 'dry_run' : 'live',
        lastOutcome: inboxResult.ok ? 'running' : 'failed',
        lastActionType: replyPending ? 'reply' : statusOnly ? 'status' : outboundBlockedByPolicy ? 'outbound' : 'status',
        lastActionResult: paymentBlockedByPolicy
          ? 'payment_blocked_by_policy'
          : inboxResult.ok
          ? 'inbox_loaded'
          : 'inbox_fetch_failed',
        lastFailureAt: inboxResult.ok ? current.skills.messaging.lastFailureAt : nowIso,
        errorCount: inboxResult.ok ? current.skills.messaging.errorCount : current.skills.messaging.errorCount + 1,
        lastSkipReason: null,
        lastPaymentTxId: current.skills.messaging.lastPaymentTxId || null,
    };
    return current;
  });

  const queueResults = [];
  const processLimit =
    statusOnly || !messagingPolicy.outboundAllowed ? 0 : Math.max(0, config.messaging.maxMessagesPerCycle);
  const queueById = new Map((preparedState.outboundQueue || []).map(item => [item.id, { ...item }]));
  const snapshotState = readAgentState();
  let regularProcessed = 0;
  let paymentsProcessed = 0;
  for (let index = 0; index < snapshotState.outboundQueue.length; index += 1) {
    const item = snapshotState.outboundQueue[index];
    const isPaymentCompletion = item.status === 'payment_required';
    if (isPaymentCompletion) {
      if (!payRequired) {
        continue;
      }
      if (paymentsProcessed >= maxPayments) {
        continue;
      }
      if (!messagingPolicy.outboundAllowed) {
        const blockedResult = {
          ok: true,
          skipped: true,
          dryRun,
          action: 'pay_and_send_inbox_message',
          reason: 'payment_blocked_by_policy',
          item: sanitizeValue(item),
        };
        queueResults.push(blockedResult);
        queueById.set(item.id, {
          ...item,
          attempts: item.attempts,
          lastAttemptAt: nowIso,
          lastStatusCode: null,
          lastError: 'payment_blocked_by_policy',
          status: item.status,
        });
        continue;
      }
      paymentsProcessed += 1;
    } else {
      if (regularProcessed >= processLimit) {
        continue;
      }
      regularProcessed += 1;
    }

    const result = await processOutboundItem(item, readAgentState(), config, {
      dryRun,
      force,
      payRequired,
      approveLive: parseBoolean(options.approveLive, false),
    });
    queueResults.push(result);
    queueById.set(item.id, {
      ...item,
      attempts: item.attempts + 1,
      lastAttemptAt: nowIso,
      lastStatusCode: result.response?.status || null,
      lastError: result.ok ? null : result.reason || result.response?.body?.error || 'send_failed',
      status:
        result.ok && !result.dryRun && result.paymentRequired
          ? 'completed'
          : result.ok && !result.dryRun
          ? 'sent'
          : result.paymentRequired
          ? 'payment_required'
          : item.status,
      targetStxAddress: result.item?.targetStxAddress || item.targetStxAddress || null,
      targetDisplayName: result.item?.targetDisplayName || item.targetDisplayName || null,
      lastPaymentTxId: result.payment?.txId || item.lastPaymentTxId || null,
    });
  }

  const finalState = updateAgentState(current => {
    current.outboundQueue = current.outboundQueue
      .map(item => queueById.get(item.id) || item)
      .filter(item => !['sent', 'completed'].includes(item.status));

    for (const result of queueResults) {
      const item = result.item;
      if (!item) {
        continue;
      }
      if (result.payment?.txId) {
        appendJsonLog('payment_executed', {
          targetBtcAddress: item.targetBtcAddress,
          targetStxAddress: item.targetStxAddress || null,
          paymentTxId: result.payment.txId,
          amount: result.payment.amount,
          assetType: result.payment.assetType,
          queueItemId: item.id,
        });
      }
      if (result.ok && !result.dryRun && !result.paymentRequired) {
        current.sentMessages += 1;
        current.lastMessageByTarget[item.targetBtcAddress] = {
          sentAt: nowIso,
          contentHash: sha256(item.content),
          contentPreview: String(item.content).slice(0, 120),
        };
        current.messageWindow.push({ at: nowIso, target: item.targetBtcAddress });
        current.recentMessageHashes.push({ at: nowIso, hash: sha256(item.content) });
      } else if (result.ok && !result.dryRun && result.paymentRequired) {
        current.sentMessages += 1;
        current.lastMessageByTarget[item.targetBtcAddress] = {
          sentAt: nowIso,
          contentHash: sha256(item.content),
          contentPreview: String(item.content).slice(0, 120),
          paymentTxId: result.payment?.txId || null,
        };
        current.messageWindow.push({ at: nowIso, target: item.targetBtcAddress });
        current.recentMessageHashes.push({ at: nowIso, hash: sha256(item.content) });
        appendJsonLog('message_sent_after_payment', {
          targetBtcAddress: item.targetBtcAddress,
          targetStxAddress: item.targetStxAddress || null,
          paymentTxId: result.payment?.txId || null,
          queueItemId: item.id,
        });
      } else if (!result.ok && !result.skipped && !result.dryRun) {
        current.failedMessages += 1;
      }
    }

    const replyEntries = replyResult.results || [];
    const newReplyHistoryEntries = [];
    if (replyEntries.length > 0) {
      const successfulReplies = replyEntries.filter(item => item.ok && !item.skipped);
      if (successfulReplies.length > 0) {
        if (!replyResult.dryRun) {
          current.repliedMessages += successfulReplies.length;
          current.lastReplyAt = nowIso;
          current.lastReplyTargets = [
            ...(current.lastReplyTargets || []),
            ...successfulReplies.map(item => ({
              at: nowIso,
              messageId: item.candidate?.messageId || null,
              peerBtcAddress: item.candidate?.peerBtcAddress || null,
              peerDisplayName: item.candidate?.peerDisplayName || null,
            })),
          ].slice(-10);
        }
      }
      for (const item of replyEntries.filter(entry => !entry.skipped)) {
        newReplyHistoryEntries.push({
          at:
            item.replyResponse?.body?.reply?.repliedAt ||
            item.readResponse?.body?.readAt ||
            nowIso,
          target: item.candidate?.peerBtcAddress || item.candidate?.fromAddress || null,
          peerDisplayName: item.candidate?.peerDisplayName || null,
          messageId: item.candidate?.messageId || null,
          templateId: item.templateId || 'unknown',
          experimentId: item.experimentId || null,
          success: Boolean(item.ok),
          dryRun: Boolean(item.dryRun),
          achievementId: item.replyResponse?.body?.achievement?.id || null,
        });
      }
    }

    if (replyHistory.length > 0) {
      current.repliedMessages = Math.max(current.repliedMessages, replyHistory.length);
      current.lastReplyAt = replyHistory[replyHistory.length - 1].at || current.lastReplyAt;
      current.lastReplyTargets = replyHistory;
    }
    current.replyHistory = trimReplyHistory([...(current.replyHistory || []), ...newReplyHistoryEntries]);
    const analytics = computeReplyAnalytics(current.replyHistory);
    current.replyTemplateStats = analytics.templateCounters;
    current.replyAnalytics = analytics.metrics;

    current.messageWindow = trimMessageWindow(current.messageWindow || []);
    current.recentMessageHashes = trimRecentHashes(current.recentMessageHashes || []);
    current.skills.messaging = {
      ...current.skills.messaging,
      enabled: messagingPolicy.enabled,
      policyMode: messagingPolicy.policyMode,
      activePolicy: messagingPolicy.activePolicy,
      lastOutcome:
        inboxResult.ok && queueResults.every(result => result.ok || result.skipped)
          ? 'completed'
          : inboxResult.ok
          ? 'partial'
          : 'failed',
      lastSuccessAt: inboxResult.ok ? nowIso : current.skills.messaging.lastSuccessAt,
      lastFailureAt:
        inboxResult.ok && queueResults.every(result => result.ok || result.skipped)
          ? current.skills.messaging.lastFailureAt
          : nowIso,
      lastSkipReason:
        statusOnly
          ? 'status_only'
          : payRequired && queueResults.every(result => result.reason === 'payment_blocked_by_policy')
          ? 'payment_blocked_by_policy'
          : replyPending && replyResult.skipped && replyResult.reason === 'no_reply_candidate'
          ? 'no_pending_messages'
          : replyPending &&
            (replyResult.results || []).length > 0 &&
            (replyResult.results || []).every(entry => entry.skipped)
          ? (replyResult.results || []).map(entry => entry.reason).filter(Boolean)[0] || 'reply_skipped_by_rule'
          : outboundBlockedByPolicy
          ? 'safe_replies_only_outbound_blocked'
          : queueResults.length === 0 && !replyPending
          ? 'no_queue_items_processed'
          : null,
      lastActionType:
        payRequired && queueResults.some(result => result.action === 'pay_and_send_inbox_message')
          ? 'payment'
          : replyPending
          ? 'reply'
          : outboundBlockedByPolicy || queueResults.length > 0
          ? 'outbound'
          : 'status',
      lastActionResult:
        payRequired && queueResults.some(result => result.payment?.txId)
          ? 'payment_executed'
          : payRequired && queueResults.some(result => result.reason === 'approve_live_missing')
          ? 'approve_live_missing'
          : payRequired && queueResults.some(result => result.reason === 'payment_blocked_by_policy')
          ? 'payment_blocked_by_policy'
          : replyPending && !replyResult.skipped
          ? 'reply_executed'
          : replyPending && replyResult.skipped
          ? replyResult.reason || 'reply_skipped'
          : outboundBlockedByPolicy
          ? 'outbound_blocked_by_policy'
          : queueResults.some(result => !result.skipped)
          ? 'outbound_processed'
          : 'status_completed',
      lastPaymentTxId:
        queueResults.find(result => result.payment?.txId)?.payment?.txId ||
        current.skills.messaging.lastPaymentTxId ||
        null,
    };
    return current;
  });

  const payload = {
    ok: inboxResult.ok,
    skill: 'messaging',
    dryRun,
    statusOnly,
    payRequired,
    maxPayments,
    featureEnabled: messagingPolicy.enabled,
    policyMode: messagingPolicy.policyMode,
    activePolicy: messagingPolicy.activePolicy,
    inbox: sanitizeValue(inboxResult),
    outbox: sanitizeValue(outboxResult),
    seededQueueItems: sanitizeValue([...manualSeed, ...allowlistSeed]),
    queueResults: sanitizeValue(queueResults),
    replyResult: sanitizeValue(replyResult),
    state: finalState,
  };

  writeAgentStatus({
    checkedAt: nowIso,
    messaging: {
      unreadCount: finalState.unreadCount,
      queueDepth: finalState.outboundQueue.length,
      lastMessagingRunAt: finalState.lastMessagingRunAt,
      lastReplyAt: finalState.lastReplyAt,
      lastReplyTargets: finalState.lastReplyTargets,
      policyMode: finalState.skills.messaging.policyMode,
      activePolicy: finalState.skills.messaging.activePolicy,
      lastActionType: finalState.skills.messaging.lastActionType,
      lastActionResult: finalState.skills.messaging.lastActionResult,
      lastPaymentTxId: finalState.skills.messaging.lastPaymentTxId,
      experimental: config.messaging.experimentalEnabled,
      replyTemplateStats: finalState.replyTemplateStats,
      replySuccessRate: finalState.replyAnalytics?.successRate ?? 0,
      detectedAchievements: finalState.replyAnalytics?.achievementsDetected || [],
      lastOutcome: finalState.skills.messaging.lastOutcome,
    },
  });

  appendJsonLog('messaging_skill_completed', {
    ok: payload.ok,
    dryRun,
    payRequired,
    featureEnabled: messagingPolicy.enabled,
    policyMode: messagingPolicy.policyMode,
    activePolicy: messagingPolicy.activePolicy,
    unreadCount: finalState.unreadCount,
    queueDepth: finalState.outboundQueue.length,
    queueResults: sanitizeValue(queueResults),
    replyResult: sanitizeValue(replyResult),
    replyAnalytics: sanitizeValue(finalState.replyAnalytics),
    replyTemplateStats: sanitizeValue(finalState.replyTemplateStats),
    lastPaymentTxId: finalState.skills.messaging.lastPaymentTxId,
    skipReason: finalState.skills.messaging.lastSkipReason,
  });

  return payload;
}

module.exports = {
  runMessagingSkill,
  resolveMessagingPolicy,
  canReplyToTarget,
  executeManualReplyCandidate,
  __test: {
    resolveMessagingPolicy,
    selectReplyCandidates,
    executeManualReplyCandidate,
  },
};
