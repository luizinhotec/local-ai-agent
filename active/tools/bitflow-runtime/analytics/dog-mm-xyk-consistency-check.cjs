#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadRuntimeEnv } = require('../runtime-env.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const EXPANDED_SCAN_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-universe-scan-expanded.json');
const OUTPUT_JSON = path.resolve(ROOT, 'active', 'state', 'dog-mm', 'dog-mm-xyk-consistency-check.json');
const QUOTE_MULTI_URL = 'https://bff.bitflowapis.finance/api/quotes/v1/quote/multi';

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

function buildProbeTargets(expanded) {
  const preferredPairs = [
    'STX->USDCx',
    'aeUSDC->USDCx',
    'USDh->USDCx',
    'STX->USDh',
    'STX->aeUSDC',
    'USDCx->USDh',
  ];

  return preferredPairs
    .map(pairId => {
      const pair = expanded.discovery.pairsConsidered.find(item => item.pairId === pairId && item.pairResolutionStatus === 'ELIGIBLE');
      if (!pair) return null;
      const result = expanded.results.find(item => item.pairId === pairId && item.notionalLevel === '1x');
      const amountIn = result?.amountIn || expanded.discovery.eligiblePairs?.find(item => item.pairId === pairId)?.levels?.[0]?.amountIn;
      if (!amountIn) return null;
      return {
        pairId,
        inputToken: pair.inputToken,
        outputToken: pair.outputToken,
        amountIn,
      };
    })
    .filter(Boolean);
}

async function runProbe(target) {
  const response = await fetch(QUOTE_MULTI_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input_token: target.inputToken,
      output_token: target.outputToken,
      amount_in: target.amountIn,
      amm_strategy: 'best',
      preferred_amm: 'xyk',
      slippage_tolerance: Number(process.env.DOG_MM_SLIPPAGE_TOLERANCE || 3),
    }),
  });
  const json = await response.json();
  const routes = Array.isArray(json?.routes) ? json.routes : [];
  const executionPath = Array.isArray(routes[0]?.execution_path) ? routes[0].execution_path : [];
  return {
    pairId: target.pairId,
    inputToken: target.inputToken,
    outputToken: target.outputToken,
    amountIn: target.amountIn,
    statusCode: response.status,
    quoteSuccess: Boolean(response.ok && json?.success),
    routeCount: routes.length,
    materializedVenue: classifyMaterializedVenue(executionPath),
    executionPathLength: executionPath.length,
    error: json?.error || null,
  };
}

async function main() {
  loadRuntimeEnv();
  const expanded = readJson(EXPANDED_SCAN_JSON);
  const targets = buildProbeTargets(expanded);
  const probes = [];
  for (const target of targets) {
    probes.push(await runProbe(target));
  }

  const successful = probes.filter(item => item.quoteSuccess);
  const remappedToDlmmCount = successful.filter(item => item.materializedVenue === 'bitflow-dlmm').length;
  const report = {
    generatedAt: new Date().toISOString(),
    totalProbes: probes.length,
    probes,
    remappedToDlmmCount,
    remapRate: successful.length > 0 ? remappedToDlmmCount / successful.length : 0,
    verdict:
      successful.length > 0 && remappedToDlmmCount === successful.length
        ? 'FULLY_REMAPPED_TO_DLMM'
        : 'NOT_FULLY_REMAPPED',
  };

  writeJson(OUTPUT_JSON, report);

  if (require.main === module) {
    console.log('DOG-MM XYK CONSISTENCY CHECK');
    console.log(`total_probes: ${report.totalProbes}`);
    console.log(`remapped_to_dlmm_count: ${report.remappedToDlmmCount}`);
    console.log(`remap_rate: ${report.remapRate}`);
    console.log(`verdict: ${report.verdict}`);
    console.log(`xyk_consistency_json: ${OUTPUT_JSON}`);
  }

  return report;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`DOG-MM xyk consistency check failed: ${error.message}`);
    process.exit(1);
  });
} else {
  module.exports = { main };
}
