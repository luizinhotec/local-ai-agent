#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const CAPABILITY_JSON = path.resolve(STATE_DIR, 'dog-mm-capability-scan.json');
const EXECUTABILITY_JSON = path.resolve(STATE_DIR, 'dog-mm-executability-scan.json');
const ECONOMIC_JSON = path.resolve(STATE_DIR, 'dog-mm-dlmm-economic-analysis.json');
const CLEAN_JSON = path.resolve(__dirname, 'dog-mm-dlmm-economic-analysis-excluding-toxic.json');
const TOXIC_POOLS_JSON = path.resolve(__dirname, 'dog-mm-dlmm-toxic-pools.json');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-market-edge-anomaly-scan.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values, digits = 6) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length === 0) return null;
  return round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length, digits);
}

function stddev(values, digits = 6) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length < 2) return 0;
  const mean = filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
  const variance = filtered.reduce((sum, value) => sum + (value - mean) ** 2, 0) / filtered.length;
  return round(Math.sqrt(variance), digits);
}

function max(values) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length === 0) return null;
  return Math.max(...filtered);
}

function min(values) {
  const filtered = values.filter(Number.isFinite);
  if (filtered.length === 0) return null;
  return Math.min(...filtered);
}

function toRate(numerator, denominator, digits = 6) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return round(numerator / denominator, digits);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function classifyEdgeBucket(summary) {
  if (
    summary.grossPositiveRate >= 0.75 &&
    (summary.avgGrossUsd ?? -Infinity) >= 0.2 &&
    summary.cleanSampleCount >= 3 &&
    summary.cleanGrossPositiveRate >= 0.7 &&
    summary.toxicCoverageRate <= 0.25 &&
    (summary.bestWorstCaseUsd ?? -Infinity) > -0.35
  ) {
    return 'A';
  }

  if (
    summary.grossPositiveRate >= 0.6 &&
    (summary.avgGrossUsd ?? -Infinity) > 0 &&
    (summary.bestWorstCaseUsd ?? -Infinity) > -0.6
  ) {
    return 'B';
  }

  if (
    summary.grossPositiveRate > 0 ||
    (summary.avgGrossUsd ?? 0) > 0 ||
    summary.toxicCoverageRate > 0
  ) {
    return 'C';
  }

  return 'D';
}

function classifyFutureUse(summary) {
  if (summary.bucket === 'A') return 'executavel_no_futuro';
  if (summary.bucket === 'B') return 'observacional';
  return 'enganoso';
}

function buildAnomalyReason(summary) {
  const reasons = [];
  if ((summary.avgGrossUsd ?? 0) > 0.2) reasons.push('gross_edge_relevante');
  if (summary.grossPositiveRate >= 0.75) reasons.push('recorrencia_alta');
  if ((summary.bestWorstCaseUsd ?? -Infinity) > -0.4) reasons.push('worst_case_menos_ruim');
  if (summary.toxicCoverageRate >= 0.5) reasons.push('dependencia_toxica');
  if (summary.cleanSampleCount === 0) reasons.push('sem_amostra_limpa');
  if ((summary.avgHaircutUsd ?? 0) > Math.max((summary.avgGrossUsd ?? 0) * 5, 1)) reasons.push('haircut_desproporcional');
  return reasons.length > 0 ? reasons : ['sem_anomalia_relevante'];
}

function buildMainRisk(summary) {
  if (summary.toxicCoverageRate >= 0.5) return 'TOXIC_POOL_DEPENDENCY';
  if ((summary.avgWorstCaseUsd ?? 0) < -5) return 'WORST_CASE_EXTREME';
  if ((summary.avgHaircutUsd ?? 0) > Math.max((summary.avgGrossUsd ?? 0) * 5, 1)) return 'HAIRCUT_DOMINANT';
  if ((summary.avgNetworkFeeUsd ?? 0) > Math.max((summary.avgGrossUsd ?? 0) * 2, 0.1)) return 'NETWORK_FEE_DOMINANT';
  return summary.dominantRejection || 'NO_EDGE';
}

