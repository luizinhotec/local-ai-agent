const fs = require('fs');
const path = require('path');

const DEFAULT_AGENT_NAME = 'Speedy Indra';
const DEFAULT_BTC_ADDRESS = 'bc1q7maxug87p9ul7cl8yvmv6za8aqxfpfea0h6tc9';
const DEFAULT_STX_ADDRESS = 'SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT';

let envLoaded = false;

function stripOuterQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1);
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = stripOuterQuotes(rawValue.trim());
  }
}

function ensureLocalEnvLoaded() {
  if (envLoaded) {
    return;
  }
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  loadDotEnvFile(path.join(rootDir, '.env'));
  loadDotEnvFile(path.join(rootDir, '.env.local'));
  envLoaded = true;
}

function readBooleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function readNumberEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readCsvEnv(name) {
  const value = process.env[name];
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function readJsonEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function loadAgentConfig() {
  ensureLocalEnvLoaded();
  const dryRunDefault = readBooleanEnv('DRY_RUN_DEFAULT', true);
  const messagingDryRunDefault = readBooleanEnv('MESSAGE_DRY_RUN_DEFAULT', dryRunDefault);
  return {
    agentName: process.env.AGENT_NAME || DEFAULT_AGENT_NAME,
    btcAddress:
      process.env.AIBTC_HEARTBEAT_BTC_ADDRESS ||
      process.env.AIBTC_BTC_ADDRESS ||
      DEFAULT_BTC_ADDRESS,
    stxAddress:
      process.env.AIBTC_HEARTBEAT_STX_ADDRESS ||
      process.env.AIBTC_STX_ADDRESS ||
      DEFAULT_STX_ADDRESS,
    helperPort: readNumberEnv('AIBTC_HELPER_PORT', 8765),
    featureFlags: {
      heartbeat: readBooleanEnv('ENABLE_HEARTBEAT', true),
      messaging: readBooleanEnv('ENABLE_MESSAGING', false),
      messagingSafeRepliesOnly: readBooleanEnv('ENABLE_MESSAGING_SAFE_REPLIES_ONLY', true),
      messagingFullOutbound: readBooleanEnv('ENABLE_MESSAGING_FULL_OUTBOUND', false),
      identity: readBooleanEnv('ENABLE_IDENTITY', false),
      walletActions: readBooleanEnv('ENABLE_WALLET_ACTIONS', false),
      defiSimple: readBooleanEnv('ENABLE_DEFI_SIMPLE', false),
      btcL1ToUsdcx: readBooleanEnv('ENABLE_BTC_L1_TO_USDCX', false),
      blsm: readBooleanEnv('ENABLE_BLSM', true),
    },
    safety: {
      dryRunDefault,
      requireApprovalForValueActions: readBooleanEnv(
        'REQUIRE_APPROVAL_FOR_VALUE_ACTIONS',
        true
      ),
      maxTxValueSats: readNumberEnv('MAX_TX_VALUE_SATS', 1000),
      maxMessagesPerHour: readNumberEnv('MAX_MESSAGES_PER_HOUR', 4),
      allowedAssets: readCsvEnv('ALLOWED_ASSETS'),
      targetAllowlist: readCsvEnv('AGENT_TARGET_ALLOWLIST'),
    },
    heartbeat: {
      intervalSec: readNumberEnv('HEARTBEAT_INTERVAL_SEC', 300),
      minWindowSec: readNumberEnv('HEARTBEAT_INTERVAL_SEC', 300),
      retryMaxAttempts: readNumberEnv('HEARTBEAT_RETRY_MAX_ATTEMPTS', 3),
      retryBaseDelayMs: readNumberEnv('HEARTBEAT_RETRY_BASE_DELAY_MS', 3000),
      retryMaxDelayMs: readNumberEnv('HEARTBEAT_RETRY_MAX_DELAY_MS', 30000),
      circuitBreakerFailures: readNumberEnv('HEARTBEAT_CIRCUIT_BREAKER_FAILURES', 5),
      circuitBreakerCooldownSec: readNumberEnv('HEARTBEAT_CIRCUIT_BREAKER_COOLDOWN_SEC', 900),
      watchdogStaleSec: readNumberEnv('WATCHDOG_STALE_SEC', 600),
      loopSleepSec: readNumberEnv('AGENT_LOOP_INTERVAL_SEC', 30),
      helperEnsureEnabled: readBooleanEnv('HEARTBEAT_ENSURE_HELPER', true),
    },
    messaging: {
      cooldownMin: readNumberEnv('MESSAGE_COOLDOWN_MIN', 60),
      maxMessagesPerCycle: readNumberEnv('MAX_MESSAGES_PER_CYCLE', 1),
      maxRepliesPerCycle: readNumberEnv('MAX_REPLIES_PER_CYCLE', 1),
      maxPaymentsPerCycle: readNumberEnv('MAX_PAYMENTS_PER_CYCLE', 1),
      dryRunDefault: messagingDryRunDefault,
      inboxFetchLimit: readNumberEnv('MESSAGE_INBOX_FETCH_LIMIT', 10),
      paymentSatoshis: readNumberEnv('MESSAGE_PAYMENT_SATS', 100),
      maxPaymentSats: readNumberEnv(
        'MESSAGE_MAX_PAYMENT_SATS',
        readNumberEnv('MAX_TX_VALUE_SATS', 1000)
      ),
      autoReplyEnabled: readBooleanEnv('ENABLE_AUTO_REPLY_PENDING', false),
      experimentalEnabled: readBooleanEnv('ENABLE_MESSAGING_EXPERIMENTAL', false),
      safeRepliesOnly: readBooleanEnv('ENABLE_MESSAGING_SAFE_REPLIES_ONLY', true),
      fullOutboundEnabled: readBooleanEnv('ENABLE_MESSAGING_FULL_OUTBOUND', false),
    },
    walletActions: {
      dryRunDefault: readBooleanEnv('WALLET_ACTIONS_DRY_RUN_DEFAULT', dryRunDefault),
      requireApprovalForLive: readBooleanEnv('REQUIRE_APPROVAL_FOR_WALLET_LIVE', true),
      maxValueSats: readNumberEnv('WALLET_MAX_VALUE_SATS', 1000),
      microAmountUstx: readNumberEnv('WALLET_MICRO_AMOUNT_USTX', 1000),
      microMaxFeeUstx: readNumberEnv('WALLET_MICRO_MAX_FEE_USTX', 3000),
      microTargetAddress: process.env.WALLET_MICRO_TARGET_ADDRESS || '',
      autoCheckEnabled: readBooleanEnv('ENABLE_AUTO_WALLET_CHECK', false),
    },
    defiSimple: {
      dryRunDefault: readBooleanEnv('DEFI_SIMPLE_DRY_RUN_DEFAULT', dryRunDefault),
      requireApprovalForLive: readBooleanEnv('REQUIRE_APPROVAL_FOR_DEFI_LIVE', true),
      maxInputSats: readNumberEnv('DEFI_SIMPLE_MAX_INPUT_SATS', 10000),
      allowedPairs: readCsvEnv('DEFI_SIMPLE_ALLOWED_PAIRS'),
      maxSlippageBps: readNumberEnv('DEFI_SIMPLE_MAX_SLIPPAGE_BPS', 300),
      maxFeeSats: readNumberEnv('DEFI_SIMPLE_MAX_FEE_SATS', 500),
      autoCheckEnabled: readBooleanEnv('ENABLE_AUTO_DEFI_CHECK', false),
    },
    routeEvaluator: {
      policyDefaults: {
        decision: {
          minOutputRatio: readNumberEnv('SPEEDY_DECISION_MIN_OUTPUT_RATIO', 0.97),
          maxEstimatedFeeSats: readNumberEnv('SPEEDY_DECISION_MAX_FEE_SATS', 500),
          maxFeePerByte: readNumberEnv('SPEEDY_DECISION_MAX_FEE_PER_BYTE', 1000),
          maxRouteHops: readNumberEnv('SPEEDY_DECISION_MAX_ROUTE_HOPS', 2),
          minExpectedNetUsd: readNumberEnv('SPEEDY_DECISION_MIN_EXPECTED_NET_USD', 0.10),
          minWorstCaseNetUsd: readNumberEnv('SPEEDY_DECISION_MIN_WORST_CASE_NET_USD', 0),
        },
        watchGate: {
          maxEstimatedFeeSats: readNumberEnv('SPEEDY_WATCH_GATE_MAX_FEE_SATS', 200),
          maxPriceImpactBps: readNumberEnv('SPEEDY_WATCH_GATE_MAX_PRICE_IMPACT_BPS', 40),
          maxAmountSats: readNumberEnv('SPEEDY_WATCH_GATE_MAX_AMOUNT_SATS', 2000),
        },
        championshipGate: {
          maxEstimatedFeeSats: readNumberEnv('SPEEDY_CHAMPIONSHIP_MAX_FEE_SATS', 300),
          maxPriceImpactBps: readNumberEnv('SPEEDY_CHAMPIONSHIP_MAX_PRICE_IMPACT_BPS', 50),
        },
      },
      policyOverrides: readJsonEnv('SPEEDY_ROUTE_POLICY_OVERRIDES', {}),
    },
    btcL1ToUsdcx: {
      defaultRoute: process.env.BTC_L1_TO_USDCX_DEFAULT_ROUTE || '',
      requireApprovalForLive: readBooleanEnv('REQUIRE_APPROVAL_FOR_BTC_L1_TO_USDCX_LIVE', true),
      maxSats: readNumberEnv('BTC_L1_TO_USDCX_MAX_SATS', 100000),
      allowedRoutes: readCsvEnv('BTC_L1_TO_USDCX_ALLOWED_ROUTES'),
      dryRunDefault: readBooleanEnv('BTC_L1_TO_USDCX_DRY_RUN_DEFAULT', dryRunDefault),
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      authorizedUserId: process.env.TELEGRAM_ALLOWED_USER_ID || '',
      execTimeoutSec: readNumberEnv('TELEGRAM_EXEC_TIMEOUT_SEC', 60),
      execPollingIntervalSec: readNumberEnv('TELEGRAM_EXEC_POLL_INTERVAL_SEC', 5),
      remoteExecPilotEnabled: readBooleanEnv('REMOTE_EXEC_PILOT_ENABLED', false),
    },
  };
}

module.exports = {
  loadAgentConfig,
};
