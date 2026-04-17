#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv, buildChildEnv } = require('../runtime-env.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const EXECUTABILITY_SCAN_SCRIPT = path.resolve(__dirname, 'dog-mm-executability-scan.cjs');
const EXPANDED_SCAN_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-universe-scan-expanded.json');
const EXECUTABILITY_SCAN_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-executability-scan.json');
const CAPABILITY_SCAN_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-capability-scan.json');
const CAPABILITY_MATRIX_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-capability-matrix.json');
const QUOTE_MULTI_URL = 'https://bff.bitflowapis.finance/api/quotes/v1/quote/multi';

const VENUE_STATUS = {
  FULLY_SUPPORTED: 'FULLY_SUPPORTED',
  PARTIALLY_SUPPORTED: 'PARTIALLY_SUPPORTED',
  DISCOVERY_ONLY: 'DISCOVERY_ONLY',
  UNSUPPORTED: 'UNSUPPORTED',
  UNKNOWN_ADAPTER_STATE: 'UNKNOWN_ADAPTER_STATE',
};

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

function runScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
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
    throw new Error(`${path.basename(scriptPath)} exited with code ${result.status}`);
  }
}

function classifyMaterializedVenue(executionPath) {
  const labels = unique(
    (executionPath || []).map(step => {
      const value = String(step?.pool_trait || step?.pool_id || '').toLowerCase();
      if (!value) return null;
      if (value.includes('dlmm')) return 'bitflow-dlmm';
      if (value.includes('xyk')) return 'bitflow-xyk';
      if (value.includes('stable')) return 'bitflow-stableswap';
      return 'bitflow-other';
    })
  );
  if (labels.length === 0) return 'none';
  if (labels.length === 1) return labels[0];
  return labels.join('|');
}

function mapPreferredAmmToVenue(preferredAmm) {
  if (preferredAmm === 'dlmm') return 'bitflow-dlmm';
  if (preferredAmm === 'xyk') return 'bitflow-xyk';
  if (preferredAmm === 'stableswap') return 'bitflow-stableswap';
  return preferredAmm;
}

async function fetchQuoteProbe({ inputToken, outputToken, amountIn, preferredAmm }) {
  try {
    const response = await fetch(QUOTE_MULTI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input_token: inputToken,
        output_token: outputToken,
        amount_in: amountIn,
        amm_strategy: 'best',
        preferred_amm: preferredAmm,
        slippage_tolerance: Number(process.env.DOG_MM_SLIPPAGE_TOLERANCE || 3),
      }),
    });
    const json = await response.json();
    const routes = Array.isArray(json?.routes) ? json.routes : [];
    const executionPath = Array.isArray(routes[0]?.execution_path) ? routes[0].execution_path : [];
    const materializedVenue = classifyMaterializedVenue(executionPath);
    return {
      preferredAmm,
      targetVenue: mapPreferredAmmToVenue(preferredAmm),
      statusCode: response.status,
      success: Boolean(response.ok && json?.success),
      routeCount: routes.length,
      materializedVenue,
      materializedPathLength: executionPath.length,
      error: json?.error || null,
      rawRouteSample: routes[0]
        ? {
            total_hops: routes[0].total_hops ?? null,
            route_path: routes[0].route_path || [],
            execution_path: executionPath,
          }
        : null,
    };
  } catch (error) {
    return {
      preferredAmm,
      targetVenue: mapPreferredAmmToVenue(preferredAmm),
      statusCode: null,
      success: false,
      routeCount: 0,
      materializedVenue: 'none',
      materializedPathLength: 0,
      error: error.message,
      rawRouteSample: null,
    };
  }
}

async function buildAdapterProbes(expanded) {
  const corePairs = [
    'STX->USDCx',
    'aeUSDC->USDCx',
    'USDh->USDCx',
  ];
  const pairs = corePairs
    .map(pairId => expanded.discovery.pairsConsidered.find(pair => pair.pairId === pairId))
    .filter(Boolean)
    .map(pair => ({
      pairId: pair.pairId,
      inputToken: pair.inputToken,
      outputToken: pair.outputToken,
      amountIn:
        expanded.results.find(item => item.pairId === pair.pairId)?.amountIn ||
        expanded.discovery.eligiblePairs?.find(item => item.pairId === pair.pairId)?.levels?.[0]?.amountIn ||
        pair.probe?.rawRouteSample?.execution_path?.[0]?.x_in ||
        pair.probe?.rawRouteSample?.execution_path?.[0]?.y_in ||
        '1',
    }));

  const probes = [];
  for (const pair of pairs) {
    for (const preferredAmm of ['dlmm', 'xyk', 'stableswap']) {
      const result = await fetchQuoteProbe({
        inputToken: pair.inputToken,
        outputToken: pair.outputToken,
        amountIn: pair.amountIn,
        preferredAmm,
      });
      probes.push({
        pairId: pair.pairId,
        inputToken: pair.inputToken,
        outputToken: pair.outputToken,
        amountIn: pair.amountIn,
        ...result,
      });
    }
  }
  return probes;
}

