'use strict';

const fs = require('fs');
const path = require('path');

// Two levels up from runtime/orion/lib/ -> project root
const ROOT = path.resolve(__dirname, '..', '..', '..');

let _loaded = false;

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, '');
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const sep = trimmed.indexOf('=');
      if (sep <= 0) continue;
      const key = trimmed.slice(0, sep).trim();
      const raw = trimmed.slice(sep + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = stripQuotes(raw);
      }
    }
  } catch (_) {}
}

function ensureEnvLoaded() {
  if (_loaded) return;
  loadEnvFile(path.join(ROOT, '.env'));
  loadEnvFile(path.join(ROOT, '.env.local'));
  _loaded = true;
}

function readBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function readInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadOrionConfig() {
  ensureEnvLoaded();
  return {
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      authorizedUserId: process.env.TELEGRAM_ALLOWED_USER_ID || '',
    },
    paths: {
      // All relative to project root — resolved at use-time
      speedyState: 'state/speedy-indra',
      deribitState: 'workspace/deribit/state',
      dogmmState: 'active/state/dog-mm',
      logsDir: 'logs',
    },
    health: {
      staleThresholdMinutes: readInt('ORION_STALE_THRESHOLD_MIN', 10),
      loopIntervalSec: readInt('ORION_LOOP_INTERVAL_SEC', 60),
      alertCooldownMinutes: readInt('ORION_ALERT_COOLDOWN_MIN', 30),
    },
    orion: {
      stateDir: path.join(__dirname, '..', 'state'),
      root: ROOT,
    },
  };
}

module.exports = { loadOrionConfig, ROOT };
