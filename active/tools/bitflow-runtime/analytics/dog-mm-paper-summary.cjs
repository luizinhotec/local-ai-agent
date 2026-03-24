#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const LOG_FILE = path.resolve(STATE_DIR, 'dog-mm-ops-log.jsonl');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-paper-summary.json');

function toFiniteNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeDivide(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values) {
  const finite = values.filter(value => Number.isFinite(value));
  if (finite.length === 0) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function incrementCounter(map, key) {
  const normalized = String(key || 'unknown').trim() || 'unknown';
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function sortedReasonCounts(map) {
  return Array.from(map.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.reason.localeCompare(right.reason);
    });
}

function readJsonLinesTolerant(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      records: [],
      invalidLineCount: 0,
      skippedEmptyLineCount: 0,
    };
  }

  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/);
  const records = [];
  let invalidLineCount = 0;
  let skippedEmptyLineCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      skippedEmptyLineCount += 1;
      continue;
    }

    try {
      records.push(JSON.parse(trimmed));
    } catch {
      invalidLineCount += 1;
    }
  }

  return {
    records,
    invalidLineCount,
    skippedEmptyLineCount,
  };
}

function getFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function normalizeCycle(record) {
  const details = record?.details || {};
  const observe = details?.loopModel?.observe || {};

  const decisionRaw = getFirstDefined(details.decision, details.decisionResult, details.actionDecision);
  const decision = typeof decisionRaw === 'string' ? decisionRaw.trim().toUpperCase() : '';
  const decisionReason = getFirstDefined(details.decisionReason, details.decision_reason, 'unknown');
  const profitComplete = getFirstDefined(
    details.profitComplete,
    details.profit_complete,
    observe.profitDiagnosticsComplete
  );
  const validationFinal = String(getFirstDefined(details.validationFinal, details.validation, '') || '').trim().toUpperCase();

  return {
    decision,
    decisionReason: String(decisionReason || 'unknown'),
    paperMode: getFirstDefined(details.paperMode, details.paper_mode) === true,
    wouldBroadcast: getFirstDefined(details.wouldBroadcast, details.would_broadcast) === true,
    profitComplete: profitComplete === true,
    validationPassed: validationFinal === 'PASS',
    inputUsd: toFiniteNumber(getFirstDefined(details.inputUsd, details.input_usd)),
    expectedOutputUsd: toFiniteNumber(getFirstDefined(details.expectedOutputUsd, details.expected_output_usd)),
    minOutputUsd: toFiniteNumber(getFirstDefined(details.minOutputUsd, details.min_output_usd)),
    networkFeeUsd: toFiniteNumber(getFirstDefined(details.networkFeeUsd, details.network_fee_usd)),
    netProfitUsd: toFiniteNumber(getFirstDefined(details.netProfitUsd, details.net_profit_usd, details.netProfitEstimatedUsd)),
    worstCaseNetProfitUsd: toFiniteNumber(
      getFirstDefined(
        details.worstCaseNetProfitUsd,
        details.worst_case_net_profit_usd,
        details.worstCaseNetProfitEstimatedUsd
      )
    ),
    netProfitBps: toFiniteNumber(getFirstDefined(details.netProfitBps, details.net_profit_bps)),
  };
}

