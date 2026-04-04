'use strict';

/**
 * orion-report.cjs
 *
 * Formats human-readable Telegram messages from health + state data.
 *
 * All formatters accept { health, states } and return a plain string.
 */

const STATUS_ICON = { ok: '✅', warn: '⚠️', critical: '🚨', unknown: '❓' };

function icon(s) {
  return STATUS_ICON[s] || '❓';
}

function ts(isoString) {
  if (!isoString) return 'N/A';
  return isoString.replace('T', ' ').slice(0, 19) + ' UTC';
}

function minsAgo(n) {
  if (n === null || n === undefined) return '?min';
  if (n < 2) return 'agora';
  return `${n}min atrás`;
}

// ── /status (short) ───────────────────────────────────────────────────────────

function formatStatus(health, states) {
  const now = ts(health.checkedAt);
  const overall = health.overall;

  const speedy  = health.bots.find(b => b.bot === 'speedy-indra') || {};
  const deribit = health.bots.find(b => b.bot === 'deribit')      || {};
  const dog     = health.bots.find(b => b.bot === 'dog-mm')       || {};

  const sState  = states?.speedyIndra || {};
  const dState  = states?.deribit     || {};
  const mState  = states?.dogMm       || {};

  const lines = [
    `${icon(overall)} ORION — ${overall.toUpperCase()}`,
    now,
    '',
    `Speedy-Indra: ${icon(speedy.status)} ${speedy.reason || '?'} | heartbeat=${sState.lastHeartbeatSuccessAt ? minsAgo(speedy.minutesStale) : 'nunca'}`,
    `Deribit:      ${icon(deribit.status)} ${deribit.reason || '?'} | pos=$${dState.positionSizeUsd ?? 0} | ciclos=${dState.cycleCount ?? '?'}`,
    `DOG-MM:       ${icon(dog.status)} ${dog.reason || '?'} | funded=${mState.funded ?? '?'} | ${minsAgo(dog.minutesStale)}`,
  ];

  if (health.alerts.length > 0) {
    lines.push('', 'Alertas:');
    health.alerts.forEach(a => lines.push(`  ⚠️ ${a}`));
  }

  return lines.join('\n');
}

// ── /report (full) ────────────────────────────────────────────────────────────

function formatReport(health, states) {
  const sState  = states?.speedyIndra || {};
  const dState  = states?.deribit     || {};
  const mState  = states?.dogMm       || {};

  const lines = [
    '📋 ORION — Relatório Completo',
    `🕐 ${ts(health.checkedAt)}`,
    `Status Geral: ${health.overall.toUpperCase()}`,
    '',
    '══ SPEEDY-INDRA ══',
    ...formatSpeedyBlock(health, sState),
    '',
    '══ DERIBIT ══',
    ...formatDeribitBlock(health, dState),
    '',
    '══ DOG-MM ══',
    ...formatDogBlock(health, mState),
  ];

  if (health.alerts.length > 0) {
    lines.push('', '🚨 Alertas Ativos:');
    health.alerts.forEach(a => lines.push(`  - ${a}`));
  }

  return lines.join('\n');
}

// ── /speedy ───────────────────────────────────────────────────────────────────

function formatSpeedy(health, states) {
  const h = health.bots.find(b => b.bot === 'speedy-indra') || {};
  const s = states?.speedyIndra || {};

  const lines = [
    `${icon(h.status)} Speedy-Indra — ${(h.status || '?').toUpperCase()}`,
    ...formatSpeedyBlock(health, s),
  ];
  return lines.join('\n');
}

function formatSpeedyBlock(health, s) {
  const h = health.bots.find(b => b.bot === 'speedy-indra') || {};
  if (s.error) return [`Erro: ${s.error}`];
  return [
    `Loop: ${s.loopRunning ? 'rodando' : 'parado'} | ciclos=${s.loopCycles ?? '?'}`,
    `Último ciclo: ${ts(s.lastCycleAt)} (${minsAgo(h.minutesStale)})`,
    `Heartbeat: ${ts(s.lastHeartbeatSuccessAt)} | falhas=${s.consecutiveHeartbeatFailures ?? 0}`,
    `Watchdog stale: ${s.watchdogStale ? 'sim' : 'não'}`,
    `Próxima ação: ${s.nextAction || '?'}`,
    s.supervisorLine ? `Loop status: ${s.supervisorLine}` : null,
  ].filter(Boolean);
}

