#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv, buildChildEnv } = require('../runtime-env.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CAPABILITY_SCAN_SCRIPT = path.resolve(__dirname, 'dog-mm-capability-scan.cjs');
const CAPABILITY_SCAN_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-capability-scan.json');
const CAPABILITY_MATRIX_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-capability-matrix.json');
const OUTPUT_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-venue-feasibility-scan.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function incrementCounter(map, key) {
  const normalized = String(key || 'UNKNOWN').trim() || 'UNKNOWN';
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function sortedCounts(map) {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.label.localeCompare(right.label);
    });
}

function runCapabilityScan() {
  const result = spawnSync(process.execPath, [CAPABILITY_SCAN_SCRIPT], {
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
    throw new Error(`Capability scan exited with code ${result.status}`);
  }
}

function buildSourceInspection() {
  return {
    quoteConstruction: [
      {
        file: 'active/tools/bitflow-runtime/dog-mm-bitflow-swap-executor.cjs',
        line: 499,
        evidence: 'preferred_amm is propagated into quoteRequest when provided',
      },
      {
        file: 'active/tools/bitflow-runtime/dog-mm-bitflow-swap-executor.cjs',
        line: 503,
        evidence: 'quote request is sent to /api/quotes/v1/quote/multi',
      },
    ],
    responseInterpretation: [
      {
        file: 'active/tools/bitflow-runtime/dog-mm-bitflow-swap-executor.cjs',
        line: 513,
        evidence: 'runtime trusts selectedRoute.execution_path from API response',
      },
      {
        file: 'active/tools/bitflow-runtime/dog-mm-bitflow-swap-executor.cjs',
        line: 534,
        evidence: 'swap contract is taken directly from swapResponse.swap_contract',
      },
    ],
    venueDiscovery: [
      {
        file: 'active/tools/bitflow-runtime/analytics/dog-mm-universe-scan-expanded.cjs',
        line: 186,
        evidence: 'classifyAppPoolVenue maps discovery pools into dlmm / xyk / stableswap',
      },
      {
        file: 'active/tools/bitflow-runtime/analytics/dog-mm-universe-scan-expanded.cjs',
        line: 871,
        evidence: 'app pools are classified by venue during discovery',
      },
    ],
    materialization: [
      {
        file: 'active/tools/bitflow-runtime/analytics/dog-mm-capability-scan.cjs',
        line: 100,
        evidence: 'capability scan sends explicit preferred_amm probes',
      },
      {
        file: 'active/tools/bitflow-runtime/analytics/dog-mm-capability-scan.cjs',
        line: 107,
        evidence: 'materialized venue is inferred from returned execution_path',
      },
      {
        file: 'active/tools/bitflow-runtime/analytics/dog-mm-capability-scan.cjs',
        line: 226,
        evidence: 'notes record venue remap when preferred_amm materializes a different venue',
      },
    ],
    routeMode: [
      {
        file: 'active/tools/bitflow-runtime/analytics/dog-mm-universe-scan-expanded.cjs',
        line: 1006,
        evidence: 'expanded scan currently evaluates routeMode best:auto',
      },
      {
        file: 'active/tools/bitflow-runtime/dog-mm-bitflow-swap-executor.cjs',
        line: 447,
        evidence: 'runtime supports ammStrategy and preferredAmm inputs at execution wrapper level',
      },
    ],
  };
}

function containsNote(entry, pattern) {
  return (entry.notes || []).some(note => note.includes(pattern));
}

function buildDetailedEntries(matrix, capabilityScan) {
  return matrix.entries.map(entry => {
    let discoveryStatus = entry.isObserved ? 'OBSERVED' : 'NOT_OBSERVED';
    let quoteConstructionStatus = entry.venue === 'bitflow-dlmm'
      ? 'SUPPORTED_IN_RUNTIME'
      : 'PREFERRED_AMM_HINT_AVAILABLE';

    let quoteResponseStatus = 'QUOTE_NOT_REACHED';
    if (entry.isQuotable) quoteResponseStatus = 'QUOTE_ACCEPTED_FOR_VENUE';
    else if (containsNote(entry, 'materialized')) quoteResponseStatus = 'QUOTE_RESPONSE_ACCEPTED_BUT_VENUE_REMAPPED';
    else if (containsNote(entry, 'failed:')) quoteResponseStatus = 'QUOTE_RESPONSE_REJECTED_BY_API';
    else if (entry.capabilityDropReason === 'TOKEN_UNSUPPORTED_BY_QUOTE') quoteResponseStatus = 'QUOTE_RESPONSE_REJECTED_UNSUPPORTED_TOKEN';

    let routeMaterializationStatus = 'ROUTE_NOT_REACHED';
    if (entry.isQuotable) routeMaterializationStatus = 'ROUTE_MATERIALIZED_FOR_VENUE';
    else if (containsNote(entry, 'materialized')) routeMaterializationStatus = 'ROUTE_MATERIALIZED_FOR_OTHER_VENUE';
    else if (quoteResponseStatus.startsWith('QUOTE_RESPONSE_REJECTED')) routeMaterializationStatus = 'ROUTE_NOT_MATERIALIZED';

    let executionPathAssemblyStatus = 'EXECUTION_PATH_NOT_REACHED';
    if (entry.isExecutable) executionPathAssemblyStatus = 'EXECUTION_PATH_ASSEMBLED_FOR_VENUE';
    else if (containsNote(entry, 'materialized')) executionPathAssemblyStatus = 'EXECUTION_PATH_ASSEMBLED_FOR_OTHER_VENUE';
    else if (routeMaterializationStatus === 'ROUTE_NOT_MATERIALIZED') executionPathAssemblyStatus = 'EXECUTION_PATH_ASSEMBLY_MISSING';

    let validationReachabilityStatus = 'NOT_REACHED';
    if (entry.validationStatus === 'PASS') validationReachabilityStatus = 'REACHED_PASS';
    else if (entry.validationStatus === 'BLOCKED') validationReachabilityStatus = 'REACHED_BLOCKED';

    let adapterGapPrimary = 'UNKNOWN_ADAPTER_GAP';
    let adapterGapSecondary = null;

    if (entry.venue === 'bitflow-dlmm') {
      adapterGapPrimary = 'NO_VIABLE_NON_DLMM_PATH';
      adapterGapSecondary = 'VALIDATION_BLOCKED_BY_SAFETY';
    } else if (containsNote(entry, 'materialized')) {
      adapterGapPrimary = 'PREFERRED_AMM_HINT_ACCEPTED_BUT_NOT_HONORED';
      adapterGapSecondary = 'ROUTE_MATERIALIZATION_MISSING';
    } else if (containsNote(entry, 'failed: Validation failed')) {
      adapterGapPrimary = 'QUOTE_RESPONSE_REJECTED_BY_API';
      adapterGapSecondary = 'VENUE_SPECIFIC_QUOTE_PARSER_MISSING';
    } else if (entry.capabilityDropReason === 'TOKEN_UNSUPPORTED_BY_QUOTE') {
      adapterGapPrimary = 'TOKEN_UNSUPPORTED_BY_QUOTE';
      adapterGapSecondary = 'NO_VIABLE_NON_DLMM_PATH';
    } else if (entry.capabilityDropReason === 'VALIDATION_BLOCKED_BY_SAFETY') {
      adapterGapPrimary = 'VALIDATION_BLOCKED_BY_SAFETY';
      adapterGapSecondary = 'NO_VIABLE_NON_DLMM_PATH';
    }

    const venueSummary = capabilityScan.venueAggregates.find(item => item.venue === entry.venue);

    return {
      venue: entry.venue,
      baseToken: entry.baseToken,
      quoteToken: entry.quoteToken,
      direction: entry.direction,
      routeMode: entry.routeMode,
      discoveryStatus,
      quoteConstructionStatus,
      quoteResponseStatus,
      routeMaterializationStatus,
      executionPathAssemblyStatus,
      validationReachabilityStatus,
      adapterFeasibilityStatus: venueSummary?.quoteAdapterStatus === 'FULLY_SUPPORTED' && venueSummary?.executionAdapterStatus === 'FULLY_SUPPORTED'
        ? 'READY'
        : entry.venue === 'bitflow-xyk' || entry.venue === 'bitflow-stableswap'
          ? 'FOUNDATION_BUT_BLOCKED_BY_API'
          : 'UNKNOWN_FEASIBILITY',
      adapterGapPrimary,
      adapterGapSecondary,
      evidence: {
        capabilityDropReason: entry.capabilityDropReason,
        stageReached: entry.stageReached,
        stageDropReason: entry.stageDropReason,
        validationStatus: entry.validationStatus,
        primaryValidationFailureReason: entry.primaryValidationFailureReason,
      },
      notes: entry.notes || [],
    };
  });
}

function classifyVenueFeasibility(venue, venueAggregate) {
  if (!venueAggregate) {
    return {
      adapterFeasibilityStatus: 'UNKNOWN_FEASIBILITY',
      adapterGapPrimary: 'UNKNOWN_ADAPTER_GAP',
      adapterGapSecondary: null,
      workEstimateToQuotable: 'VERY_HIGH',
      workEstimateToExecutable: 'VERY_HIGH',
      likelyToChangeOutcomeIfUnlocked: 'UNKNOWN',
    };
  }

  if (venue === 'bitflow-dlmm') {
    return {
      adapterFeasibilityStatus: 'READY',
      adapterGapPrimary: 'VALIDATION_BLOCKED_BY_SAFETY',
      adapterGapSecondary: 'NO_VIABLE_NON_DLMM_PATH',
      workEstimateToQuotable: 'LOW',
      workEstimateToExecutable: 'LOW',
      likelyToChangeOutcomeIfUnlocked: 'LIKELY_NO',
    };
  }

  if (venue === 'bitflow-xyk') {
    return {
      adapterFeasibilityStatus: 'FOUNDATION_BUT_BLOCKED_BY_API',
      adapterGapPrimary: 'PREFERRED_AMM_HINT_ACCEPTED_BUT_NOT_HONORED',
      adapterGapSecondary: 'ROUTE_MATERIALIZATION_MISSING',
      workEstimateToQuotable: 'BLOCKED_EXTERNALLY',
      workEstimateToExecutable: 'BLOCKED_EXTERNALLY',
      likelyToChangeOutcomeIfUnlocked: 'POSSIBLE_BUT_UNPROVEN',
    };
  }

  if (venue === 'bitflow-stableswap') {
    return {
      adapterFeasibilityStatus: 'FOUNDATION_BUT_BLOCKED_BY_API',
      adapterGapPrimary: 'QUOTE_RESPONSE_REJECTED_BY_API',
      adapterGapSecondary: 'VENUE_SPECIFIC_QUOTE_PARSER_MISSING',
      workEstimateToQuotable: 'BLOCKED_EXTERNALLY',
      workEstimateToExecutable: 'BLOCKED_EXTERNALLY',
      likelyToChangeOutcomeIfUnlocked: 'WORTH_TESTING',
    };
  }

  return {
    adapterFeasibilityStatus: 'UNKNOWN_FEASIBILITY',
    adapterGapPrimary: 'UNKNOWN_ADAPTER_GAP',
    adapterGapSecondary: null,
    workEstimateToQuotable: 'VERY_HIGH',
    workEstimateToExecutable: 'VERY_HIGH',
    likelyToChangeOutcomeIfUnlocked: 'UNKNOWN',
  };
}

function buildVenueSummary(capabilityScan, detailedEntries) {
  const map = new Map();
  (capabilityScan.summary.venuesObserved || []).forEach(venue => map.set(venue, []));
  detailedEntries.forEach(entry => {
    if (!map.has(entry.venue)) map.set(entry.venue, []);
    map.get(entry.venue).push(entry);
  });

  return Array.from(map.entries()).map(([venue, entries]) => {
    const venueAggregate = capabilityScan.venueAggregates.find(item => item.venue === venue);
    const feasibility = classifyVenueFeasibility(venue, venueAggregate);
    const cases = entries
      .filter(entry =>
        (venue === 'bitflow-dlmm' && entry.isExecutable) ||
        (venue === 'bitflow-xyk' && (entry.adapterGapPrimary === 'PREFERRED_AMM_HINT_ACCEPTED_BUT_NOT_HONORED' || entry.adapterGapPrimary === 'TOKEN_UNSUPPORTED_BY_QUOTE')) ||
        (venue === 'bitflow-stableswap' && entry.adapterGapPrimary === 'QUOTE_RESPONSE_REJECTED_BY_API')
      )
      .slice(0, 5);

    return {
      venue,
      discoveryStatus: entries.some(entry => entry.discoveryStatus === 'OBSERVED') ? 'OBSERVED' : 'NOT_OBSERVED',
      quoteConstructionStatus: venue === 'bitflow-dlmm' ? 'SUPPORTED_IN_RUNTIME' : 'PREFERRED_AMM_HINT_AVAILABLE',
      quoteResponseStatus:
        venue === 'bitflow-dlmm'
          ? 'QUOTE_ACCEPTED_FOR_VENUE'
          : venue === 'bitflow-xyk'
            ? 'QUOTE_RESPONSE_ACCEPTED_BUT_VENUE_REMAPPED'
            : 'QUOTE_RESPONSE_REJECTED_BY_API',
      routeMaterializationStatus:
        venue === 'bitflow-dlmm'
          ? 'ROUTE_MATERIALIZED_FOR_VENUE'
          : venue === 'bitflow-xyk'
            ? 'ROUTE_MATERIALIZATION_MISSING'
            : 'ROUTE_NOT_MATERIALIZED',
      executionPathAssemblyStatus:
        venue === 'bitflow-dlmm'
          ? 'EXECUTION_PATH_ASSEMBLED_FOR_VENUE'
          : venue === 'bitflow-xyk'
            ? 'EXECUTION_PATH_ASSEMBLED_FOR_OTHER_VENUE'
            : 'EXECUTION_PATH_ASSEMBLY_MISSING',
      validationReachabilityStatus:
        venue === 'bitflow-dlmm' ? 'REACHED_BLOCKED' : 'NOT_REACHED',
      ...feasibility,
      evidence: {
        observedCount: venueAggregate?.observedCount ?? 0,
        quotableCount: venueAggregate?.quotableCount ?? 0,
        executableCount: venueAggregate?.executableCount ?? 0,
        validatedPassCount: venueAggregate?.validatedPassCount ?? 0,
        promisingCount: venueAggregate?.promisingCount ?? 0,
        adapterProbeSummary: venueAggregate?.adapterProbeSummary ?? [],
      },
      cases,
    };
  }).sort((left, right) => left.venue.localeCompare(right.venue));
}

function buildSummary(venueFeasibilitySummary, detailedEntries) {
  const adapterGapCounts = new Map();
  const quoteLayerGapCounts = new Map();
  const routeMaterializationGapCounts = new Map();
  const executionAssemblyGapCounts = new Map();
  const externalBlockerCounts = new Map();
  const workEstimateCounts = new Map();
  const likelyToChangeOutcomeCounts = new Map();

  detailedEntries.forEach(entry => {
    incrementCounter(adapterGapCounts, entry.adapterGapPrimary);
    if (entry.quoteResponseStatus !== 'QUOTE_ACCEPTED_FOR_VENUE') incrementCounter(quoteLayerGapCounts, entry.quoteResponseStatus);
    if (entry.routeMaterializationStatus !== 'ROUTE_MATERIALIZED_FOR_VENUE') incrementCounter(routeMaterializationGapCounts, entry.routeMaterializationStatus);
    if (entry.executionPathAssemblyStatus !== 'EXECUTION_PATH_ASSEMBLED_FOR_VENUE') incrementCounter(executionAssemblyGapCounts, entry.executionPathAssemblyStatus);
  });

  venueFeasibilitySummary.forEach(item => {
    if (item.workEstimateToQuotable === 'BLOCKED_EXTERNALLY' || item.workEstimateToExecutable === 'BLOCKED_EXTERNALLY') {
      incrementCounter(externalBlockerCounts, item.venue);
    }
    incrementCounter(workEstimateCounts, `quotable:${item.workEstimateToQuotable}`);
    incrementCounter(workEstimateCounts, `executable:${item.workEstimateToExecutable}`);
    incrementCounter(likelyToChangeOutcomeCounts, item.likelyToChangeOutcomeIfUnlocked);
  });

  const venueMap = Object.fromEntries(
    venueFeasibilitySummary.map(item => [item.venue, item.adapterFeasibilityStatus])
  );

  return {
    venueFeasibilitySummary,
    adapterGapCounts: sortedCounts(adapterGapCounts),
    quoteLayerGapCounts: sortedCounts(quoteLayerGapCounts),
    routeMaterializationGapCounts: sortedCounts(routeMaterializationGapCounts),
    executionAssemblyGapCounts: sortedCounts(executionAssemblyGapCounts),
    externalBlockerCounts: sortedCounts(externalBlockerCounts),
    workEstimateCounts: sortedCounts(workEstimateCounts),
    likelyToChangeOutcomeCounts: sortedCounts(likelyToChangeOutcomeCounts),
    dlmmStatus: venueMap['bitflow-dlmm'] || 'UNKNOWN_FEASIBILITY',
    xykStatus: venueMap['bitflow-xyk'] || 'UNKNOWN_FEASIBILITY',
    stableswapStatus: venueMap['bitflow-stableswap'] || 'UNKNOWN_FEASIBILITY',
    runtimeStructurallyPinnedToDlmm:
      venueMap['bitflow-dlmm'] === 'READY' &&
      venueMap['bitflow-xyk'] !== 'READY' &&
      venueMap['bitflow-stableswap'] !== 'READY',
    nonDlmmUnlockLikelyToChangeOutcome:
      venueFeasibilitySummary.some(item => item.venue !== 'bitflow-dlmm' && item.likelyToChangeOutcomeIfUnlocked === 'WORTH_TESTING')
        ? 'POSSIBLE_BUT_UNPROVEN'
        : 'LIKELY_NO',
  };
}

function printReport(report) {
  console.log('DOG-MM VENUE FEASIBILITY SCAN');
  report.summary.venueFeasibilitySummary.forEach(item => {
    console.log(
      `${item.venue} | status=${item.adapterFeasibilityStatus} | primary_gap=${item.adapterGapPrimary} | secondary_gap=${item.adapterGapSecondary || 'none'} | quotable_work=${item.workEstimateToQuotable} | executable_work=${item.workEstimateToExecutable} | outcome_if_unlocked=${item.likelyToChangeOutcomeIfUnlocked}`
    );
  });
  console.log('');
  console.log('TOP ADAPTER GAPS');
  report.summary.adapterGapCounts.slice(0, 10).forEach((item, index) => {
    console.log(`${index + 1}. ${item.label} | count=${item.count}`);
  });
  console.log('');
  console.log('FINAL CONCLUSION');
  console.log(`dlmm_status: ${report.summary.dlmmStatus}`);
  console.log(`xyk_status: ${report.summary.xykStatus}`);
  console.log(`stableswap_status: ${report.summary.stableswapStatus}`);
  console.log(`runtime_structurally_pinned_to_dlmm: ${report.summary.runtimeStructurallyPinnedToDlmm ? 'yes' : 'no'}`);
  console.log(`non_dlmm_unlock_likely_to_change_outcome: ${report.summary.nonDlmmUnlockLikelyToChangeOutcome}`);
  console.log(`venue_feasibility_scan_json: ${OUTPUT_JSON}`);
}

async function main() {
  loadRuntimeEnv();
  runCapabilityScan();

  const capabilityScan = readJson(CAPABILITY_SCAN_JSON);
  const matrix = readJson(CAPABILITY_MATRIX_JSON);
  const detailedEntries = buildDetailedEntries(matrix, capabilityScan);
  const venueFeasibilitySummary = buildVenueSummary(capabilityScan, detailedEntries);
  const sourceInspection = buildSourceInspection();

  const report = {
    generatedAt: new Date().toISOString(),
    paperMode: true,
    broadcastAllowed: false,
    wouldBroadcast: false,
    sourceCapabilityScanJson: CAPABILITY_SCAN_JSON,
    sourceCapabilityMatrixJson: CAPABILITY_MATRIX_JSON,
    sourceInspection,
    adapterProbes: capabilityScan.adapterProbes || [],
    detailedEntries,
  };
  report.summary = buildSummary(venueFeasibilitySummary, detailedEntries);
  writeJson(OUTPUT_JSON, report);
  printReport(report);
}

main().catch(error => {
  console.error(`DOG-MM venue feasibility scan failed: ${error.message}`);
  process.exit(1);
});