function compareSummaries(left, right) {
  if (right.grossPositiveRate !== left.grossPositiveRate) return right.grossPositiveRate - left.grossPositiveRate;
  if ((right.avgGrossUsd ?? -Infinity) !== (left.avgGrossUsd ?? -Infinity)) {
    return (right.avgGrossUsd ?? -Infinity) - (left.avgGrossUsd ?? -Infinity);
  }
  if (left.toxicCoverageRate !== right.toxicCoverageRate) return left.toxicCoverageRate - right.toxicCoverageRate;
  return (right.bestWorstCaseUsd ?? -Infinity) - (left.bestWorstCaseUsd ?? -Infinity);
}

function main() {
  const capability = readJson(CAPABILITY_JSON);
  const executability = readJson(EXECUTABILITY_JSON);
  const economic = readJson(ECONOMIC_JSON);
  const clean = readJson(CLEAN_JSON);
  const toxicPools = new Set((readJson(TOXIC_POOLS_JSON).toxic_pools || []).filter(Boolean));

  const pairCapabilityRows = capability.summary?.pairCapabilityCounts || [];
  const allPairs = unique(pairCapabilityRows.map(row => row.label));
  const executablePairs = new Set(
    pairCapabilityRows.filter(row => Number(row.executableCount) > 0).map(row => row.label)
  );

  const opportunities = Array.isArray(economic.opportunities) ? economic.opportunities : [];
  const cleanOpportunities = Array.isArray(clean.remaining_opportunities) ? clean.remaining_opportunities : [];
  const excludedOpportunities = Array.isArray(clean.excluded_opportunities) ? clean.excluded_opportunities : [];

  const summaries = allPairs.map(pair => {
    const pairRow = pairCapabilityRows.find(row => row.label === pair) || {};
    const fullRows = opportunities.filter(item => item.pair === pair);
    const cleanRows = cleanOpportunities.filter(item => item.pair === pair);
    const excludedRows = excludedOpportunities.filter(item => item.pair === pair);
    const representative = [...fullRows].sort((left, right) => (right.gross_edge ?? -Infinity) - (left.gross_edge ?? -Infinity))[0] || null;
    const representativePools = unique([
      ...(representative?.execution_pools || []),
      ...excludedRows.flatMap(item => item.toxic_pool_hits || []),
    ]);

    const grossEdges = fullRows.map(item => Number(item.gross_edge));
    const worstEdges = fullRows.map(item => Number(item.worst_case_edge));
    const netEdges = fullRows.map(item => Number(item.net_edge));
    const slippageCosts = fullRows.map(item => Number(item.slippage_cost));
    const poolFees = fullRows.map(item => Number(item.pool_fee_cost));
    const networkFees = fullRows.map(item => Number(item.network_fee_cost));
    const priceImpacts = fullRows.map(item => Number(item.price_impact_percent));
    const routeHops = fullRows.map(item => Number(item.route_hops));

    const dominantRejectionCounts = new Map();
    for (const row of fullRows) {
      const key = row.rejection_reason || 'NONE';
      dominantRejectionCounts.set(key, (dominantRejectionCounts.get(key) || 0) + 1);
    }
    const dominantRejection = [...dominantRejectionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const summary = {
      pair,
      observedCount: Number(pairRow.observedCount || 0),
      quotableCount: Number(pairRow.quotableCount || 0),
      executableCount: Number(pairRow.executableCount || 0),
      sampleCount: fullRows.length,
      cleanSampleCount: cleanRows.length,
      excludedByToxicCount: excludedRows.length,
      grossPositiveRate: toRate(fullRows.filter(item => Number(item.gross_edge) > 0).length, fullRows.length),
      cleanGrossPositiveRate: toRate(cleanRows.filter(item => Number(item.gross_edge) > 0).length, cleanRows.length),
      netPositiveRate: toRate(fullRows.filter(item => Number(item.net_edge) > 0).length, fullRows.length),
      worstNonNegativeRate: toRate(fullRows.filter(item => Number(item.worst_case_edge) >= 0).length, fullRows.length),
      avgGrossUsd: average(grossEdges),
      avgNetUsd: average(netEdges),
      avgWorstCaseUsd: average(worstEdges),
      bestGrossUsd: max(grossEdges),
      bestWorstCaseUsd: max(worstEdges),
      minWorstCaseUsd: min(worstEdges),
      avgHaircutUsd: average(slippageCosts),
      avgPoolFeeUsd: average(poolFees),
      avgNetworkFeeUsd: average(networkFees),
      avgPriceImpactPct: average(priceImpacts),
      avgRouteHops: average(routeHops),
      grossStdDevUsd: stddev(grossEdges),
      toxicCoverageRate: toRate(excludedRows.length, fullRows.length),
      toxicPools: unique(excludedRows.flatMap(item => item.toxic_pool_hits || [])),
      representativeCandidateId: representative?.candidate_id || null,
      representativeVenue: representative ? 'bitflow-dlmm' : null,
      representativePools,
      representativePathLength: representative?.execution_path_length ?? null,
      dominantRejection,
    };

    summary.bucket = classifyEdgeBucket(summary);
    summary.anomalyReasons = buildAnomalyReason(summary);
    summary.mainRisk = buildMainRisk(summary);
    summary.futureUse = classifyFutureUse(summary);
    return summary;
  });

  const executableSummaries = summaries
    .filter(item => executablePairs.has(item.pair))
    .sort(compareSummaries);

  const shortlist = {
    A: executableSummaries.filter(item => item.bucket === 'A'),
    B: executableSummaries.filter(item => item.bucket === 'B'),
    C: executableSummaries.filter(item => item.bucket === 'C'),
    D: executableSummaries.filter(item => item.bucket === 'D'),
  };

  const output = {
    generated_at: new Date().toISOString(),
    source: {
      capability_scan_json: CAPABILITY_JSON,
      executability_scan_json: EXECUTABILITY_JSON,
      economic_analysis_json: ECONOMIC_JSON,
      clean_analysis_json: CLEAN_JSON,
      toxic_pools_json: TOXIC_POOLS_JSON,
      truth_definition: 'edge bruto recorrente primeiro, robustez e toxicidade depois',
    },
    anomaly_definition: {
      gross_edge_relevant: 'avgGrossUsd > 0.20 ou grossPositiveRate >= 0.70 com bestGrossUsd > 0.30',
      consistency: 'grossPositiveRate e grossStdDevUsd usados para evitar outlier unico',
      execution_light_filter: 'penaliza toxicCoverageRate alto, avgWorstCaseUsd muito negativo e haircut desproporcional',
      ranking_order: [
        'grossPositiveRate desc',
        'avgGrossUsd desc',
        'toxicCoverageRate asc',
        'bestWorstCaseUsd desc',
      ],
    },
    universe: {
      total_pairs_observed: allPairs.length,
      executable_pairs: executablePairs.size,
      venues_observed: executability.summary?.venuesObserved || [],
      executable_venues: executability.summary?.venuesExecutableByCurrentRuntime || [],
      discovery_only_venues: executability.summary?.gapByVenue?.observedOnly || [],
      toxic_pools: [...toxicPools],
    },
    summaries: executableSummaries,
    ranking: executableSummaries.slice(0, 12),
    shortlist,
    verdict: {
      strong_count: shortlist.A.length,
      moderate_count: shortlist.B.length,
      misleading_count: shortlist.C.length,
      no_value_count: shortlist.D.length,
      edge_exists_in_market: executableSummaries.some(item => (item.avgGrossUsd ?? 0) > 0),
      edge_concentrated_in_toxic_pools: executableSummaries.filter(item => item.toxicCoverageRate >= 0.5 && (item.avgGrossUsd ?? 0) > 0).length,
      clean_investigable_pairs: executableSummaries.filter(item => item.cleanSampleCount > 0 && (item.avgGrossUsd ?? 0) > 0).map(item => item.pair),
    },
  };

  writeJson(OUTPUT_JSON, output);

  console.log('DOG-MM MARKET EDGE ANOMALY SCAN');
  console.log(`output_json: ${OUTPUT_JSON}`);
  console.log(`observed_pairs: ${output.universe.total_pairs_observed}`);
  console.log(`executable_pairs: ${output.universe.executable_pairs}`);
  console.log(`strong_count: ${output.verdict.strong_count}`);
  console.log(`moderate_count: ${output.verdict.moderate_count}`);
  console.log(`misleading_count: ${output.verdict.misleading_count}`);
  console.log(`no_value_count: ${output.verdict.no_value_count}`);
  console.log(`clean_investigable_pairs: ${output.verdict.clean_investigable_pairs.join(', ') || 'none'}`);
}

main();
