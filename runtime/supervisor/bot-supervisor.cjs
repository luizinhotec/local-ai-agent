'use strict';

const fs = require('fs');
const path = require('path');
const { aggregateStatus } = require('./bot-status-aggregator.cjs');
const { handleCommand, sendTelegramMessage } = require('./telegram-command-handler.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

const CHECK_INTERVAL_MS = 60 * 1000;    // 60s — check bot status
const POLL_INTERVAL_MS = 5 * 1000;      // 5s  — poll Telegram commands
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30min cooldown per alert key

// In-memory cooldown tracker: alertKey -> timestamp of last send
const alertCooldowns = new Map();

function canSendAlert(key) {
  const last = alertCooldowns.get(key);
  return !last || Date.now() - last > ALERT_COOLDOWN_MS;
}

function markAlertSent(key) {
  alertCooldowns.set(key, Date.now());
}

async function checkAndAlert() {
  const status = await aggregateStatus();

  for (const alert of status.alerts) {
    // Use first 60 chars as dedup key
    const key = alert.slice(0, 60);
    if (canSendAlert(key)) {
      const result = await sendTelegramMessage(`🚨 ALERTA CRÍTICO\n${alert}`);
      if (result.ok) {
        markAlertSent(key);
        console.log(`[supervisor] alert sent: ${alert}`);
      } else {
        console.error(`[supervisor] alert failed: ${result.reason || 'unknown'}`);
      }
    }
  }
}

// Simulates a critical alert (for testing)
async function simulateCriticalAlert(bot, message) {
  const text = `🚨 ALERTA CRÍTICO [SIMULADO]\nBot: ${bot}\n${message}`;
  const result = await sendTelegramMessage(text);
  console.log('[supervisor] simulate alert result:', JSON.stringify(result));
  return result;
}

// Telegram command polling
let lastUpdateId = 0;

async function pollTelegramCommands() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  const authorizedUserId = process.env.TELEGRAM_ALLOWED_USER_ID || '';

  if (!botToken || !chatId) return;

  const params = new URLSearchParams();
  params.set('timeout', '0');
  params.set('allowed_updates', JSON.stringify(['message']));
  if (lastUpdateId > 0) params.set('offset', String(lastUpdateId + 1));

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/getUpdates?${params}`
  );
  const body = await response.json().catch(() => null);
  if (!body?.ok) return;

  for (const update of (body.result || [])) {
    if (update.update_id > lastUpdateId) {
      lastUpdateId = update.update_id;
    }

    const msg = update.message;
    if (!msg) continue;

    const msgChatId = String(msg.chat?.id || '');
    const msgFromId = String(msg.from?.id || '');

    if (msgChatId !== chatId) continue;
    if (authorizedUserId && msgFromId !== authorizedUserId) continue;

    const text = (msg.text || '').trim();
    if (!text.startsWith('/')) continue;

    console.log(`[supervisor] command received: ${text}`);
    try {
      const reply = await handleCommand(text);
      await sendTelegramMessage(reply);
    } catch (err) {
      console.error('[supervisor] command handler error:', err.message);
      await sendTelegramMessage(`Erro ao processar comando: ${err.message}`).catch(() => {});
    }
  }
}

async function main() {
  console.log('[supervisor] Bot Supervisor iniciado —', new Date().toISOString());

  let lastStatusCheck = 0;

  while (true) {
    try {
      await pollTelegramCommands();
    } catch (err) {
      console.error('[supervisor] poll error:', err.message);
    }

    const now = Date.now();
    if (now - lastStatusCheck >= CHECK_INTERVAL_MS) {
      try {
        await checkAndAlert();
        lastStatusCheck = now;
      } catch (err) {
        console.error('[supervisor] status check error:', err.message);
      }
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

module.exports = { simulateCriticalAlert };

if (require.main === module) {
  main().catch(err => {
    console.error('[supervisor] Fatal:', err.message);
    process.exit(1);
  });
}
