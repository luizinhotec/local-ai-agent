#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..', '..', '..'),
  });

  if (typeof result.status === 'number') {
    return result.status;
  }
  return 1;
}

function main() {
  const monitorPath = path.join(__dirname, 'deribit-read-only-monitor.cjs');
  const statusPath = path.join(__dirname, 'deribit-status.cjs');

  const snapshotCode = runNodeScript(monitorPath, ['--once']);
  if (snapshotCode !== 0) {
    process.exit(snapshotCode);
  }

  const statusCode = runNodeScript(statusPath, process.argv.slice(2));
  process.exit(statusCode);
}

main();
