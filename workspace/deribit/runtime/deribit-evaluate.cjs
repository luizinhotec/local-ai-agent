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
  const checkPath = path.join(__dirname, 'deribit-check.cjs');
  const decisionPath = path.join(__dirname, 'deribit-decision-preview.cjs');

  const checkCode = runNodeScript(checkPath);
  if (checkCode !== 0 && checkCode !== 3) {
    process.exit(checkCode);
  }

  const decisionCode = runNodeScript(decisionPath, process.argv.slice(2));
  process.exit(decisionCode);
}

main();
