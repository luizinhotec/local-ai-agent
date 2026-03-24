#!/usr/bin/env node

const {
  readLatestSnapshot,
  readBotState,
  LATEST_SNAPSHOT_PATH,
} = require('./lib/deribit-state-store.cjs');
const { loadRiskConfig, evaluateRisk } = require('./lib/deribit-risk.cjs');
const { loadStrategyConfig, decideAction } = require('./lib/deribit-strategy.cjs');

function main() {
  const snapshot = readLatestSnapshot();
  if (!snapshot) {
    console.error(`no Deribit snapshot found at ${LATEST_SNAPSHOT_PATH}`);
    process.exit(1);
  }

  const riskResult = evaluateRisk(snapshot, loadRiskConfig());
  const decision = decideAction(snapshot, riskResult, loadStrategyConfig(), {
    botState: readBotState() || {},
  });

  console.log(`decided_at: ${decision.decidedAt}`);
  console.log(`objective: ${decision.objective}`);
  console.log(`action: ${decision.action}`);
  console.log(`confidence: ${decision.confidence}`);
  console.log(`execution_mode: ${decision.executionMode}`);

  if (decision.reasons.length > 0) {
    console.log('reasons:');
    for (const reason of decision.reasons) {
      console.log(`- ${reason}`);
    }
  }

  if (decision.warnings.length > 0) {
    console.log('warnings:');
    for (const warning of decision.warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (decision.blockers.length > 0) {
    console.log('blockers:');
    for (const blocker of decision.blockers) {
      console.log(`- ${blocker}`);
    }
  }
}

main();
