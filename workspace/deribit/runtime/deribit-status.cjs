#!/usr/bin/env node

const {
  readLatestSnapshot,
  readLatestRisk,
  LATEST_SNAPSHOT_PATH,
  LATEST_RISK_PATH,
} = require('./lib/deribit-state-store.cjs');
const { loadRiskConfig, evaluateRisk } = require('./lib/deribit-risk.cjs');

function parseArgs(argv) {
  const flags = {
    failOnWarn: false,
  };

  for (const arg of argv) {
    if (arg === '--fail-on-warn') {
      flags.failOnWarn = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Deribit status

Usage:
  node workspace/deribit/runtime/deribit-status.cjs
  node workspace/deribit/runtime/deribit-status.cjs --fail-on-warn
`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return flags;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const snapshot = readLatestSnapshot();
  if (!snapshot) {
    console.error(`no Deribit snapshot found at ${LATEST_SNAPSHOT_PATH}`);
    process.exit(1);
  }

  const persistedRisk = readLatestRisk();
  const snapshotAt = snapshot.snapshotAt ? new Date(snapshot.snapshotAt).getTime() : 0;
  const riskAt = persistedRisk?.evaluatedAt ? new Date(persistedRisk.evaluatedAt).getTime() : 0;
  const shouldRecalculate = !persistedRisk || riskAt < snapshotAt;
  const risk = shouldRecalculate ? evaluateRisk(snapshot, loadRiskConfig()) : persistedRisk;

  console.log(`snapshot_at: ${snapshot.snapshotAt || 'n/a'}`);
  console.log(`risk_evaluated_at: ${risk.evaluatedAt || 'n/a'}`);
  console.log(`environment: ${snapshot.environment}`);
  console.log(`instrument: ${snapshot.instrument}`);
  console.log(`auth: ${snapshot.authEnabled ? 'enabled' : 'public-only'}`);
  console.log(`overall_status: ${risk.overallStatus}`);

  const blockingChecks = risk.checks.filter(check => check.status === 'block');
  const warningChecks = risk.checks.filter(check => check.status === 'warn');

  if (blockingChecks.length > 0) {
    console.log(`blocking_checks: ${blockingChecks.length}`);
    for (const check of blockingChecks) {
      console.log(`block: ${check.name} | ${check.detail}`);
    }
  }

  if (warningChecks.length > 0) {
    console.log(`warning_checks: ${warningChecks.length}`);
    for (const check of warningChecks) {
      console.log(`warn: ${check.name} | ${check.detail}`);
    }
  }

  if (shouldRecalculate) {
    if (!persistedRisk) {
      console.log(`risk_source: recalculated because ${LATEST_RISK_PATH} was missing`);
    } else {
      console.log('risk_source: recalculated because snapshot is newer than persisted risk');
    }
  } else {
    console.log(`risk_source: persisted`);
  }

  if (risk.overallStatus === 'block') {
    process.exit(2);
  }
  if (flags.failOnWarn && risk.overallStatus === 'warn') {
    process.exit(3);
  }
}

main();
