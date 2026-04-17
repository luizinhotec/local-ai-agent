const fs = require('fs');
const { spawnSync } = require('child_process');
const { loadAgentConfig } = require('./agent-config.cjs');
const {
  ACTIVE_HELPER_SCRIPT_PATH,
  ACTIVE_HEARTBEAT_CLI_PATH,
  ACTIVE_OPS_SUMMARY_PATH,
} = require('./agent-paths.cjs');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseJsonOutput(raw) {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const matches = trimmed.match(/\{[\s\S]*\}/g);
    if (!matches) {
      return null;
    }
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(matches[index]);
      } catch {
        // keep scanning
      }
    }
  }
  return null;
}

function redactSensitiveValue(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value ? '[REDACTED]' : value;
}

function sanitizeHeartbeatPayload(value) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeHeartbeatPayload(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      ['walletPassword', 'mnemonic', 'AIBTC_WALLET_PASSWORD', 'CLIENT_MNEMONIC', 'signature'].includes(
        key
      )
    ) {
      sanitized[key] = redactSensitiveValue(item);
      continue;
    }
    sanitized[key] = sanitizeHeartbeatPayload(item);
  }
  return sanitized;
}

function sanitizeHeartbeatResult(result) {
  return {
    ok: result.ok,
    status: result.status,
    stdout: result.stdout ? '[captured]' : '',
    stderr: result.stderr || '',
    parsed: sanitizeHeartbeatPayload(result.parsed),
  };
}

function ensureHelper(config = loadAgentConfig()) {
  if (!config.heartbeat.helperEnsureEnabled) {
    return {
      ok: true,
      skipped: true,
      reason: 'helper_ensure_disabled',
    };
  }
  if (process.platform !== 'win32') {
    return {
      ok: true,
      skipped: true,
      reason: 'helper_ensure_not_supported_on_platform',
    };
  }
  const result = spawnSync(
    'powershell',
    [
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      ACTIVE_HELPER_SCRIPT_PATH,
      '-Port',
      String(config.helperPort),
    ],
    {
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    }
  );
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runHeartbeatCli(args = []) {
  const result = spawnSync('node', [ACTIVE_HEARTBEAT_CLI_PATH, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      AIBTC_WALLET_PASSWORD: process.env.AIBTC_WALLET_PASSWORD,
      AIBTC_WALLET_NAME: process.env.AIBTC_WALLET_NAME,
    },
    windowsHide: true,
  });
  const parsed =
    parseJsonOutput(result.stdout) ||
    parseJsonOutput(result.stderr) ||
    parseJsonOutput(`${result.stdout || ''}\n${result.stderr || ''}`);
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed,
  };
}

function loadActiveOpsSummary() {
  if (!fs.existsSync(ACTIVE_OPS_SUMMARY_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(ACTIVE_OPS_SUMMARY_PATH, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  sleep,
  ensureHelper,
  runHeartbeatCli,
  loadActiveOpsSummary,
  sanitizeHeartbeatResult,
};
