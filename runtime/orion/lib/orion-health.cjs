'use strict';

/**
 * orion-health.cjs
 *
 * Evaluates health of each bot from raw state snapshots.
 *
 * checkHealth(states, config) -> { bots: BotHealth[], overall, alerts }
 *
 * BotHealth {
 *   bot:           string           — 'speedy-indra' | 'deribit' | 'dog-mm'
 *   status:        'ok'|'warn'|'critical'|'unknown'
 *   reason:        string
 *   minutesStale:  number|null
 *   alerts:        string[]
 * }
 */

// ── helpers ───────────────────────────────────────────────────────────────────

function minutesSince(isoString) {
  if (!isoString) return null;
  const diff = Date.now() - new Date(isoString).getTime();
  return Math.round(diff / 60000);
}

function classify(minutesStale, warnMin, critMin) {
  if (minutesStale === null) return 'unknown';
  if (minutesStale >= critMin) return 'critical';
  if (minutesStale >= warnMin) return 'warn';
  return 'ok';
}

// ── per-bot evaluators ────────────────────────────────────────────────────────

function evalSpeedyIndra(state, staleThresholdMin) {
  const alerts = [];

  if (state.error) {
    return {
      bot: 'speedy-indra',
      status: 'unknown',
      reason: `read_error: ${state.error}`,
      minutesStale: null,
      alerts: [`Speedy-Indra: erro ao ler estado — ${state.error}`],
    };
  }

  // Staleness: use watchdog updatedAt or lastCycleAt
  const anchor = state.watchdogUpdatedAt || state.lastCycleAt || state.checkedAt;
  const stale = minutesSince(anchor);
  const warnMin = staleThresholdMin;
  const critMin = staleThresholdMin * 3;

  let status = classify(stale, warnMin, critMin);
  let reason = `last_seen_${stale ?? '?'}min_ago`;

  // Override: watchdog explicitly flagged stale
  if (state.watchdogStale) {
    status = status === 'ok' ? 'warn' : status;
    reason = 'watchdog_stale';
    alerts.push(`Speedy-Indra: watchdog marcado como stale`);
  }

  // Override: many consecutive heartbeat failures
  if ((state.consecutiveHeartbeatFailures || 0) >= 5) {
    status = 'critical';
    reason = `heartbeat_failures_${state.consecutiveHeartbeatFailures}`;
    alerts.push(`Speedy-Indra: ${state.consecutiveHeartbeatFailures} falhas consecutivas de heartbeat`);
  }

  if (status === 'critical' && !alerts.length) {
    alerts.push(`Speedy-Indra: sem atividade há ${stale}min (limite ${critMin}min)`);
  }

  return { bot: 'speedy-indra', status, reason, minutesStale: stale, alerts };
}

function evalDeribit(state, staleThresholdMin) {
  const alerts = [];

  if (state.error) {
    return {
      bot: 'deribit',
      status: 'unknown',
      reason: `read_error: ${state.error}`,
      minutesStale: null,
      alerts: [`Deribit: erro ao ler estado — ${state.error}`],
    };
  }

  const stale = minutesSince(state.lastCycleAt);
  const warnMin = 3;    // deribit cycles every ~30s; warn at 3min
  const critMin = 5;    // critical at 5min (specified in prompt)

  const status = classify(stale, warnMin, critMin);
  const reason = stale !== null ? `last_cycle_${stale}min_ago` : 'no_cycle_recorded';

  if (status === 'critical') {
    alerts.push(`Deribit: loop parado há ${stale}min (limite ${critMin}min)`);
  }

  if (state.lastCycleError) {
    alerts.push(`Deribit: último ciclo com erro — ${state.lastCycleError}`);
  }

  return { bot: 'deribit', status, reason, minutesStale: stale, alerts };
}

function evalDogMm(state, staleThresholdMin) {
  const alerts = [];

  if (state.error && !state.lastLogLines?.length) {
    return {
      bot: 'dog-mm',
      status: 'unknown',
      reason: `read_error: ${state.error}`,
      minutesStale: null,
      alerts: [`DOG-MM: erro ao ler estado — ${state.error}`],
    };
  }

  if (!state.funded) {
    // Not funded yet — informational warn, not critical
    return {
      bot: 'dog-mm',
      status: 'warn',
      reason: 'wallet_not_funded',
      minutesStale: null,
      alerts: [],
    };
  }

  if (state.lpHasPosition && state.lpHealthy) {
    const stale = minutesSince(state.lpGeneratedAt || state.lastActivityAt);
    return {
      bot: 'dog-mm',
      status: 'ok',
      reason: `lp_${state.lpStatus}`,
      minutesStale: stale,
      alerts: [],
    };
  }

  // Wallet funded: expect regular activity
  const stale = minutesSince(state.lastActivityAt);
  const warnMin = staleThresholdMin;     // e.g. 10min
  const critMin = 120;                   // 2h — specified in prompt

  const status = classify(stale, warnMin, critMin);
  const reason = stale !== null
    ? `last_activity_${stale}min_ago`
    : 'no_activity_file';

  if (status === 'critical') {
    alerts.push(`DOG-MM: wallet funded mas sem atividade há ${stale}min (limite ${critMin}min)`);
  }

  if (state.marketFavorable === false) {
    // Not critical on its own, but worth noting in alerts when already warn/critical
    if (status !== 'ok') {
      alerts.push(`DOG-MM: mercado desfavorável — ${state.marketReason || 'motivo desconhecido'}`);
    }
  }

  return { bot: 'dog-mm', status, reason, minutesStale: stale, alerts };
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * @param {{ speedyIndra, deribit, dogMm }} states  — output of readAllBotStates()
 * @param {{ health: { staleThresholdMinutes } }}  config — from loadOrionConfig()
 * @returns {{ bots: BotHealth[], overall: string, alerts: string[] }}
 */
function checkHealth(states, config) {
  const stale = config?.health?.staleThresholdMinutes ?? 10;

  const bots = [
    evalSpeedyIndra(states.speedyIndra || { error: 'no_state' }, stale),
    evalDeribit(states.deribit     || { error: 'no_state' }, stale),
    evalDogMm(states.dogMm         || { error: 'no_state' }, stale),
  ];

  const allAlerts = bots.flatMap(b => b.alerts);

  const severityRank = { ok: 0, warn: 1, unknown: 2, critical: 3 };
  const worst = bots.reduce((acc, b) => {
    return (severityRank[b.status] || 0) > (severityRank[acc] || 0) ? b.status : acc;
  }, 'ok');

  return {
    checkedAt: new Date().toISOString(),
    overall: worst,
    bots,
    alerts: allAlerts,
  };
}

/**
 * Returns a one-line summary string for the health result.
 */
function summarizeHealth(health) {
  const icons = { ok: 'OK', warn: 'WARN', critical: 'CRIT', unknown: '????' };
  const parts = health.bots.map(b => `${b.bot}=${icons[b.status] || b.status}`);
  return `[${health.overall.toUpperCase()}] ${parts.join(' | ')}`;
}

module.exports = { checkHealth, summarizeHealth };