function buildCapabilityEntries(expanded, executability, adapterProbes) {
  const entries = [];
  const venuesObserved = unique(expanded.summary.venuesObserved || []);

  (executability.pairFunnel || []).forEach(pair => {
    const pairObservedVenues = unique(pair.venueObserved || []);
    venuesObserved.forEach(venue => {
      if (!pairObservedVenues.includes(venue)) return;

      const isObserved = true;
      const isQuotable = pair.venueQuotable === venue;
      const isExecutable =
        isQuotable &&
        ['EXECUTABLE', 'VALIDATED_PASS', 'VALIDATED_BLOCKED', 'PROMISING'].includes(pair.stageReached);
      const isValidatedPass = pair.stageReached === 'VALIDATED_PASS';
      const isPromising = pair.stageReached === 'PROMISING';

      let capabilityDropReason = null;
      if (!isQuotable) {
        if (pair.universeExclusionReason === 'DIRECTION_UNSUPPORTED') {
          capabilityDropReason = 'TOKEN_UNSUPPORTED_BY_QUOTE';
        } else if (venue === 'bitflow-xyk' || venue === 'bitflow-stableswap') {
          capabilityDropReason = 'DISCOVERY_ONLY_VENUE';
        } else if (pair.universeExclusionReason === 'QUOTE_SOURCE_MISSING') {
          capabilityDropReason = 'QUOTE_ADAPTER_MISSING';
        } else if (pair.universeExclusionReason === 'EXECUTION_PATH_UNRESOLVED') {
          capabilityDropReason = 'EXECUTION_PATH_NOT_MATERIALIZED';
        } else if (pair.universeExclusionReason === 'ROUTE_UNAVAILABLE') {
          capabilityDropReason = 'VENUE_NOT_ROUTED_BY_CURRENT_RUNTIME';
        } else {
          capabilityDropReason = 'UNKNOWN_CAPABILITY_DROP';
        }
      } else if (!isExecutable) {
        capabilityDropReason = 'EXECUTION_ADAPTER_MISSING';
      } else if (pair.validationStatus === 'BLOCKED') {
        if (pair.validationFailureCategory === 'SAFETY') capabilityDropReason = 'VALIDATION_BLOCKED_BY_SAFETY';
        else if (pair.validationFailureCategory === 'LIQUIDITY') capabilityDropReason = 'VALIDATION_BLOCKED_BY_LIQUIDITY';
        else if (pair.validationFailureCategory === 'ECONOMIC') capabilityDropReason = 'VALIDATION_BLOCKED_BY_ECONOMICS';
        else capabilityDropReason = 'UNKNOWN_CAPABILITY_DROP';
      }

      const relevantProbes = adapterProbes.filter(probe => probe.targetVenue === venue && probe.pairId === pair.pairId);
      const notes = [];
      relevantProbes.forEach(probe => {
        if (probe.success && probe.materializedVenue !== venue && probe.materializedVenue !== 'none') {
          notes.push(
            `preferred_amm=${probe.preferredAmm} materialized ${probe.materializedVenue} instead of ${venue}`
          );
        } else if (!probe.success && probe.error) {
          notes.push(`preferred_amm=${probe.preferredAmm} failed: ${probe.error}`);
        }
      });

      entries.push({
        venue,
        baseToken: pair.baseToken,
        quoteToken: pair.quoteToken,
        pairId: pair.pairId,
        direction: pair.direction,
        routeMode: pair.routeMode,
        isObserved,
        isQuotable,
        isExecutable,
        isValidatedPass,
        isPromising,
        quoteSupportStatus: isQuotable ? 'QUOTABLE' : 'NOT_QUOTABLE',
        executionSupportStatus: isExecutable ? 'EXECUTABLE' : 'NOT_EXECUTABLE',
        validationStatus: pair.validationStatus,
        capabilityDropReason,
        stageReached: pair.stageReached,
        stageDropReason: pair.stageDropReason,
        tokenResolutionStatus: pair.tokenResolutionStatus,
        pairResolutionStatus: pair.pairResolutionStatus,
        routeResolutionStatus: pair.routeResolutionStatus,
        universeInclusionReason: pair.universeInclusionReason,
        universeExclusionReason: pair.universeExclusionReason,
        primaryValidationFailureReason: pair.primaryValidationFailureReason,
        secondaryValidationFailureReasons: pair.secondaryValidationFailureReasons,
        expectedNetProfitUsd: pair.expectedNetProfitUsd,
        worstCaseNetProfitUsd: pair.worstCaseNetProfitUsd,
        isEconomicallyPositiveExpected: pair.isEconomicallyPositiveExpected,
        isEconomicallyPositiveWorstCase: pair.isEconomicallyPositiveWorstCase,
        notes,
      });
    });
  });

  return entries;
}

