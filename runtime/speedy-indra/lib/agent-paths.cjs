const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const RUNTIME_DIR = path.join(ROOT_DIR, 'runtime', 'speedy-indra');
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const STATE_DIR = path.join(ROOT_DIR, 'state', 'speedy-indra');
const LOG_DIR = path.join(ROOT_DIR, 'logs', 'speedy-indra');
const ACTIVE_DIR = path.join(ROOT_DIR, 'active');
const ACTIVE_STATE_DIR = path.join(ACTIVE_DIR, 'state');

module.exports = {
  ROOT_DIR,
  RUNTIME_DIR,
  CONFIG_DIR,
  STATE_DIR,
  LOG_DIR,
  ACTIVE_DIR,
  ACTIVE_STATE_DIR,
  AGENT_STATE_PATH: path.join(STATE_DIR, 'agent-state.json'),
  AGENT_LOCK_PATH: path.join(STATE_DIR, 'agent-loop.lock'),
  TELEGRAM_EXEC_LOCK_PATH: path.join(STATE_DIR, 'telegram-exec.lock'),
  AGENT_WATCHDOG_PATH: path.join(STATE_DIR, 'watchdog.json'),
  AGENT_STATUS_PATH: path.join(STATE_DIR, 'status.json'),
  AGENT_LOG_PATH: path.join(LOG_DIR, 'agent-log.jsonl'),
  ACTIVE_OPS_SUMMARY_PATH: path.join(ACTIVE_STATE_DIR, 'aibtc-ops-summary.json'),
  ACTIVE_OPS_LOG_PATH: path.join(ACTIVE_STATE_DIR, 'aibtc-ops-log.jsonl'),
  ACTIVE_HEARTBEAT_CLI_PATH: path.join(ACTIVE_DIR, 'tools', 'aibtc-heartbeat-cli.cjs'),
  ACTIVE_HELPER_SCRIPT_PATH: path.join(ACTIVE_DIR, 'scripts', 'start-aibtc-register-helper.ps1'),
};