function buildSummary(filePath, parsed) {
  const cycles = parsed.records
    .filter(record => record && typeof record === 'object')
    .filter(record => record.type === 'agent_cycle_evaluated')
    .map(normalizeCycle);

  const decisionReasons = new Map();
  const inputUsdValues = [];
  const expectedOutputUsdValues = [];
  const minOutputUsdValues = [];
  const networkFeeUsdValues = [];
  const netProfitUsdValues = [];
  const worstCaseNetProfitUsdValues = [];
  const netProfitBpsValues = [];
  const executeNetProfitUsdValues = [];
  const skipNetProfitUsdValues = [];
  const executeWorstCaseNetProfitUsdValues = [];
  const skipWorstCaseNetProfitUsdValues = [];

  let executeCount = 0;
  let skipCount = 0;
  let inconclusiveCount = 0;
  let unknownDecisionCount = 0;
  let paperModeYesCount = 0;
  let wouldBroadcastYesCount = 0;
  let profitCompleteYesCount = 0;
  let validationPassCount = 0;

  for (const cycle of cycles) {
    if (cycle.decision === 'EXECUTE') {
      executeCount += 1;
    } else if (cycle.decision === 'SKIP') {
      skipCount += 1;
    } else if (cycle.decision === 'INCONCLUSIVE') {
      inconclusiveCount += 1;
    } else {
      unknownDecisionCount += 1;
    }

    if (cycle.paperMode) paperModeYesCount += 1;
    if (cycle.wouldBroadcast) wouldBroadcastYesCount += 1;
    if (cycle.profitComplete) profitCompleteYesCount += 1;
    if (cycle.validationPassed) validationPassCount += 1;

    incrementCounter(decisionReasons, cycle.decisionReason || 'unknown');

    if (Number.isFinite(cycle.inputUsd)) inputUsdValues.push(cycle.inputUsd);
    if (Number.isFinite(cycle.expectedOutputUsd)) expectedOutputUsdValues.push(cycle.expectedOutputUsd);
    if (Number.isFinite(cycle.minOutputUsd)) minOutputUsdValues.push(cycle.minOutputUsd);
    if (Number.isFinite(cycle.networkFeeUsd)) networkFeeUsdValues.push(cycle.networkFeeUsd);
    if (Number.isFinite(cycle.netProfitUsd)) netProfitUsdValues.push(cycle.netProfitUsd);
    if (Number.isFinite(cycle.worstCaseNetProfitUsd)) worstCaseNetProfitUsdValues.push(cycle.worstCaseNetProfitUsd);
    if (Number.isFinite(cycle.netProfitBps)) netProfitBpsValues.push(cycle.netProfitBps);

    if (cycle.decision === 'EXECUTE' && Number.isFinite(cycle.netProfitUsd)) {
      executeNetProfitUsdValues.push(cycle.netProfitUsd);
    }
    if (cycle.decision === 'SKIP' && Number.isFinite(cycle.netProfitUsd)) {
      skipNetProfitUsdValues.push(cycle.netProfitUsd);
    }
    if (cycle.decision === 'EXECUTE' && Number.isFinite(cycle.worstCaseNetProfitUsd)) {
      executeWorstCaseNetProfitUsdValues.push(cycle.worstCaseNetProfitUsd);
    }
    if (cycle.decision === 'SKIP' && Number.isFinite(cycle.worstCaseNetProfitUsd)) {
      skipWorstCaseNetProfitUsdValues.push(cycle.worstCaseNetProfitUsd);
    }
  }

  const totalCycles = cycles.length;

  return {
    generatedAtUtc: new Date().toISOString(),
    logFile: filePath,
    total_cycles: totalCycles,
    execute_count: executeCount,
    skip_count: skipCount,
    inconclusive_count: inconclusiveCount,
    unknown_decision_count: unknownDecisionCount,
    execute_rate_percent: round(safeDivide(executeCount * 100, totalCycles), 2),
    skip_rate_percent: round(safeDivide(skipCount * 100, totalCycles), 2),
    inconclusive_rate_percent: round(safeDivide(inconclusiveCount * 100, totalCycles), 2),
    paper_mode_yes_count: paperModeYesCount,
    would_broadcast_yes_count: wouldBroadcastYesCount,
    profit_complete_yes_count: profitCompleteYesCount,
    validation_pass_count: validationPassCount,
    avg_input_usd: average(inputUsdValues),
    avg_expected_output_usd: average(expectedOutputUsdValues),
    avg_min_output_usd: average(minOutputUsdValues),
    avg_network_fee_usd: average(networkFeeUsdValues),
    avg_net_profit_usd: average(netProfitUsdValues),
    avg_worst_case_net_profit_usd: average(worstCaseNetProfitUsdValues),
    avg_net_profit_bps: average(netProfitBpsValues),
    avg_net_profit_usd_execute: average(executeNetProfitUsdValues),
    avg_net_profit_usd_skip: average(skipNetProfitUsdValues),
    avg_worst_case_net_profit_usd_execute: average(executeWorstCaseNetProfitUsdValues),
    avg_worst_case_net_profit_usd_skip: average(skipWorstCaseNetProfitUsdValues),
    best_net_profit_usd: netProfitUsdValues.length > 0 ? round(Math.max(...netProfitUsdValues)) : null,
    worst_net_profit_usd: netProfitUsdValues.length > 0 ? round(Math.min(...netProfitUsdValues)) : null,
    best_worst_case_net_profit_usd:
      worstCaseNetProfitUsdValues.length > 0 ? round(Math.max(...worstCaseNetProfitUsdValues)) : null,
    worst_worst_case_net_profit_usd:
      worstCaseNetProfitUsdValues.length > 0 ? round(Math.min(...worstCaseNetProfitUsdValues)) : null,
    decision_reason_ranking: sortedReasonCounts(decisionReasons),
    parser: {
      invalid_line_count: parsed.invalidLineCount,
      skipped_empty_line_count: parsed.skippedEmptyLineCount,
      parsed_record_count: parsed.records.length,
      cycle_record_count: totalCycles,
    },
  };
}