function buildVenueAggregates(entries, adapterProbes, observedVenues) {
  const grouped = new Map();
  observedVenues.forEach(venue => grouped.set(venue, []));
  entries.forEach(entry => {
    if (!grouped.has(entry.venue)) grouped.set(entry.venue, []);
    grouped.get(entry.venue).push(entry);
  });

  return Array.from(grouped.entries())
    .map(([venue, items]) => {
      const dropCounts = new Map();
      items.forEach(item => {
        if (item.capabilityDropReason) incrementCounter(dropCounts, item.capabilityDropReason);
      });

      const probes = adapterProbes.filter(item => item.targetVenue === venue);
      const hasMatchingProbeMaterialization = probes.some(
        probe => probe.success && probe.materializedVenue === venue && probe.routeCount > 0
      );
      const hasFallbackProbeMaterialization = probes.some(
        probe => probe.success && probe.materializedVenue !== venue && probe.materializedVenue !== 'none'
      );

      const observedCount = items.length;
      const quotableCount = items.filter(item => item.isQuotable).length;
      const executableCount = items.filter(item => item.isExecutable).length;
      const validatedPassCount = items.filter(item => item.isValidatedPass).length;
      const promisingCount = items.filter(item => item.isPromising).length;

      let quoteAdapterStatus = VENUE_STATUS.UNKNOWN_ADAPTER_STATE;
      let executionAdapterStatus = VENUE_STATUS.UNKNOWN_ADAPTER_STATE;

      if (quotableCount > 0) quoteAdapterStatus = VENUE_STATUS.FULLY_SUPPORTED;
      else if (hasFallbackProbeMaterialization || observedCount > 0) quoteAdapterStatus = VENUE_STATUS.DISCOVERY_ONLY;
      else quoteAdapterStatus = VENUE_STATUS.UNSUPPORTED;

      if (executableCount > 0) executionAdapterStatus = VENUE_STATUS.FULLY_SUPPORTED;
      else if (quotableCount > 0 || hasMatchingProbeMaterialization) executionAdapterStatus = VENUE_STATUS.PARTIALLY_SUPPORTED;
      else if (observedCount > 0) executionAdapterStatus = VENUE_STATUS.DISCOVERY_ONLY;
      else executionAdapterStatus = VENUE_STATUS.UNSUPPORTED;

      return {
        venue,
        observedCount,
        quotableCount,
        executableCount,
        validatedPassCount,
        promisingCount,
        quoteAdapterStatus,
        executionAdapterStatus,
        dominantCapabilityDropReason: sortedCounts(dropCounts)[0]?.label || null,
        adapterProbeSummary: probes.map(probe => ({
          pairId: probe.pairId,
          preferredAmm: probe.preferredAmm,
          success: probe.success,
          statusCode: probe.statusCode,
          routeCount: probe.routeCount,
          materializedVenue: probe.materializedVenue,
          error: probe.error,
        })),
      };
    })
    .sort((left, right) => left.venue.localeCompare(right.venue));
}

