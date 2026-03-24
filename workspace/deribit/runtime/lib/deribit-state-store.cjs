const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', '..', 'state');
const LATEST_SNAPSHOT_PATH = path.join(STATE_DIR, 'deribit-latest.json');
const EVENT_LOG_PATH = path.join(STATE_DIR, 'deribit-events.jsonl');
const LATEST_RISK_PATH = path.join(STATE_DIR, 'deribit-risk-latest.json');
const LATEST_DECISION_PATH = path.join(STATE_DIR, 'deribit-decision-latest.json');
const LATEST_OPEN_ORDERS_PATH = path.join(STATE_DIR, 'deribit-open-orders-latest.json');
const BOT_STATE_PATH = path.join(STATE_DIR, 'deribit-bot-state.json');
const BOT_METRICS_PATH = path.join(STATE_DIR, 'deribit-bot-metrics.json');
const PROCESS_LOCK_STATUS_PATH = path.join(STATE_DIR, 'deribit-process-lock-status.json');
const LATEST_RECONCILE_PATH = path.join(STATE_DIR, 'deribit-reconcile-latest.json');
const LATEST_TRADES_PATH = path.join(STATE_DIR, 'deribit-trades-latest.json');
const LATEST_EXECUTION_AUDIT_PATH = path.join(STATE_DIR, 'deribit-execution-latest.json');

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function writeLatestSnapshot(snapshot) {
  ensureStateDir();
  fs.writeFileSync(LATEST_SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
}

function appendEvent(event) {
  ensureStateDir();
  fs.appendFileSync(EVENT_LOG_PATH, `${JSON.stringify(event)}\n`);
}

function readLatestSnapshot() {
  if (!fs.existsSync(LATEST_SNAPSHOT_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(LATEST_SNAPSHOT_PATH, 'utf8'));
}

function writeLatestRisk(result) {
  ensureStateDir();
  fs.writeFileSync(LATEST_RISK_PATH, JSON.stringify(result, null, 2));
}

function readLatestRisk() {
  if (!fs.existsSync(LATEST_RISK_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(LATEST_RISK_PATH, 'utf8'));
}

function writeLatestDecision(result) {
  ensureStateDir();
  fs.writeFileSync(LATEST_DECISION_PATH, JSON.stringify(result, null, 2));
}

function readLatestDecision() {
  if (!fs.existsSync(LATEST_DECISION_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(LATEST_DECISION_PATH, 'utf8'));
}

function writeLatestOpenOrders(result) {
  ensureStateDir();
  fs.writeFileSync(LATEST_OPEN_ORDERS_PATH, JSON.stringify(result, null, 2));
}

function readLatestOpenOrders() {
  if (!fs.existsSync(LATEST_OPEN_ORDERS_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(LATEST_OPEN_ORDERS_PATH, 'utf8'));
}

function writeBotState(state) {
  ensureStateDir();
  fs.writeFileSync(BOT_STATE_PATH, JSON.stringify(state, null, 2));
}

function readBotState() {
  if (!fs.existsSync(BOT_STATE_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(BOT_STATE_PATH, 'utf8'));
}

function writeBotMetrics(metrics) {
  ensureStateDir();
  fs.writeFileSync(BOT_METRICS_PATH, JSON.stringify(metrics, null, 2));
}

function readBotMetrics() {
  if (!fs.existsSync(BOT_METRICS_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(BOT_METRICS_PATH, 'utf8'));
}

function writeProcessLockStatus(status) {
  ensureStateDir();
  fs.writeFileSync(PROCESS_LOCK_STATUS_PATH, JSON.stringify(status, null, 2));
}

function readProcessLockStatus() {
  if (!fs.existsSync(PROCESS_LOCK_STATUS_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(PROCESS_LOCK_STATUS_PATH, 'utf8'));
}

function writeLatestReconcile(result) {
  ensureStateDir();
  fs.writeFileSync(LATEST_RECONCILE_PATH, JSON.stringify(result, null, 2));
}

function readLatestReconcile() {
  if (!fs.existsSync(LATEST_RECONCILE_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(LATEST_RECONCILE_PATH, 'utf8'));
}

function writeLatestTrades(result) {
  ensureStateDir();
  fs.writeFileSync(LATEST_TRADES_PATH, JSON.stringify(result, null, 2));
}

function readLatestTrades() {
  if (!fs.existsSync(LATEST_TRADES_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(LATEST_TRADES_PATH, 'utf8'));
}

function writeLatestExecutionAudit(result) {
  ensureStateDir();
  fs.writeFileSync(LATEST_EXECUTION_AUDIT_PATH, JSON.stringify(result, null, 2));
}

function readLatestExecutionAudit() {
  if (!fs.existsSync(LATEST_EXECUTION_AUDIT_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(LATEST_EXECUTION_AUDIT_PATH, 'utf8'));
}

module.exports = {
  STATE_DIR,
  LATEST_SNAPSHOT_PATH,
  EVENT_LOG_PATH,
  LATEST_RISK_PATH,
  LATEST_DECISION_PATH,
  LATEST_OPEN_ORDERS_PATH,
  BOT_STATE_PATH,
  BOT_METRICS_PATH,
  PROCESS_LOCK_STATUS_PATH,
  LATEST_RECONCILE_PATH,
  LATEST_TRADES_PATH,
  LATEST_EXECUTION_AUDIT_PATH,
  writeLatestSnapshot,
  appendEvent,
  readLatestSnapshot,
  writeLatestRisk,
  readLatestRisk,
  writeLatestDecision,
  readLatestDecision,
  writeLatestOpenOrders,
  readLatestOpenOrders,
  writeBotState,
  readBotState,
  writeBotMetrics,
  readBotMetrics,
  writeProcessLockStatus,
  readProcessLockStatus,
  writeLatestReconcile,
  readLatestReconcile,
  writeLatestTrades,
  readLatestTrades,
  writeLatestExecutionAudit,
  readLatestExecutionAudit,
};
