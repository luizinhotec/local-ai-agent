#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { AGENT_LOG_PATH } = require('./lib/agent-paths.cjs');
const { readTail } = require('./lib/agent-logger.cjs');

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseArgs(argv) {
  const parsed = {
    staleSeconds: 90,
    cooldownSeconds: 300,
    pollMs: 2000,
    beep: false,
    once: false,
    tail: 20,
    quietBreaker: false,
  };

  for (const arg of argv) {
    if (arg === '--beep') parsed.beep = true;
    if (arg === '--once') parsed.once = true;
    if (arg === '--quiet-breaker') parsed.quietBreaker = true;
    if (!arg.startsWith('--') || arg === '--beep' || arg === '--once') continue;
    const [key, ...rest] = arg.slice(2).split('=');
    const value = rest.join('=');
    if (key === 'stale-seconds') parsed.staleSeconds = Number(value || 90);
    if (key === 'cooldown-seconds') parsed.cooldownSeconds = Number(value || 300);
    if (key === 'poll-ms') parsed.pollMs = Number(value || 2000);
    if (key === 'tail') parsed.tail = Number(value || 20);
  }

  return parsed;
}

function color(level, message) {
  const codes = {
    INFO: '\x1b[36m',
    WARNING: '\x1b[33m',
    ALERT: '\x1b[31m',
    RESET: '\x1b[0m',
  };
  return `${codes[level] || ''}${message}${codes.RESET}`;
}

function emit(level, message, payload = null, beep = false) {
  const prefix = `[MONITOR][${level}]`;
  const line = payload ? `${prefix} ${message} ${JSON.stringify(payload)}` : `${prefix} ${message}`;
  console.log(color(level, line));
  if (beep && (level === 'WARNING' || level === 'ALERT')) {
    process.stdout.write('\x07');
  }
}

function formatMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1) return '<1 min';
  if (parsed < 60) return `${Math.ceil(parsed)} min`;
  const hours = Math.floor(parsed / 60);
  const minutes = Math.ceil(parsed % 60);
  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

function safeParseJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isUnexpectedError(record) {
  if (!record || typeof record !== 'object') return false;
  if (String(record.type || '').includes('failed')) return true;
  if (record.error) return true;
  return false;
}

function containsExactString(value, expected) {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some(item => containsExactString(item, expected));
  if (value && typeof value === 'object') {
    return Object.values(value).some(item => containsExactString(item, expected));
  }
  return false;
}

function recordHasCircuitBreaker(record) {
  if (!record || typeof record !== 'object') return false;
  if (String(record.type || '').includes('circuit_breaker_open')) return true;
  return containsExactString(record, 'circuit_breaker_open');
}

function extractBreakerStatus(record) {
  if (!record || typeof record !== 'object') return { known: false, open: false };
  const blockerCollections = [];
  if (Array.isArray(record.blockers)) blockerCollections.push(record.blockers);
  if (Array.isArray(record.knownBlockers)) blockerCollections.push(record.knownBlockers);
  if (record.execution && Array.isArray(record.execution.blockers)) blockerCollections.push(record.execution.blockers);
  if (record.decisionContext?.defi?.blockers) blockerCollections.push(record.decisionContext.defi.blockers);
  if (record.decisionContext?.router?.routerBlockers) blockerCollections.push(record.decisionContext.router.routerBlockers);
  if (record.plan && Array.isArray(record.plan.knownBlockers)) blockerCollections.push(record.plan.knownBlockers);

  if (blockerCollections.length === 0) {
    return { known: false, open: recordHasCircuitBreaker(record) };
  }

  const open = blockerCollections.some(items => containsExactString(items, 'circuit_breaker_open'));
  return { known: true, open };
}

function shouldEmitByCooldown(monitorState, key, cooldownSeconds) {
  const now = Date.now();
  const lastEmittedAt = monitorState.lastAlertAtByKey[key] || 0;
  if (now - lastEmittedAt < cooldownSeconds * 1000) {
    return false;
  }
  monitorState.lastAlertAtByKey[key] = now;
  return true;
}

