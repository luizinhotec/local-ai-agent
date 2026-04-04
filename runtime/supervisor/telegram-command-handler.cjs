'use strict';

const fs = require('fs');
const path = require('path');
const { aggregateStatus } = require('./bot-status-aggregator.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

// Simple .env loader — reads KEY=VALUE lines from .env and .env.local
function loadEnvFiles() {
  const files = [path.join(ROOT, '.env'), path.join(ROOT, '.env.local')];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const sep = trimmed.indexOf('=');
      if (sep <= 0) continue;
      const key = trimmed.slice(0, sep).trim();
      const val = trimmed.slice(sep + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

loadEnvFiles();

function getConfig() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  };
}

async function sendTelegramMessage(text) {
  const { botToken, chatId } = getConfig();
  if (!botToken || !chatId) {
    return { ok: false, reason: 'telegram_config_missing' };
  }
  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const body = await response.json().catch(() => null);
    return { ok: Boolean(response.ok && body?.ok), body };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

const STATUS_ICONS = { ok: '✅', warn: '⚠️', critical: '🚨', unknown: '❓' };

function icon(s) {
  return STATUS_ICONS[s] || '❓';
}

function formatStatus(agg) {
  const dog = agg.bots.dog_mm;
  const deribit = agg.bots.deribit;
  const ts = new Date(agg.timestamp).toISOString().slice(0, 19) + ' UTC';

  const lines = [
    `${icon(agg.overall)} Supervisor — ${agg.overall.toUpperCase()}`,
    ts,
    '',
    `DOG MM: ${icon(dog.status)} ${dog.stage} | funded: ${dog.funded} | ${dog.minutes_since_activity ?? '?'}min atrás`,
    `Deribit: ${icon(deribit.status)} ${deribit.environment} | pos: $${deribit.position_usd ?? 0} | ${deribit.minutes_since_cycle ?? '?'}min atrás`,
  ];

  if (agg.alerts.length > 0) {
    lines.push('', 'Alertas:');
    agg.alerts.forEach(a => lines.push(`  ⚠️ ${a}`));
  }

  return lines.join('\n');
}

function formatReport(agg) {
  const dog = agg.bots.dog_mm;
  const deribit = agg.bots.deribit;
  const ts = new Date(agg.timestamp).toISOString().slice(0, 19) + ' UTC';

  const lines = [
    '📋 Relatório Completo — Supervisor',
    `🕐 ${ts}`,
    `Status Geral: ${agg.overall.toUpperCase()}`,
    '',
    '── DOG MM ──',
    `Stage: ${dog.stage}`,
    `Funded: ${dog.funded}`,
    `Status: ${dog.status}`,
    `Última atividade: ${dog.last_activity ? dog.last_activity.slice(0, 19) + ' UTC' : 'N/A'}`,
    `Min desde atividade: ${dog.minutes_since_activity ?? 'N/A'}`,
    `Mercado favorável: ${dog.market_favorable ?? 'N/A'}`,
    `Arquivo: ${dog.last_snapshot_file || 'N/A'}`,
    '',
    '── Deribit ──',
    `Ambiente: ${deribit.environment}`,
    `Posição: $${deribit.position_usd ?? 0} (${deribit.position_direction})`,
    `PnL flutuante: ${deribit.pnl_btc ?? 0} BTC`,
    `Ordens abertas: ${deribit.open_orders ?? 0}`,
    `Ciclos: ${deribit.cycle_count ?? 'N/A'}`,
    `Último ciclo: ${deribit.last_cycle ? deribit.last_cycle.slice(0, 19) + ' UTC' : 'N/A'}`,
    `Min desde ciclo: ${deribit.minutes_since_cycle ?? 'N/A'}`,
    `Último action: ${deribit.last_action || 'N/A'}`,
  ];

  if (agg.alerts.length > 0) {
    lines.push('', '🚨 Alertas Ativos:');
    agg.alerts.forEach(a => lines.push(`  - ${a}`));
  }

  return lines.join('\n');
}

function formatDog(dog) {
  const lines = [
    '🐕 DOG MM — Status Detalhado',
    `Stage: ${dog.stage}`,
    `Funded: ${dog.funded}`,
    `Status: ${dog.status}`,
    `Última atividade: ${dog.last_activity ? dog.last_activity.slice(0, 19) + ' UTC' : 'N/A'}`,
    `Min desde atividade: ${dog.minutes_since_activity ?? 'N/A'}`,
    `Mercado favorável: ${dog.market_favorable ?? 'N/A'}`,
    `Arquivo: ${dog.last_snapshot_file || 'N/A'}`,
  ];
  return lines.join('\n');
}

function formatDeribit(deribit) {
  const lines = [
    '📈 Deribit — Status Detalhado',
    `Ambiente: ${deribit.environment}`,
    `Status: ${deribit.status}`,
    `Posição: $${deribit.position_usd ?? 0} (${deribit.position_direction})`,
    `PnL flutuante: ${deribit.pnl_btc ?? 0} BTC`,
    `Ordens abertas: ${deribit.open_orders ?? 0}`,
    `Ciclos: ${deribit.cycle_count ?? 'N/A'}`,
    `Último ciclo: ${deribit.last_cycle ? deribit.last_cycle.slice(0, 19) + ' UTC' : 'N/A'}`,
    `Min desde ciclo: ${deribit.minutes_since_cycle ?? 'N/A'}`,
    `Último action: ${deribit.last_action || 'N/A'}`,
  ];
  if (deribit.last_log_lines && deribit.last_log_lines.length > 0) {
    lines.push('', 'Últimas linhas do log:');
    deribit.last_log_lines.forEach(l => lines.push(`  ${l}`));
  }
  return lines.join('\n');
}

async function handleCommand(text) {
  const cmd = (text || '').trim().split(/\s+/)[0].toLowerCase();

  if (cmd === '/help') {
    return [
      '📟 Comandos disponíveis:',
      '/status — resumo de todos os bots',
      '/report — relatório completo',
      '/dog — status detalhado DOG MM',
      '/deribit — status detalhado Deribit',
      '/stop_deribit — para o loop do Deribit (requer confirmação)',
      '/help — lista de comandos',
    ].join('\n');
  }

  if (cmd === '/stop_deribit') {
    return '⚠️ Para confirmar, envie: /stop_deribit_confirm\nIsto irá parar o loop do Deribit.';
  }

  if (cmd === '/stop_deribit_confirm') {
    const stopFile = path.join(ROOT, 'workspace', 'deribit', 'state', 'deribit-stop-signal.json');
    fs.writeFileSync(stopFile, JSON.stringify({
      stopRequestedAt: new Date().toISOString(),
      source: 'telegram_supervisor',
    }, null, 2));
    return '🛑 Sinal de parada enviado ao Deribit. Verifique o bot.';
  }

  const agg = await aggregateStatus();

  if (cmd === '/status') return formatStatus(agg);
  if (cmd === '/report') return formatReport(agg);
  if (cmd === '/dog') return formatDog(agg.bots.dog_mm);
  if (cmd === '/deribit') return formatDeribit(agg.bots.deribit);

  return `Comando desconhecido: ${cmd}\nUse /help para ver os comandos disponíveis.`;
}

module.exports = { handleCommand, sendTelegramMessage };

// CLI test: node telegram-command-handler.cjs /status
if (require.main === module) {
  const cmd = process.argv[2] || '/status';
  handleCommand(cmd).then(msg => {
    console.log(msg);
  }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