// ── /deribit ──────────────────────────────────────────────────────────────────

function formatDeribitDetailed(health, states) {
  const h = health.bots.find(b => b.bot === 'deribit') || {};
  const s = states?.deribit || {};

  const lines = [
    `${icon(h.status)} Deribit — ${(h.status || '?').toUpperCase()}`,
    ...formatDeribitBlock(health, s),
  ];
  return lines.join('\n');
}

function formatDeribitBlock(health, s) {
  const h = health.bots.find(b => b.bot === 'deribit') || {};
  if (s.error) return [`Erro: ${s.error}`];
  return [
    `Ambiente: ${s.environment || '?'}`,
    `Último ciclo: ${ts(s.lastCycleAt)} (${minsAgo(h.minutesStale)})`,
    `Ciclos total: ${s.cycleCount ?? '?'}`,
    `Posição: $${s.positionSizeUsd ?? 0} (${s.positionDirection || '?'})`,
    `PnL flutuante: ${s.positionFloatingPnl ?? 0} BTC`,
    `Ordens abertas: ${s.openOrderCount ?? 0}`,
    `Equity: ${s.accountEquity ?? '?'} BTC`,
    `Último action: ${s.lastAction || '?'}`,
    `PnL realizado: ${s.cumulativeRealizedPnlBtc ?? 0} BTC`,
    s.lastCycleError ? `Erro último ciclo: ${s.lastCycleError}` : null,
  ].filter(Boolean);
}

// ── /dog ──────────────────────────────────────────────────────────────────────

function formatDog(health, states) {
  const h = health.bots.find(b => b.bot === 'dog-mm') || {};
  const s = states?.dogMm || {};

  const lines = [
    `${icon(h.status)} DOG-MM — ${(h.status || '?').toUpperCase()}`,
    ...formatDogBlock(health, s),
  ];
  return lines.join('\n');
}

function formatDogBlock(health, s) {
  const h = health.bots.find(b => b.bot === 'dog-mm') || {};
  if (s.error && !s.lastLogLines?.length) return [`Erro: ${s.error}`];

  const lines = [
    `Stage: ${s.stage || '?'}`,
    `Funded: ${s.funded ? 'sim' : 'não'}`,
    `Pool: ${s.selectedPool || '?'}`,
    `Primeiro ciclo: ${s.firstCycleExecuted ? 'executado' : 'pendente'}`,
    `Última atividade: ${ts(s.lastActivityAt)} (${minsAgo(h.minutesStale)})`,
    `Arquivo: ${s.lastActivityFile || 'nenhum'}`,
    `Mercado: ${s.marketFavorable === null ? '?' : s.marketFavorable ? 'favorável' : 'desfavorável'}`,
    s.marketReason ? `Motivo: ${s.marketReason}` : null,
  ].filter(Boolean);

  if (s.lastLogLines && s.lastLogLines.length > 0) {
    lines.push('', 'Últimas linhas do log:');
    s.lastLogLines.slice(-5).forEach(l => lines.push(`  ${l}`));
  }

  return lines;
}

// ── /help ─────────────────────────────────────────────────────────────────────

function formatHelp() {
  return [
    '📟 ORION — Comandos',
    '/status  — resumo de todos os bots',
    '/report  — relatório completo',
    '/speedy  — status detalhado Speedy-Indra',
    '/deribit — status detalhado Deribit',
    '/dog     — status detalhado DOG-MM',
    '/help    — lista de comandos',
  ].join('\n');
}

module.exports = {
  formatStatus,
  formatReport,
  formatSpeedy,
  formatDeribitDetailed,
  formatDog,
  formatHelp,
};
