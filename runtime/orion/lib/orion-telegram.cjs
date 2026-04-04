'use strict';

/**
 * orion-telegram.cjs
 *
 * Low-level Telegram I/O + command dispatcher for ORION.
 *
 * Exports:
 *   sendMessage(text, config)           -> { ok, messageId?, reason? }
 *   fetchUpdates(lastUpdateId, config)  -> { ok, updates[], nextUpdateId }
 *   handleCommand(text, health, states) -> string (reply text)
 */

const { loadOrionConfig } = require('./orion-config.cjs');
const {
  formatStatus,
  formatReport,
  formatSpeedy,
  formatDeribitDetailed,
  formatDog,
  formatHelp,
} = require('./orion-report.cjs');

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function telegramPost(endpoint, payload, botToken) {
  const url = `https://api.telegram.org/bot${botToken}/${endpoint}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    return {
      ok: Boolean(response.ok && body?.ok),
      status: response.status,
      body,
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ── sendMessage ───────────────────────────────────────────────────────────────

async function sendMessage(text, config) {
  const cfg = config || loadOrionConfig();
  const { botToken, chatId } = cfg.telegram;

  if (!botToken || !chatId) {
    return { ok: false, reason: 'telegram_config_missing' };
  }

  // Telegram max message length is 4096 chars; truncate if needed
  const safeText = text.length > 4000
    ? text.slice(0, 3960) + '\n...[truncado]'
    : text;

  const result = await telegramPost('sendMessage', { chat_id: chatId, text: safeText }, botToken);
  return {
    ok: result.ok,
    messageId: result.body?.result?.message_id ?? null,
    reason: result.ok ? null : (result.body?.description || result.reason || 'unknown'),
  };
}

// ── fetchUpdates ──────────────────────────────────────────────────────────────

async function fetchUpdates(lastUpdateId, config) {
  const cfg = config || loadOrionConfig();
  const { botToken } = cfg.telegram;

  if (!botToken) {
    return { ok: false, reason: 'no_bot_token', updates: [], nextUpdateId: lastUpdateId };
  }

  const params = new URLSearchParams();
  params.set('timeout', '0');
  params.set('allowed_updates', JSON.stringify(['message']));
  if (lastUpdateId > 0) {
    params.set('offset', String(lastUpdateId + 1));
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/getUpdates?${params}`;
    const response = await fetch(url);
    const body = await response.json().catch(() => null);

    if (!response.ok || !body?.ok) {
      return {
        ok: false,
        reason: body?.description || `http_${response.status}`,
        updates: [],
        nextUpdateId: lastUpdateId,
      };
    }

    const updates = Array.isArray(body.result) ? body.result : [];
    const nextId = updates.reduce((max, u) => Math.max(max, u.update_id || 0), lastUpdateId);

    return { ok: true, updates, nextUpdateId: nextId };
  } catch (err) {
    return { ok: false, reason: err.message, updates: [], nextUpdateId: lastUpdateId };
  }
}

// ── handleCommand ─────────────────────────────────────────────────────────────

/**
 * @param {string} text        — raw message text (e.g. "/status")
 * @param {object} health      — output of checkHealth()
 * @param {object} states      — output of readAllBotStates()
 * @returns {string}           — reply text to send back
 */
async function handleCommand(text, health, states) {
  const cmd = (text || '').trim().split(/\s+/)[0].toLowerCase();

  try {
    switch (cmd) {
      case '/status':
        return formatStatus(health, states);
      case '/report':
        return formatReport(health, states);
      case '/speedy':
        return formatSpeedy(health, states);
      case '/deribit':
        return formatDeribitDetailed(health, states);
      case '/dog':
        return formatDog(health, states);
      case '/help':
        return formatHelp();
      default:
        return `Comando desconhecido: ${cmd}\nUse /help para ver os comandos disponíveis.`;
    }
  } catch (err) {
    return `Erro ao processar ${cmd}: ${err.message}`;
  }
}

/**
 * Checks if a message is from an authorized sender.
 * Returns true if authorized, false otherwise.
 */
function isAuthorized(message, config) {
  const cfg = config || loadOrionConfig();
  const { chatId, authorizedUserId } = cfg.telegram;

  const msgChatId = String(message?.chat?.id || '');
  const msgFromId = String(message?.from?.id || '');

  if (msgChatId !== chatId) return false;
  if (authorizedUserId && msgFromId !== authorizedUserId) return false;
  return true;
}

module.exports = { sendMessage, fetchUpdates, handleCommand, isAuthorized };