function buildCountsByKey(entries, keyBuilder) {
  const container = new Map();
  entries.forEach(entry => {
    const key = keyBuilder(entry);
    if (!container.has(key)) {
      container.set(key, {
        label: key,
        observedCount: 0,
        quotableCount: 0,
        executableCount: 0,
        validatedPassCount: 0,
        promisingCount: 0,
      });
    }
    const item = container.get(key);
    item.observedCount += 1;
    if (entry.isQuotable) item.quotableCount += 1;
    if (entry.isExecutable) item.executableCount += 1;
    if (entry.isValidatedPass) item.validatedPassCount += 1;
    if (entry.isPromising) item.promisingCount += 1;
  });
  return Array.from(container.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function buildSummary(entries, venueAggregates, expanded, executability) {
  const capabilityDropReasonCounts = new Map();
  entries.forEach(entry => {
    if (entry.capabilityDropReason) incrementCounter(capabilityDropReasonCounts, entry.capabilityDropReason);
  });

  const venuesObserved = unique(expanded.summary.venuesObserved || []);
  const venuesWithQuoteSupport = unique(venueAggregates.filter(item => item.quotableCount > 0).map(item => item.venue));
  const venuesWithExecutionSupport = unique(venueAggregates.filter(item => item.executableCount > 0).map(item => item.venue));

  return {
    venuesObserved,
    venuesWithQuoteSupport,
    venuesWithExecutionSupport,
    venueCapabilityCounts: venueAggregates,
    tokenCapabilityCounts: buildCountsByKey(entries.flatMap(entry => [
      { ...entry, tokenKey: entry.baseToken },
      { ...entry, tokenKey: entry.quoteToken },
    ]), entry => entry.tokenKey),
    pairCapabilityCounts: buildCountsByKey(entries, entry => entry.pairId),
    routeModeCapabilityCounts: buildCountsByKey(entries, entry => entry.routeMode || 'best:auto'),
    capabilityDropReasonCounts: sortedCounts(capabilityDropReasonCounts),
    fullySupportedVenueCount: venueAggregates.filter(item => item.quoteAdapterStatus === VENUE_STATUS.FULLY_SUPPORTED && item.executionAdapterStatus === VENUE_STATUS.FULLY_SUPPORTED).length,
    partiallySupportedVenueCount: venueAggregates.filter(item => item.quoteAdapterStatus === VENUE_STATUS.PARTIALLY_SUPPORTED || item.executionAdapterStatus === VENUE_STATUS.PARTIALLY_SUPPORTED).length,
    discoveryOnlyVenueCount: venueAggregates.filter(item => item.quoteAdapterStatus === VENUE_STATUS.DISCOVERY_ONLY && item.executionAdapterStatus === VENUE_STATUS.DISCOVERY_ONLY).length,
    comparisonWithPhase53: {
      phase53ObservedUniverseCount: executability.summary.observedUniverseCount,
      phase53QuotableUniverseCount: executability.summary.quotableUniverseCount,
      phase53EligibleUniverseCount: executability.summary.eligibleUniverseCount,
      phase53ExecutableUniverseCount: executability.summary.executableUniverseCount,
      phase53ValidatedPassCount: executability.summary.validatedPassCount,
      phase53ValidatedBlockedCount: executability.summary.validatedBlockedCount,
      phase53PromisingCount: executability.summary.promisingCount,
      phase53VenuesObserved: executability.summary.venuesObserved,
      phase53VenuesExecutable: executability.summary.venuesExecutableByCurrentRuntime,
      phase54VenuesWithQuoteSupport: venuesWithQuoteSupport,
      phase54VenuesWithExecutionSupport: venuesWithExecutionSupport,
    },
  };
}

function printReport(report) {
  console.log('DOG-MM CAPABILITY SCAN');
  console.log(`venues_observed: ${report.summary.venuesObserved.join(', ') || 'none'}`);
  console.log(`venues_with_quote_support: ${report.summary.venuesWithQuoteSupport.join(', ') || 'none'}`);
  console.log(`venues_with_execution_support: ${report.summary.venuesWithExecutionSupport.join(', ') || 'none'}`);
  console.log(`fully_supported_venue_count: ${report.summary.fullySupportedVenueCount}`);
  console.log(`partially_supported_venue_count: ${report.summary.partiallySupportedVenueCount}`);
  console.log(`discovery_only_venue_count: ${report.summary.discoveryOnlyVenueCount}`);
  console.log('paper_mode_expected: yes');
  console.log('broadcast_allowed_expected: no');
  console.log('');

  console.log('VENUE CAPABILITY MATRIX');
  report.summary.venueCapabilityCounts.forEach(item => {
    console.log(
      `${item.venue} | observed=${item.observedCount} | quotable=${item.quotableCount} | executable=${item.executableCount} | validated_pass=${item.validatedPassCount} | promising=${item.promisingCount} | quote_adapter=${item.quoteAdapterStatus} | execution_adapter=${item.executionAdapterStatus} | dominant_drop=${item.dominantCapabilityDropReason || 'none'}`
    );
  });
  console.log('');

  console.log('TOP CAPABILITY DROP REASONS');
  report.summary.capabilityDropReasonCounts.slice(0, 10).forEach((item, index) => {
    console.log(`${index + 1}. ${item.label} | count=${item.count}`);
  });
  if (report.summary.capabilityDropReasonCounts.length === 0) console.log('none');
  console.log('');

  console.log('COMPARISON VS PHASE 5.3');
  console.log(`phase53_observed_universe_count: ${report.summary.comparisonWithPhase53.phase53ObservedUniverseCount}`);
  console.log(`phase53_executable_universe_count: ${report.summary.comparisonWithPhase53.phase53ExecutableUniverseCount}`);
  console.log(`phase53_validated_blocked_count: ${report.summary.comparisonWithPhase53.phase53ValidatedBlockedCount}`);
  console.log(`phase54_venues_with_quote_support: ${report.summary.comparisonWithPhase53.phase54VenuesWithQuoteSupport.join(', ') || 'none'}`);
  console.log(`phase54_venues_with_execution_support: ${report.summary.comparisonWithPhase53.phase54VenuesWithExecutionSupport.join(', ') || 'none'}`);
  console.log('');

  console.log('FINAL CONCLUSION');
  console.log(`dlmm_status: ${report.summary.venueCapabilityCounts.find(item => item.venue === 'bitflow-dlmm')?.quoteAdapterStatus || 'unknown'} / ${report.summary.venueCapabilityCounts.find(item => item.venue === 'bitflow-dlmm')?.executionAdapterStatus || 'unknown'}`);
  console.log(`xyk_status: ${report.summary.venueCapabilityCounts.find(item => item.venue === 'bitflow-xyk')?.quoteAdapterStatus || 'unknown'} / ${report.summary.venueCapabilityCounts.find(item => item.venue === 'bitflow-xyk')?.executionAdapterStatus || 'unknown'}`);
  console.log(`stableswap_status: ${report.summary.venueCapabilityCounts.find(item => item.venue === 'bitflow-stableswap')?.quoteAdapterStatus || 'unknown'} / ${report.summary.venueCapabilityCounts.find(item => item.venue === 'bitflow-stableswap')?.executionAdapterStatus || 'unknown'}`);
  console.log(`capability_scan_json: ${CAPABILITY_SCAN_JSON}`);
  console.log(`capability_matrix_json: ${CAPABILITY_MATRIX_JSON}`);
}

async function main() {
  loadRuntimeEnv();
  runScript(EXECUTABILITY_SCAN_SCRIPT);

  const expanded = readJson(EXPANDED_SCAN_JSON);
  const executability = readJson(EXECUTABILITY_SCAN_JSON);
  const adapterProbes = await buildAdapterProbes(expanded);
  const capabilityEntries = buildCapabilityEntries(expanded, executability, adapterProbes);
  const venueAggregates = buildVenueAggregates(capabilityEntries, adapterProbes, unique(expanded.summary.venuesObserved || []));

  const matrixPayload = {
    generatedAt: new Date().toISOString(),
    paperMode: true,
    broadcastAllowed: false,
    wouldBroadcast: false,
    sourceExpandedScanJson: EXPANDED_SCAN_JSON,
    sourceExecutabilityScanJson: EXECUTABILITY_SCAN_JSON,
    adapterProbes,
    venueAggregates,
    entries: capabilityEntries,
  };
  matrixPayload.summary = buildSummary(capabilityEntries, venueAggregates, expanded, executability);

  const scanPayload = {
    generatedAt: matrixPayload.generatedAt,
    paperMode: true,
    broadcastAllowed: false,
    wouldBroadcast: false,
    summary: matrixPayload.summary,
    adapterProbes,
    venueAggregates,
  };

  writeJson(CAPABILITY_MATRIX_JSON, matrixPayload);
  writeJson(CAPABILITY_SCAN_JSON, scanPayload);
  printReport(scanPayload);
}

main().catch(error => {
  console.error(`DOG-MM capability scan failed: ${error.message}`);
  process.exit(1);
});
