#!/usr/bin/env node
'use strict';

/**
 * ORION — Supervisor Central
 *
 * Loop principal:
 *   - Lê estado de todos os bots a cada loopIntervalSec (padrão 60s)
 *   - Avalia saúde via orion-health.cjs
 *   - Envia alertas críticos no Telegram (cooldown por chave)
 *   - Faz polling de comandos Telegram a cada POLL_INTERVAL_MS
 *
 * Uso:
 *   node runtime/orion/orion.cjs [--once] [--dry-run]
 *
 * --once     executa um único ciclo de status check e sai
 * --dry-run  não envia mensagens Telegram, apenas loga no console
 */

const { loadOrionConfig }    = require('./lib/orion-config.cjs');
const { readAllBotStates }   = require('./lib/orion-state-reader.cjs');
const { checkHealth, summarizeHealth } = require('./lib/orion-health.cjs');
const {
  sendMessage,
  fetchUpdates,
  handleCommand,
  isAuthorized,
} = require('./lib/orion-telegram.cjs');

// ── CLI flags ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const ONCE    = argv.includes('--once');
const DRY_RUN = argv.includes('--dry-run');

const POLL_INTERVAL_MS = 5_000;   // Telegram polling interval

// ── alert cooldown ────────────────────────────────────────────────────────────

const _alertCooldowns = new Map();

function canAlert(key, cooldownMs) {
  const last = _alertCooldowns.get(key);
  return !last || Date.now() - last > cooldownMs;
}

function markAlerted(key) {
  _alertCooldowns.set(key, Date.now());
}

// ── logging ───────────────────────────────────────────────────────────────────

function log(level, msg) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] [ORION] [${level}] ${msg}\n`);
}

// ── Telegram send (respects --dry-run) ────────────────────────────────────────

async function tgSend(text, config) {
  if (DRY_RUN) {
    log('DRY', `would send:\n${text}`);
    return { ok: true, dryRun: true };
  }
  return sendMessage(text, config);
}

// ── health check + alerts ─────────────────────────────────────────────────────

async function runHealthCheck(config) {
  let states;
  try {
    states = readAllBotStates();
  } catch (err) {
    log('ERROR', `readAllBotStates failed: ${err.message}`);
    return null;
  }

  let health;
  try {
    health = checkHealth(states, config);
  } catch (err) {
    log('ERROR', `checkHealth failed: ${err.message}`);
    return null;
  }

  log('INFO', summarizeHealth(health));

  if (health.overall === 'ok') {
    return { states, health };
  }

  const cooldownMs = (config.health.alertCooldownMinutes || 30) * 60_000;

  for (const alert of health.alerts) {
    const key = alert.slice(0, 80);
    if (!canAlert(key, cooldownMs)) continue;

    const text = `🚨 ORION ALERTA\n${alert}`;
    const result = await tgSend(text, config);
    if (result.ok) {
      markAlerted(key);
      log('ALERT', `sent: ${alert}`);
    } else {
      log('WARN', `alert send failed: ${result.reason || 'unknown'}`);
    }
  }

  return { states, health };
}

// ── Telegram command polling ──────────────────────────────────────────────────

let _lastUpdateId = 0;
let _cachedHealth = null;
let _cachedStates = null;

async function pollCommands(config) {
  const { ok, updates, nextUpdateId, reason } = await fetchUpdates(_lastUpdateId, config);

  if (!ok) {
    if (reason !== 'no_bot_token') {
      log('WARN', `fetchUpdates failed: ${reason}`);
    }
    return;
  }

  _lastUpdateId = nextUpdateId;

  for (const update of updates) {
    const msg = update.message;
    if (!msg) continue;

    const text = (msg.text || '').trim();
    if (!text.startsWith('/')) continue;

    if (!isAuthorized(msg, config)) {
      log('WARN', `unauthorized command from chat=${msg.chat?.id} user=${msg.from?.id}: ${text}`);
      continue;
    }

    log('CMD', `received: ${text}`);

    // If we have no fresh health snapshot, do a quick read
    if (!_cachedHealth || !_cachedStates) {
      try {
        _cachedStates = readAllBotStates();
        _cachedHealth = checkHealth(_cachedStates, config);
      } catch (err) {
        log('ERROR', `on-demand state read failed: ${err.message}`);
        await tgSend(`Erro ao ler estado dos bots: ${err.message}`, config);
        continue;
      }
    }

    let reply;
    try {
      reply = await handleCommand(text, _cachedHealth, _cachedStates);
    } catch (err) {
      reply = `Erro ao processar comando: ${err.message}`;
    }

    const result = await tgSend(reply, config);
    if (!result.ok) {
      log('WARN', `reply send failed: ${result.reason}`);
    }
  }
}

// ── exported test helper ──────────────────────────────────────────────────────

async function simulateCriticalAlert(bot, message) {
  const config = loadOrionConfig();
  const text = `🚨 ORION ALERTA SIMULADO\nBot: ${bot}\n${message}`;
  log('SIM', text);
  return tgSend(text, config);
}

// ── main loop ─────────────────────────────────────────────────────────────────

async function main() {
  const config = loadOrionConfig();

  log('INFO', `ORION iniciado${DRY_RUN ? ' [dry-run]' : ''}${ONCE ? ' [once]' : ''}`);
  log('INFO', `loop=${config.health.loopIntervalSec}s | stale=${config.health.staleThresholdMinutes}min | cooldown=${config.health.alertCooldownMinutes}min`);

  let lastCheck = 0;
  const checkIntervalMs = config.health.loopIntervalSec * 1_000;

  // Run once and exit
  if (ONCE) {
    const result = await runHealthCheck(config);
    if (result) {
      _cachedHealth = result.health;
      _cachedStates = result.states;
    }
    return;
  }

  // Main loop
  while (true) {
    const now = Date.now();

    // Health check on interval
    if (now - lastCheck >= checkIntervalMs) {
      const result = await runHealthCheck(config);
      if (result) {
        _cachedHealth = result.health;
        _cachedStates = result.states;
      }
      lastCheck = now;
    }

    // Poll Telegram commands
    try {
      await pollCommands(config);
    } catch (err) {
      log('ERROR', `pollCommands: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ── graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  log('INFO', `received ${signal} — shutting down`);
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', err => {
  log('FATAL', `uncaughtException: ${err.message}\n${err.stack}`);
  // Intentionally do NOT exit — keep the supervisor alive
});

process.on('unhandledRejection', (reason) => {
  log('FATAL', `unhandledRejection: ${reason}`);
});

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = { simulateCriticalAlert };

if (require.main === module) {
  main().catch(err => {
    log('FATAL', `main crash: ${err.message}`);
    process.exit(1);
  });
}
