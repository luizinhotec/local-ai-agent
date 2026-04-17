const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ENV_FILES = [
  path.join(ROOT, '.env'),
  path.join(ROOT, '.env.local'),
];

function stripWrappingQuotes(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseDotEnv(content) {
  const parsed = {};
  const lines = String(content || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key) continue;
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1));
    if (value === undefined) continue;
    parsed[key] = value;
  }
  return parsed;
}

function applyEnvValues(values) {
  for (const [key, value] of Object.entries(values || {})) {
    if (value === undefined) continue;
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function loadRuntimeEnv() {
  for (const filePath of ENV_FILES) {
    if (!fs.existsSync(filePath)) continue;
    const parsed = parseDotEnv(fs.readFileSync(filePath, 'utf8'));
    applyEnvValues(parsed);
  }
}

function buildChildEnv(overrides = {}) {
  const merged = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

module.exports = {
  loadRuntimeEnv,
  buildChildEnv,
};
