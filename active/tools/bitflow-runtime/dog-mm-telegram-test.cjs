#!/usr/bin/env node
'use strict';

const { loadRuntimeEnv } = require('./runtime-env.cjs');

async function main() {
  loadRuntimeEnv();

  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  const text = process.argv.slice(2).join(' ') || 'DOG MM Telegram test: runtime notification channel is working.';

  if (!token || !chatId) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID.');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram API error ${response.status}: ${body.slice(0, 300)}`);
  }

  process.stdout.write(`${body}\n`);
}

main().catch((error) => {
  process.stderr.write(`DOG MM Telegram test failed: ${error.message}\n`);
  process.exit(1);
});
