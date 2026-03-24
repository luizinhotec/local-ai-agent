const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  STATE_DIR,
  appendEvent,
  writeProcessLockStatus,
} = require('./deribit-state-store.cjs');

const PROCESS_LOCK_PATH = path.join(STATE_DIR, 'deribit-bot-loop.lock');
const DEFAULT_STALE_LOCK_MS = 120000;

function nowIso() {
  return new Date().toISOString();
}

function buildLockMetadata(options = {}) {
  const startedAt = nowIso();
  const scriptName = options.scriptName || path.basename(process.argv[1] || 'deribit-bot-loop');
  return {
    lockId: crypto.randomBytes(8).toString('hex'),
    pid: process.pid,
    startedAt,
    updatedAt: startedAt,
    hostname: typeof os.hostname === 'function' ? os.hostname() : 'unknown',
    scriptName,
    processName: options.processName || scriptName,
  };
}

function writeLockFile(lockPath, metadata) {
  const handle = fs.openSync(lockPath, 'wx');
  try {
    fs.writeFileSync(handle, JSON.stringify(metadata, null, 2));
  } finally {
    fs.closeSync(handle);
  }
}

function readLockFile(lockPath = PROCESS_LOCK_PATH) {
  if (!fs.existsSync(lockPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    return {
      lockId: 'unreadable',
      pid: null,
      startedAt: null,
      updatedAt: null,
      hostname: null,
      scriptName: null,
      processName: null,
      error: error.message,
    };
  }
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function getLockAgeMs(metadata) {
  const updatedAtMs = new Date(metadata?.updatedAt || metadata?.startedAt || 0).getTime();
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, Date.now() - updatedAtMs);
}

function isStaleLock(metadata, options = {}) {
  const staleAfterMs =
    Number(options.staleAfterMs) > 0 ? Number(options.staleAfterMs) : DEFAULT_STALE_LOCK_MS;
  const currentHostname = typeof os.hostname === 'function' ? os.hostname() : null;
  const sameHost =
    !metadata?.hostname || !currentHostname || metadata.hostname === currentHostname;
  const ageMs = getLockAgeMs(metadata);
  const pidRunning = sameHost && isPidRunning(Number(metadata?.pid));

  if (sameHost) {
    return !pidRunning;
  }

  return ageMs > staleAfterMs;
}

function persistProcessLockStatus(status) {
  const payload = {
    recordedAt: nowIso(),
    ...status,
  };
  writeProcessLockStatus(payload);
  return payload;
}

function recordProcessLockEvent(type, metadata) {
  appendEvent({
    recordedAt: nowIso(),
    type,
    metadata,
  });
}

function tryRemoveLock(lockPath, expectedLockId = null) {
  if (!fs.existsSync(lockPath)) {
    return true;
  }

  const current = readLockFile(lockPath);
  if (expectedLockId && current?.lockId && current.lockId !== expectedLockId) {
    return false;
  }

  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true;
    }
    return false;
  }
}

function acquireProcessLock(options = {}) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const metadata = buildLockMetadata(options);
  const lockPath = options.lockPath || PROCESS_LOCK_PATH;
  const staleAfterMs =
    Number(options.staleAfterMs) > 0 ? Number(options.staleAfterMs) : DEFAULT_STALE_LOCK_MS;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeLockFile(lockPath, metadata);
      const status = persistProcessLockStatus({
        status: 'acquired',
        lockPath,
        staleAfterMs,
        owner: metadata,
      });
      recordProcessLockEvent('bot_process_lock_acquired', {
        lockPath,
        staleAfterMs,
        owner: metadata,
      });

      return {
        lockPath,
        staleAfterMs,
        metadata,
        status,
        refresh() {
          const current = readLockFile(lockPath);
          if (!current || current.lockId !== metadata.lockId || current.pid !== metadata.pid) {
            throw new Error('process lock ownership lost');
          }

          metadata.updatedAt = nowIso();
          fs.writeFileSync(lockPath, JSON.stringify(metadata, null, 2));
          persistProcessLockStatus({
            status: 'heartbeat',
            lockPath,
            staleAfterMs,
            owner: metadata,
          });
        },
        release(reason = 'released') {
          const released = tryRemoveLock(lockPath, metadata.lockId);
          const payload = persistProcessLockStatus({
            status: reason,
            lockPath,
            staleAfterMs,
            owner: metadata,
            released,
          });
          recordProcessLockEvent('bot_process_lock_released', payload);
          return released;
        },
      };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      const existing = readLockFile(lockPath);
      if (isStaleLock(existing, { staleAfterMs })) {
        const removed = tryRemoveLock(lockPath, existing?.lockId || null);
        if (removed) {
          const stalePayload = {
            lockPath,
            staleAfterMs,
            staleOwner: existing,
            recoveredBy: {
              pid: metadata.pid,
              hostname: metadata.hostname,
              scriptName: metadata.scriptName,
            },
          };
          persistProcessLockStatus({
            status: 'stale_recovered',
            ...stalePayload,
          });
          recordProcessLockEvent('bot_process_lock_stale_recovered', stalePayload);
          continue;
        }
      }

      const payload = {
        status: 'blocked',
        lockPath,
        staleAfterMs,
        owner: existing,
        attemptedBy: metadata,
      };
      persistProcessLockStatus(payload);
      recordProcessLockEvent('bot_process_lock_blocked', payload);
      const blockError = new Error('external process lock is active');
      blockError.code = 'LOCK_HELD';
      blockError.lockMetadata = existing;
      throw blockError;
    }
  }

  throw new Error('failed to acquire process lock');
}

module.exports = {
  PROCESS_LOCK_PATH,
  DEFAULT_STALE_LOCK_MS,
  readLockFile,
  isStaleLock,
  acquireProcessLock,
};