function classifyRecord(record, monitorState, options) {
  if (!record) return;
  monitorState.lastEventAt = Date.now();
  monitorState.staleAlertSent = false;

  if (record.type === 'operational_alert_cooldown_released') {
    emit('WARNING', 'cooldown de mensagem liberado', {
      pendingReplyCount: record.pendingReplyCount,
      nextTarget: record.nextTarget?.peerDisplayName || record.nextTarget?.target || null,
      recommendedAction: record.recommendedAction || null,
    }, options.beep);
  }

  if (record.type === 'operational_alert_action_eligible') {
    emit('ALERT', 'acao segura elegivel agora', {
      recommendedAction: record.recommendedAction,
      command: record.command || null,
    }, options.beep);
  }

  if (record.type === 'operational_alert_recommendation_changed') {
    emit('INFO', 'recomendacao operacional mudou', {
      previousRecommendedAction: record.previousRecommendedAction || null,
      recommendedAction: record.recommendedAction || null,
      reason: record.reason || null,
    }, false);
  }

  if (record.type === 'operational_summary_updated') {
    const supervisorLine = record.supervisorLine || null;
    const cooldown = record.messaging?.cooldown || null;
    const summaryChanged = supervisorLine && supervisorLine !== monitorState.lastSupervisorLine;
    if (summaryChanged) {
      monitorState.lastSupervisorLine = supervisorLine;
      emit('INFO', 'resumo operacional', {
        summary: supervisorLine,
      }, false);
    }

    const cooldownKey = JSON.stringify({
      active: Boolean(cooldown?.active),
      availableAt: cooldown?.availableAt || null,
      pendingReplyCount: cooldown?.pendingReplyCount || 0,
    });
    if (cooldownKey !== monitorState.lastCooldownSnapshotKey) {
      monitorState.lastCooldownSnapshotKey = cooldownKey;
      if (cooldown?.active) {
        emit('INFO', 'mensagem em cooldown', {
          target: cooldown?.nextTarget?.peerDisplayName || cooldown?.nextTarget?.target || null,
          remaining: formatMinutes(cooldown?.remainingMin),
          availableAt: cooldown?.availableAt || null,
        }, false);
      } else if ((cooldown?.pendingReplyCount || 0) > 0) {
        emit('WARNING', 'mensagem livre para resposta', {
          pendingReplyCount: cooldown.pendingReplyCount,
        }, options.beep);
      }
    }
  }

  const recommendedAction =
    record.recommendedAction ||
    record.lastDecision?.recommendedAction ||
    null;

  if (recommendedAction && recommendedAction !== monitorState.lastRecommendedAction) {
    monitorState.lastRecommendedAction = recommendedAction;
    const level = recommendedAction === 'messaging_only' ? 'WARNING' : 'INFO';
    emit(level, 'recommendedAction changed', {
      type: record.type,
      recommendedAction,
    }, options.beep);
  }

  if (recommendedAction === 'defi_swap_execute') {
    emit('ALERT', 'defi_swap_execute recomendado', {
      type: record.type,
      reason: record.reason || record.lastDecision?.actionReason || null,
    }, options.beep);
  }

  const breakerStatus = extractBreakerStatus(record);
  if (breakerStatus.open && !monitorState.breakerOpen) {
    monitorState.breakerOpen = true;
    monitorState.lastAlertAtByKey.breaker = Date.now();
    monitorState.lastAlertAtByKey.breaker_reminder = Date.now();
    emit('ALERT', 'circuit breaker abriu', {
      type: record.type,
    }, options.beep);
  } else if (breakerStatus.open && monitorState.breakerOpen && !options.quietBreaker) {
    if (shouldEmitByCooldown(monitorState, 'breaker_reminder', options.cooldownSeconds)) {
      emit('WARNING', 'circuit breaker continua aberto', {
        type: record.type,
        cooldownSeconds: options.cooldownSeconds,
      }, options.beep);
    }
  } else if (breakerStatus.known && !breakerStatus.open && monitorState.breakerOpen) {
    monitorState.breakerOpen = false;
    emit('INFO', 'circuit breaker fechou', {
      type: record.type,
    }, false);
  }

  if (isUnexpectedError(record)) {
    emit('ALERT', 'erro inesperado detectado no log', {
      type: record.type,
      error: record.error || null,
    }, options.beep);
  }
}

function checkStaleness(monitorState, options) {
  if (!monitorState.lastEventAt) return;
  const elapsedSec = Math.floor((Date.now() - monitorState.lastEventAt) / 1000);
  if (elapsedSec > options.staleSeconds && !monitorState.staleAlertSent) {
    monitorState.staleAlertSent = true;
    emit('ALERT', 'loop possivelmente parado ou sem novos eventos', {
      elapsedSec,
      staleSeconds: options.staleSeconds,
    }, options.beep);
  }
}

function readNewChunk(filePath, offset) {
  const stats = fs.statSync(filePath);
  if (stats.size <= offset) {
    return { nextOffset: stats.size, lines: [] };
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const length = stats.size - offset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, offset);
    const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    return { nextOffset: stats.size, lines };
  } finally {
    fs.closeSync(fd);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const monitorState = {
    lastEventAt: null,
    lastRecommendedAction: null,
    lastSupervisorLine: null,
    lastCooldownSnapshotKey: null,
    staleAlertSent: false,
    breakerOpen: false,
    lastAlertAtByKey: {},
  };

  emit('INFO', 'monitor iniciado', {
    logPath: AGENT_LOG_PATH,
    staleSeconds: options.staleSeconds,
    cooldownSeconds: options.cooldownSeconds,
    pollMs: options.pollMs,
    once: options.once,
    quietBreaker: options.quietBreaker,
  }, false);

  if (!fs.existsSync(AGENT_LOG_PATH)) {
    emit('WARNING', 'arquivo de log ainda nao existe', { logPath: AGENT_LOG_PATH }, options.beep);
    if (options.once) {
      return;
    }
  }

  for (const record of readTail(options.tail)) {
    classifyRecord(record, monitorState, options);
  }

  if (options.once) {
    checkStaleness(monitorState, options);
    return;
  }

  let offset = fs.existsSync(AGENT_LOG_PATH) ? fs.statSync(AGENT_LOG_PATH).size : 0;

  while (true) {
    try {
      if (fs.existsSync(AGENT_LOG_PATH)) {
        const chunk = readNewChunk(AGENT_LOG_PATH, offset);
        offset = chunk.nextOffset;
        for (const line of chunk.lines) {
          classifyRecord(safeParseJson(line), monitorState, options);
        }
      }
      checkStaleness(monitorState, options);
    } catch (error) {
      emit('WARNING', 'monitor encontrou erro e continuou em modo somente leitura', {
        error: error.message,
      }, options.beep);
    }
    await sleep(options.pollMs);
  }
}

main().catch(error => {
  emit('ALERT', 'falha fatal no monitor', { error: error.message }, true);
  process.exit(1);
});
