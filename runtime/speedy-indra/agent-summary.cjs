#!/usr/bin/env node

const { loadAgentConfig } = require('./lib/agent-config.cjs');
const { readAgentState, readAgentStatus, readWatchdog } = require('./lib/agent-state.cjs');
const { buildOperationalSummary } = require('./lib/operational-summary.cjs');

function main() {
  const config = loadAgentConfig();
  const state = readAgentState();
  const status = readAgentStatus();
  const watchdog = readWatchdog();
  const summary = buildOperationalSummary({ config, state, status, watchdog });
  console.log(JSON.stringify(summary, null, 2));
}

main();
