#!/usr/bin/env node

const {
  readLatestSnapshot,
  readLatestRisk,
  LATEST_SNAPSHOT_PATH,
  LATEST_RISK_PATH,
} = require('./lib/deribit-state-store.cjs');
const { loadRiskConfig, evaluateRisk } = require('./lib/deribit-risk.cjs');

function main() {
  const snapshot = readLatestSnapshot();
  if (!snapshot) {
    console.error(`no Deribit snapshot found at ${LATEST_SNAPSHOT_PATH}`);
    process.exit(1);
  }

  const limits = loadRiskConfig();
  const result = evaluateRisk(snapshot, limits);

  console.log(`evaluated_at: ${result.evaluatedAt}`);
  console.log(`overall_status: ${result.overallStatus}`);
  console.log(`environment: ${snapshot.environment}`);
  console.log(`instrument: ${snapshot.instrument}`);

  for (const check of result.checks) {
    console.log(`${check.status}: ${check.name} | ${check.detail}`);
  }

  const persisted = readLatestRisk();
  if (!persisted) {
    console.error(`risk result was not persisted at ${LATEST_RISK_PATH}`);
    process.exit(1);
  }
}

main();
