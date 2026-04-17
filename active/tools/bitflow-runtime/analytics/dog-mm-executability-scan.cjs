#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv, buildChildEnv } = require('../runtime-env.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const EXPANDED_SCAN_SCRIPT = path.resolve(__dirname, 'dog-mm-universe-scan-expanded.cjs');
const EXPANDED_SCAN_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-universe-scan-expanded.json');
const OUTPUT_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-executability-scan.json');

const STAGE = {
  OBSERVED: 'OBSERVED',
  QUOTABLE: 'QUOTABLE',
  ELIGIBLE: 'ELIGIBLE',
  EXECUTABLE: 'EXECUTABLE',
  VALIDATED_PASS: 'VALIDATED_PASS',
  VALIDATED_BLOCKED: 'VALIDATED_BLOCKED',
  PROMISING: 'PROMISING',
  REJECTED_PRE_QUOTE: 'REJECTED_PRE_QUOTE',
  REJECTED_PRE_EXECUTION: 'REJECTED_PRE_EXECUTION',
  REJECTED_POST_VALIDATION: 'REJECTED_POST_VALIDATION',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function incrementCounter(map, key) {
  const normalized = String(key || 'UNKNOWN').trim() || 'UNKNOWN';
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function sortedCounts(map) {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });
}

function runExpandedScan() {
  const result = spawnSync(process.execPath, [EXPANDED_SCAN_SCRIPT], {
    cwd: ROOT,
    stdio: 'pipe',
    env: buildChildEnv(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Expanded universe scan exited with code ${result.status}`);
  }
}

function mapQuoteDropReason(reason) {
  switch (reason) {
    case 'DIRECTION_UNSUPPORTED':
      return 'TOKEN_UNSUPPORTED_BY_QUOTE';
    case 'QUOTE_SOURCE_MISSING':
      return 'QUOTE_SOURCE_UNAVAILABLE';
    case 'ROUTE_UNAVAILABLE':
      return 'PAIR_UNSUPPORTED_BY_QUOTE';
    case 'EXECUTION_PATH_UNRESOLVED':
      return 'EXECUTION_PATH_NOT_MATERIALIZED';
    case 'POOL_UNAVAILABLE':
      return 'POOL_OBSERVED_BUT_NOT_EXECUTABLE';
    case 'VENUE_UNAVAILABLE':
      return 'VENUE_OBSERVED_BUT_NOT_QUOTABLE';
    case 'TOKEN_UNRESOLVED':
      return 'TOKEN_UNSUPPORTED_BY_QUOTE';
    default:
      return 'UNKNOWN_STAGE_DROP';
  }
}

function groupResultsByPair(results) {
  const grouped = new Map();
  results.forEach(result => {
    if (!grouped.has(result.pairId)) grouped.set(result.pairId, []);
    grouped.get(result.pairId).push(result);
  });
  return grouped;
}

function pickStageForPair(pair, pairResults) {
  if (pairResults.length === 0) {
    return {
      stageReached: STAGE.REJECTED_PRE_QUOTE,
      stageDropReason: mapQuoteDropReason(pair.universeExclusionReason),
      quoteSupportStatus: 'NOT_QUOTABLE',
      executionSupportStatus: 'NOT_EXECUTABLE',
    };
  }

  const hasExecutable = pairResults.length > 0;
  const hasValidatedPass = pairResults.some(item => item.validationStatus === 'PASS');
  const hasValidatedBlocked = pairResults.some(item => item.validationStatus === 'BLOCKED');
  const hasPromising = pairResults.some(
    item =>
      item.validationStatus === 'PASS' &&
      item.isEconomicallyPositiveExpected === true &&
      item.isEconomicallyPositiveWorstCase === true
  );

  if (hasPromising) {
    return {
      stageReached: STAGE.PROMISING,
      stageDropReason: null,
      quoteSupportStatus: 'QUOTABLE',
      executionSupportStatus: 'EXECUTABLE',
    };
  }
  if (hasValidatedPass) {
    return {
      stageReached: STAGE.VALIDATED_PASS,
      stageDropReason: null,
      quoteSupportStatus: 'QUOTABLE',
      executionSupportStatus: 'EXECUTABLE',
    };
  }
  if (hasValidatedBlocked) {
    return {
      stageReached: STAGE.VALIDATED_BLOCKED,
      stageDropReason: pairResults[0].primaryValidationFailureReason || 'VALIDATION_BLOCKED_AFTER_QUOTE',
      quoteSupportStatus: 'QUOTABLE',
      executionSupportStatus: 'EXECUTABLE',
    };
  }
  if (hasExecutable) {
    return {
      stageReached: STAGE.EXECUTABLE,
      stageDropReason: 'VALIDATION_BLOCKED_AFTER_QUOTE',
      quoteSupportStatus: 'QUOTABLE',
      executionSupportStatus: 'EXECUTABLE',
    };
  }
  return {
    stageReached: STAGE.REJECTED_PRE_EXECUTION,
    stageDropReason: 'UNKNOWN_STAGE_DROP',
    quoteSupportStatus: 'QUOTABLE',
    executionSupportStatus: 'NOT_EXECUTABLE',
  };
}

function addStageCount(container, key, stage) {
  if (!container.has(key)) container.set(key, new Map());
  incrementCounter(container.get(key), stage);
}

function materializeStageCounts(container) {
  return Array.from(container.entries())
    .map(([label, stages]) => ({
      label,
      stages: sortedCounts(stages),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildVenueGap(scan) {
  const observed = new Set(scan.discovery.venuesObserved || []);
  const quotable = new Set(scan.funnel.venuesQuotableByCurrentRuntime || []);
  const executable = new Set(scan.funnel.venuesExecutableByCurrentRuntime || []);
  return {
    observedOnly: Array.from(observed).filter(item => !quotable.has(item)).sort(),
    quotableButNotExecutable: Array.from(quotable).filter(item => !executable.has(item)).sort(),
    executable: Array.from(executable).sort(),
  };
}

function buildTokenGap(pairFunnel) {
  const tokens = new Map();
  pairFunnel.forEach(item => {
    [item.baseToken, item.quoteToken].forEach(symbol => {
      if (!tokens.has(symbol)) {
        tokens.set(symbol, {
          symbol,
          observed: 0,
          quotable: 0,
          executable: 0,
          validatedBlocked: 0,
          validatedPass: 0,
          promising: 0,
        });
      }
      const entry = tokens.get(symbol);
      entry.observed += 1;
      if (['QUOTABLE', 'ELIGIBLE', 'EXECUTABLE', 'VALIDATED_PASS', 'VALIDATED_BLOCKED', 'PROMISING'].includes(item.stageReached)) {
        entry.quotable += 1;
      }
      if (['EXECUTABLE', 'VALIDATED_PASS', 'VALIDATED_BLOCKED', 'PROMISING'].includes(item.stageReached)) {
        entry.executable += 1;
      }
      if (item.stageReached === 'VALIDATED_BLOCKED') entry.validatedBlocked += 1;
      if (item.stageReached === 'VALIDATED_PASS') entry.validatedPass += 1;
      if (item.stageReached === 'PROMISING') entry.promising += 1;
    });
  });
  return Array.from(tokens.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function buildPairFunnel(expanded) {
  const resultsByPair = groupResultsByPair(expanded.results || []);
  const pairFunnel = (expanded.discovery.pairsConsidered || []).map(pair => {
    const pairResults = resultsByPair.get(pair.pairId) || [];
    const stage = pickStageForPair(pair, pairResults);
    const firstResult = pairResults[0] || null;
    return {
      pairId: pair.pairId,
      baseToken: pair.baseToken,
      quoteToken: pair.quoteToken,
      direction: pair.direction,
      venueObserved: unique([
        ...(expanded.discovery.tokensConsidered.find(t => t.symbol === pair.baseToken)?.venuesObserved || []),
        ...(expanded.discovery.tokensConsidered.find(t => t.symbol === pair.quoteToken)?.venuesObserved || []),
      ]),
      venueQuotable: firstResult?.venue || null,
      venueExecutable: firstResult?.venue || null,
      poolObserved: unique([
        ...(expanded.discovery.tokensConsidered.find(t => t.symbol === pair.baseToken)?.poolSymbolsObserved || []),
        ...(expanded.discovery.tokensConsidered.find(t => t.symbol === pair.quoteToken)?.poolSymbolsObserved || []),
      ]),
      poolExecutable: unique(pairResults.map(item => item.poolId).filter(Boolean)),
      routeMode: pair.routeMode,
      stageReached: stage.stageReached,
      stageDropReason: stage.stageDropReason,
      quoteSupportStatus: stage.quoteSupportStatus,
      executionSupportStatus: stage.executionSupportStatus,
      tokenResolutionStatus: pair.tokenResolutionStatus,
      pairResolutionStatus: pair.pairResolutionStatus,
      routeResolutionStatus: pair.routeResolutionStatus,
      universeInclusionReason: pair.universeInclusionReason,
      universeExclusionReason: pair.universeExclusionReason,
      validationStatus: firstResult?.validationStatus || null,
      validationFailureReason: firstResult?.validationFailureReason || null,
      validationFailureCategory: firstResult?.validationFailureCategory || null,
      primaryValidationFailureReason: firstResult?.primaryValidationFailureReason || null,
      secondaryValidationFailureReasons: firstResult?.secondaryValidationFailureReasons || [],
      expectedNetProfitUsd: firstResult?.expectedNetProfitUsd ?? null,
      worstCaseNetProfitUsd: firstResult?.worstCaseNetProfitUsd ?? null,
      isEconomicallyPositiveExpected: firstResult?.isEconomicallyPositiveExpected ?? false,
      isEconomicallyPositiveWorstCase: firstResult?.isEconomicallyPositiveWorstCase ?? false,
      resultCount: pairResults.length,
    };
  });
  return pairFunnel;
}

function buildSummary(expanded, pairFunnel) {
  const venueStageCounts = new Map();
  const pairStageCounts = new Map();
  const tokenStageCounts = new Map();
  const routeModeStageCounts = new Map();
  const stageDropReasonCounts = new Map();

  pairFunnel.forEach(item => {
    item.venueObserved.forEach(venue => addStageCount(venueStageCounts, venue, STAGE.OBSERVED));
    if (item.venueQuotable) addStageCount(venueStageCounts, item.venueQuotable, STAGE.QUOTABLE);
    if (item.stageReached === STAGE.VALIDATED_BLOCKED || item.stageReached === STAGE.VALIDATED_PASS || item.stageReached === STAGE.EXECUTABLE || item.stageReached === STAGE.PROMISING) {
      addStageCount(venueStageCounts, item.venueExecutable || item.venueQuotable || 'unknown', STAGE.EXECUTABLE);
    }

    addStageCount(pairStageCounts, item.pairId, item.stageReached);
    addStageCount(routeModeStageCounts, item.routeMode || 'best:auto', item.stageReached);
    addStageCount(tokenStageCounts, item.baseToken, item.stageReached);
    addStageCount(tokenStageCounts, item.quoteToken, item.stageReached);
    if (item.stageDropReason) incrementCounter(stageDropReasonCounts, item.stageDropReason);
  });

  const venuesObserved = unique((expanded.summary.venuesObserved || []).slice());
  const venuesQuotable = unique(pairFunnel.map(item => item.venueQuotable).filter(Boolean));
  const venuesExecutable = unique(
    pairFunnel
      .filter(item => ['EXECUTABLE', 'VALIDATED_PASS', 'VALIDATED_BLOCKED', 'PROMISING'].includes(item.stageReached))
      .map(item => item.venueExecutable || item.venueQuotable)
      .filter(Boolean)
  );

  const poolsObserved = unique([
    ...((expanded.discovery.poolsObserved?.bff || []).map(item => item.poolToken || item.poolSymbol)),
    ...((expanded.discovery.poolsObserved?.app || []).map(item => item.poolToken || item.poolSymbol)),
  ]);
  const poolsQuotable = unique(
    pairFunnel
      .filter(item => ['QUOTABLE', 'ELIGIBLE', 'EXECUTABLE', 'VALIDATED_PASS', 'VALIDATED_BLOCKED', 'PROMISING'].includes(item.stageReached))
      .flatMap(item => item.poolExecutable || [])
  );
  const poolsExecutable = unique(
    pairFunnel
      .filter(item => ['EXECUTABLE', 'VALIDATED_PASS', 'VALIDATED_BLOCKED', 'PROMISING'].includes(item.stageReached))
      .flatMap(item => item.poolExecutable || [])
  );

  const pathsObserved = unique(expanded.discovery.pathsObserved || []);
  const pathsExecutable = unique(
    (expanded.results || [])
      .map(item => item.pathSignature)
      .filter(Boolean)
  );

  const observedUniverseCount = pairFunnel.length;
  const quotableUniverseCount = pairFunnel.filter(item => item.quoteSupportStatus === 'QUOTABLE').length;
  const eligibleUniverseCount = pairFunnel.filter(item =>
    ['QUOTABLE', 'ELIGIBLE', 'EXECUTABLE', 'VALIDATED_PASS', 'VALIDATED_BLOCKED', 'PROMISING'].includes(item.stageReached)
  ).length;
  const executableUniverseCount = pairFunnel.filter(item =>
    ['EXECUTABLE', 'VALIDATED_PASS', 'VALIDATED_BLOCKED', 'PROMISING'].includes(item.stageReached)
  ).length;
  const validatedPassCount = pairFunnel.filter(item => item.stageReached === STAGE.VALIDATED_PASS).length;
  const validatedBlockedCount = pairFunnel.filter(item => item.stageReached === STAGE.VALIDATED_BLOCKED).length;
  const promisingCount = pairFunnel.filter(item => item.stageReached === STAGE.PROMISING).length;

  return {
    observedUniverseCount,
    quotableUniverseCount,
    eligibleUniverseCount,
    executableUniverseCount,
    validatedPassCount,
    validatedBlockedCount,
    promisingCount,
    venuesObserved,
    venuesQuotableByCurrentRuntime: venuesQuotable,
    venuesEligibleByCurrentRuntime: venuesQuotable,
    venuesExecutableByCurrentRuntime: venuesExecutable,
    poolsObserved,
    poolsQuotable,
    poolsExecutable,
    pathsObserved,
    pathsExecutable,
    venueStageCounts: materializeStageCounts(venueStageCounts),
    pairStageCounts: materializeStageCounts(pairStageCounts),
    tokenStageCounts: materializeStageCounts(tokenStageCounts),
    routeModeStageCounts: materializeStageCounts(routeModeStageCounts),
    stageDropReasonCounts: sortedCounts(stageDropReasonCounts),
    gapByVenue: buildVenueGap({ discovery: expanded.summary, funnel: { venuesQuotableByCurrentRuntime: venuesQuotable, venuesExecutableByCurrentRuntime: venuesExecutable } }),
    gapByToken: buildTokenGap(pairFunnel),
    comparisonWithPhase52: {
      previousObservedUniverseCount: expanded.summary.pairsTotalConsidered,
      previousEligibleUniverseCount: expanded.summary.pairsEligibleCount,
      previousCandidateCount: expanded.summary.candidateCount,
      currentObservedUniverseCount: observedUniverseCount,
      currentQuotableUniverseCount: quotableUniverseCount,
      currentEligibleUniverseCount: eligibleUniverseCount,
      currentExecutableUniverseCount: executableUniverseCount,
      currentValidatedBlockedCount: validatedBlockedCount,
      currentValidatedPassCount: validatedPassCount,
      currentPromisingCount: promisingCount,
      previousVenuesObserved: expanded.summary.venuesObserved,
      currentVenuesExecutableByCurrentRuntime: venuesExecutable,
    },
  };
}

function printReport(report) {
  console.log('DOG-MM EXECUTABILITY SCAN');
  console.log(`observed_universe_count: ${report.summary.observedUniverseCount}`);
  console.log(`quotable_universe_count: ${report.summary.quotableUniverseCount}`);
  console.log(`eligible_universe_count: ${report.summary.eligibleUniverseCount}`);
  console.log(`executable_universe_count: ${report.summary.executableUniverseCount}`);
  console.log(`validated_pass_count: ${report.summary.validatedPassCount}`);
  console.log(`validated_blocked_count: ${report.summary.validatedBlockedCount}`);
  console.log(`promising_count: ${report.summary.promisingCount}`);
  console.log('paper_mode_expected: yes');
  console.log('broadcast_allowed_expected: no');
  console.log('');

  console.log('VENUES');
  console.log(`observed: ${report.summary.venuesObserved.join(', ') || 'none'}`);
  console.log(`quotable_by_current_runtime: ${report.summary.venuesQuotableByCurrentRuntime.join(', ') || 'none'}`);
  console.log(`executable_by_current_runtime: ${report.summary.venuesExecutableByCurrentRuntime.join(', ') || 'none'}`);
  console.log('');

  console.log('TOP STAGE DROP REASONS');
  report.summary.stageDropReasonCounts.slice(0, 10).forEach((item, index) => {
    console.log(`${index + 1}. ${item.label} | count=${item.count}`);
  });
  if (report.summary.stageDropReasonCounts.length === 0) console.log('none');
  console.log('');

  console.log('COMPARISON VS PHASE 5.2');
  console.log(`phase52_pairs_total_considered: ${report.summary.comparisonWithPhase52.previousObservedUniverseCount}`);
  console.log(`phase52_pairs_eligible_count: ${report.summary.comparisonWithPhase52.previousEligibleUniverseCount}`);
  console.log(`phase52_candidate_count: ${report.summary.comparisonWithPhase52.previousCandidateCount}`);
  console.log(`current_executable_universe_count: ${report.summary.comparisonWithPhase52.currentExecutableUniverseCount}`);
  console.log(`current_validated_blocked_count: ${report.summary.comparisonWithPhase52.currentValidatedBlockedCount}`);
  console.log(`current_promising_count: ${report.summary.comparisonWithPhase52.currentPromisingCount}`);
  console.log('');

  console.log('FINAL CONCLUSION');
  console.log(`dominant_gap_before_execution: ${report.summary.stageDropReasonCounts[0]?.label || 'none'}`);
  console.log(`venues_observed_but_not_quotable: ${report.summary.gapByVenue.observedOnly.join(', ') || 'none'}`);
  console.log(`venues_quotable_but_not_executable: ${report.summary.gapByVenue.quotableButNotExecutable.join(', ') || 'none'}`);
  console.log(`executability_scan_json: ${OUTPUT_JSON}`);
}

async function main() {
  loadRuntimeEnv();
  runExpandedScan();
  const expanded = readJson(EXPANDED_SCAN_JSON);
  const pairFunnel = buildPairFunnel(expanded);
  const report = {
    generatedAt: new Date().toISOString(),
    paperMode: true,
    broadcastAllowed: false,
    wouldBroadcast: false,
    sourceExpandedScanJson: EXPANDED_SCAN_JSON,
    pairFunnel,
    validatedCandidates: expanded.results || [],
    expandedScanSummary: expanded.summary || {},
  };
  report.summary = buildSummary(expanded, pairFunnel);
  writeJson(OUTPUT_JSON, report);
  printReport(report);
}

main().catch(error => {
  console.error(`DOG-MM executability scan failed: ${error.message}`);
  process.exit(1);
});
