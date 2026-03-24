const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const { AGENT_LOCK_PATH } = require('./agent-paths.cjs');

function readLock(lockPath = AGENT_LOCK_PATH) {
  if (!fs.existsSync(lockPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isLockStale(metadata, staleAfterMs) {
  if (!metadata) {
    return true;
  }
  const currentHost = typeof os.hostname === 'function' ? os.hostname() : 'unknown';
  const sameHost = metadata.hostname === currentHost;
  const updatedAtMs = new Date(metadata.updatedAt || metadata.startedAt || 0).getTime();
  const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Number.POSITIVE_INFINITY;
  if (sameHost) {
    return !isPidRunning(Number(metadata.pid));
  }
  return ageMs > staleAfterMs;
}

function acquireLock({ lockPath = AGENT_LOCK_PATH, staleAfterMs = 120000, processName = 'speedy-indra-loop' } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const metadata = {
    lockId: crypto.randomBytes(8).toString('hex'),
    pid: process.pid,
    hostname: typeof os.hostname === 'function' ? os.hostname() : 'unknown',
    processName,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify(metadata, null, 2));
      fs.closeSync(fd);
      return {
        metadata,
        refresh() {
          metadata.updatedAt = new Date().toISOString();
          fs.writeFileSync(lockPath, JSON.stringify(metadata, null, 2));
          return metadata.updatedAt;
        },
        release() {
          const current = readLock(lockPath);
          if (!current || current.lockId !== metadata.lockId) {
            return false;
          }
          fs.unlinkSync(lockPath);
          return true;
        },
      };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      const current = readLock(lockPath);
      if (isLockStale(current, staleAfterMs)) {
        try {
          fs.unlinkSync(lockPath);
          continue;
        } catch {
          // try again once
        }
      }
      const lockError = new Error('speedy indra loop lock is already held');
      lockError.code = 'LOCK_HELD';
      lockError.lockMetadata = current;
      throw lockError;
    }
  }

  throw new Error('failed to acquire speedy indra loop lock');
}

module.exports = {
  AGENT_LOCK_PATH,
  readLock,
  acquireLock,
  isLockStale,
};