function printSummary(summary) {
  console.log('DOG-MM PAPER MODE SUMMARY');
  console.log(`log_file: ${summary.logFile}`);
  console.log(`total_cycles: ${summary.total_cycles}`);
  console.log(`execute_count: ${summary.execute_count}`);
  console.log(`skip_count: ${summary.skip_count}`);
  console.log(`inconclusive_count: ${summary.inconclusive_count}`);
  console.log(`unknown_decision_count: ${summary.unknown_decision_count}`);
  console.log(`execute_rate_percent: ${summary.execute_rate_percent ?? 'n/a'}`);
  console.log(`skip_rate_percent: ${summary.skip_rate_percent ?? 'n/a'}`);
  console.log(`inconclusive_rate_percent: ${summary.inconclusive_rate_percent ?? 'n/a'}`);
  console.log(`paper_mode_yes_count: ${summary.paper_mode_yes_count}`);
  console.log(`would_broadcast_yes_count: ${summary.would_broadcast_yes_count}`);
  console.log('');
  console.log('QUALITY');
  console.log(`profit_complete_yes_count: ${summary.profit_complete_yes_count}`);
  console.log(`validation_pass_count: ${summary.validation_pass_count}`);
  console.log('');
  console.log('AVERAGES');
  console.log(`avg_input_usd: ${summary.avg_input_usd ?? 'n/a'}`);
  console.log(`avg_expected_output_usd: ${summary.avg_expected_output_usd ?? 'n/a'}`);
  console.log(`avg_min_output_usd: ${summary.avg_min_output_usd ?? 'n/a'}`);
  console.log(`avg_network_fee_usd: ${summary.avg_network_fee_usd ?? 'n/a'}`);
  console.log(`avg_net_profit_usd: ${summary.avg_net_profit_usd ?? 'n/a'}`);
  console.log(`avg_worst_case_net_profit_usd: ${summary.avg_worst_case_net_profit_usd ?? 'n/a'}`);
  console.log(`avg_net_profit_bps: ${summary.avg_net_profit_bps ?? 'n/a'}`);
  console.log('');
  console.log('BY DECISION');
  console.log(`avg_net_profit_usd_execute: ${summary.avg_net_profit_usd_execute ?? 'n/a'}`);
  console.log(`avg_net_profit_usd_skip: ${summary.avg_net_profit_usd_skip ?? 'n/a'}`);
  console.log(`avg_worst_case_net_profit_usd_execute: ${summary.avg_worst_case_net_profit_usd_execute ?? 'n/a'}`);
  console.log(`avg_worst_case_net_profit_usd_skip: ${summary.avg_worst_case_net_profit_usd_skip ?? 'n/a'}`);
  console.log('');
  console.log('EXTREMES');
  console.log(`best_net_profit_usd: ${summary.best_net_profit_usd ?? 'n/a'}`);
  console.log(`worst_net_profit_usd: ${summary.worst_net_profit_usd ?? 'n/a'}`);
  console.log(`best_worst_case_net_profit_usd: ${summary.best_worst_case_net_profit_usd ?? 'n/a'}`);
  console.log(`worst_worst_case_net_profit_usd: ${summary.worst_worst_case_net_profit_usd ?? 'n/a'}`);
  console.log('');
  console.log('TOP DECISION REASONS');

  if (summary.decision_reason_ranking.length === 0) {
    console.log('1. unknown: 0');
  } else {
    summary.decision_reason_ranking.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.reason}: ${entry.count}`);
    });
  }

  console.log('');
  console.log('PARSER');
  console.log(`parsed_record_count: ${summary.parser.parsed_record_count}`);
  console.log(`cycle_record_count: ${summary.parser.cycle_record_count}`);
  console.log(`invalid_line_count: ${summary.parser.invalid_line_count}`);
  console.log(`skipped_empty_line_count: ${summary.parser.skipped_empty_line_count}`);
  console.log(`summary_json: ${OUTPUT_JSON}`);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const parsed = readJsonLinesTolerant(LOG_FILE);
  const summary = buildSummary(LOG_FILE, parsed);

  ensureDir(OUTPUT_JSON);
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(summary, null, 2)}\n`);
  printSummary(summary);
}

try {
  main();
} catch (error) {
  console.error(`DOG-MM paper summary failed: ${error.message}`);
  process.exit(1);
}
