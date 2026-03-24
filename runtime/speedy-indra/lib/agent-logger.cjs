const fs = require('fs');
const { LOG_DIR, AGENT_LOG_PATH } = require('./agent-paths.cjs');
const { ensureDir } = require('./agent-state.cjs');

function appendJsonLog(type, payload = {}) {
  ensureDir(LOG_DIR);
  const record = {
    recordedAt: new Date().toISOString(),
    type,
    ...payload,
  };
  fs.appendFileSync(AGENT_LOG_PATH, `${JSON.stringify(record)}\n`);
  return record;
}

function sanitizeLogValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeLogValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (['signature', 'walletPassword', 'mnemonic'].includes(key)) {
      sanitized[key] = item ? '[REDACTED]' : item;
      continue;
    }
    sanitized[key] = sanitizeLogValue(item);
  }
  return sanitized;
}

function readTail(limit = 20) {
  if (!fs.existsSync(AGENT_LOG_PATH)) {
    return [];
  }
  const lines = fs
    .readFileSync(AGENT_LOG_PATH, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);
  return lines.slice(-limit).map(line => {
    try {
      return sanitizeLogValue(JSON.parse(line));
    } catch {
      return { type: 'unparseable_log_line', raw: line };
    }
  });
}

module.exports = {
  appendJsonLog,
  readTail,
};
