#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const SCANNER = path.resolve(__dirname, 'dog-mm-market-edge-anomaly-scan.cjs');
const SCAN_OUTPUT = path.resolve(STATE_DIR, 'dog-mm-market-edge-anomaly-scan.json');

const SNAPSHOT_DIR = path.resolve(STATE_DIR, 'edge-monitor-snapshots');
const CURRENT_JSON = path.resolve(STATE_DIR, 'dog-mm-market-edge-monitor-current.json');
const HISTORY_JSON = path.resolve(STATE_DIR, 'dog-mm-market-edge-monitor-history.json');
const CHANGELOG_JSON = path.resolve(STATE_DIR, 'dog-mm-market-edge-monitor-regime-log.json');

const DEFAULTS = {
  cycles: 1,
  intervalMs: 60000,
  maxSnapshots: 120,
  maxHistory: 120,
  maxRegimeEvents: 240,
};

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const eqIndex = current.indexOf('=');
    if (eqIndex >= 0) {
      const key = current.slice(2, eqIndex);
      const value = current.slice(eqIndex + 1);
      parsed[key] = value === '' ? true : value;
      continue;
    }
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function toFiniteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function runScanner() {
  const result = spawnSync(process.execPath, [SCANNER], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env },
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Failed running ${path.basename(SCANNER)}: ${result.stderr || result.stdout}`.trim());
  }
  const payload = readJson(SCAN_OUTPUT);
  if (!payload) throw new Error(`Missing scanner output: ${SCAN_OUTPUT}`);
  return payload;
}

function summarizeTopItem(item, position) {
  if (!item) return null;
  return {
    position,
    pair: item.pair,
    avgGrossUsd: item.avgGrossUsd,
    grossPositiveRate: item.grossPositiveRate,
    bestWorstCaseUsd: item.bestWorstCaseUsd,
    toxicCoverageRate: item.toxicCoverageRate,
    bucket: item.bucket,
    mainRisk: item.mainRisk,
  };
}

function findPairPosition(ranking, pair) {
  const index = ranking.findIndex(item => item.pair === pair);
  return index >= 0 ? index + 1 : null;
}

function classifyRegime(snapshot) {
  const counts = snapshot.bucketCounts || {};
  const top = snapshot.topAnomaly || null;

  if ((counts.A || 0) === 0 && (counts.B || 0) === 0) return 'NO_EDGE';
  if (top && top.toxicCoverageRate >= 0.5) return 'TOXIC_EDGE';
  if ((counts.A || 0) > 0 && top && top.toxicCoverageRate <= 0.25 && (top.avgGrossUsd ?? 0) >= 0.2) {
    return 'OBSERVABLE_EDGE';
  }
  if ((counts.B || 0) > 0) return 'WEAK_EDGE';
  return 'NO_EDGE';
}

function describeRegime(snapshot, previousSnapshot) {
  const regime = classifyRegime(snapshot);
  if (!previousSnapshot) return regime;
  const previousTop = previousSnapshot.topAnomaly || null;
  const currentTop = snapshot.topAnomaly || null;
  const previousRegime = previousSnapshot.regime || classifyRegime(previousSnapshot);

  if (
    currentTop &&
    previousTop &&
    currentTop.pair === previousTop.pair &&
    (currentTop.avgGrossUsd ?? -Infinity) > (previousTop.avgGrossUsd ?? -Infinity) + 0.05 &&
    (currentTop.toxicCoverageRate ?? Infinity) <= (previousTop.toxicCoverageRate ?? Infinity)
  ) {
    return 'IMPROVING_EDGE';
  }

  if (previousRegime !== regime) return regime;
  return regime;
}

function buildSnapshot(scan, cycle, previousSnapshot) {
  const ranking = Array.isArray(scan.ranking) ? scan.ranking : [];
  const shortlist = scan.shortlist || {};
  const top3 = ranking.slice(0, 3).map((item, index) => summarizeTopItem(item, index + 1));
  const topAnomaly = top3[0] || null;
  const bucketCounts = {
    A: Array.isArray(shortlist.A) ? shortlist.A.length : 0,
    B: Array.isArray(shortlist.B) ? shortlist.B.length : 0,
    C: Array.isArray(shortlist.C) ? shortlist.C.length : 0,
    D: Array.isArray(shortlist.D) ? shortlist.D.length : 0,
  };
  const sbtcStxPosition = findPairPosition(ranking, 'sBTC->STX');
  const sbtcStx = ranking.find(item => item.pair === 'sBTC->STX') || null;

  const snapshot = {
    cycle,
    timestamp: new Date().toISOString(),
    scannerGeneratedAt: scan.generated_at || null,
    topAnomaly,
    top3,
    bucketCounts,
    sbtcStx: sbtcStx
      ? {
          present: true,
          position: sbtcStxPosition,
          avgGrossUsd: sbtcStx.avgGrossUsd,
          grossPositiveRate: sbtcStx.grossPositiveRate,
          bestWorstCaseUsd: sbtcStx.bestWorstCaseUsd,
          toxicCoverageRate: sbtcStx.toxicCoverageRate,
          bucket: sbtcStx.bucket,
        }
      : {
          present: false,
          position: null,
        },
    executablePairs: scan.universe?.executable_pairs ?? null,
    cleanInvestigablePairs: scan.verdict?.clean_investigable_pairs || [],
  };

  snapshot.regime = describeRegime(snapshot, previousSnapshot);
  snapshot.regimeChanged = previousSnapshot ? previousSnapshot.regime !== snapshot.regime : false;
  snapshot.topChanged = previousSnapshot
    ? (previousSnapshot.topAnomaly?.pair || null) !== (snapshot.topAnomaly?.pair || null)
    : false;
  snapshot.topImproved = previousSnapshot && previousSnapshot.topAnomaly && snapshot.topAnomaly
    ? (snapshot.topAnomaly.avgGrossUsd ?? -Infinity) > (previousSnapshot.topAnomaly.avgGrossUsd ?? -Infinity)
    : false;
  snapshot.sbtcStxMoved = previousSnapshot && previousSnapshot.sbtcStx
    ? {
        previousPosition: previousSnapshot.sbtcStx.position,
        currentPosition: snapshot.sbtcStx.position,
      }
    : null;

  return snapshot;
}

function pruneFiles(directory, maxFiles) {
  const files = fs.readdirSync(directory)
    .map(name => ({
      name,
      fullPath: path.join(directory, name),
      stat: fs.statSync(path.join(directory, name)),
    }))
    .filter(item => item.stat.isFile())
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  for (const item of files.slice(maxFiles)) {
    fs.unlinkSync(item.fullPath);
  }
}

function persistSnapshot(snapshot, maxSnapshots) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const stamp = snapshot.timestamp.replace(/[:.]/g, '-');
  const filePath = path.join(SNAPSHOT_DIR, `${stamp}-cycle-${snapshot.cycle}.json`);
  writeJson(filePath, snapshot);
  pruneFiles(SNAPSHOT_DIR, maxSnapshots);
  return filePath;
}

function updateHistory(snapshot, maxHistory) {
  const current = readJson(HISTORY_JSON, { generated_at: null, entries: [] });
  const entries = Array.isArray(current.entries) ? current.entries : [];
  entries.push(snapshot);
  const trimmed = entries.slice(-maxHistory);
  const payload = {
    generated_at: new Date().toISOString(),
    entries: trimmed,
  };
  writeJson(HISTORY_JSON, payload);
  return payload;
}

function updateRegimeLog(snapshot, previousSnapshot, maxEvents) {
  const current = readJson(CHANGELOG_JSON, { generated_at: null, events: [] });
  const events = Array.isArray(current.events) ? current.events : [];
  if (previousSnapshot) {
    const changeDetected =
      snapshot.regimeChanged ||
      snapshot.topChanged ||
      snapshot.topImproved ||
      (snapshot.sbtcStxMoved &&
        snapshot.sbtcStxMoved.previousPosition !== snapshot.sbtcStxMoved.currentPosition);

    if (changeDetected) {
      events.push({
        timestamp: snapshot.timestamp,
        previousRegime: previousSnapshot.regime,
        currentRegime: snapshot.regime,
        previousTopPair: previousSnapshot.topAnomaly?.pair || null,
        currentTopPair: snapshot.topAnomaly?.pair || null,
        topImproved: snapshot.topImproved,
        sbtcStxPreviousPosition: snapshot.sbtcStxMoved?.previousPosition ?? null,
        sbtcStxCurrentPosition: snapshot.sbtcStxMoved?.currentPosition ?? null,
      });
    }
  }
  const payload = {
    generated_at: new Date().toISOString(),
    events: events.slice(-maxEvents),
  };
  writeJson(CHANGELOG_JSON, payload);
  return payload;
}

function printSnapshot(snapshot, snapshotPath) {
  console.log('DOG-MM MARKET EDGE MONITOR');
  console.log(`cycle: ${snapshot.cycle}`);
  console.log(`timestamp: ${snapshot.timestamp}`);
  console.log(`regime: ${snapshot.regime}`);
  console.log(`regime_changed: ${snapshot.regimeChanged}`);
  console.log(`top_pair: ${snapshot.topAnomaly?.pair || 'none'}`);
  console.log(`top_bucket: ${snapshot.topAnomaly?.bucket || 'none'}`);
  console.log(`top_avg_gross_usd: ${snapshot.topAnomaly?.avgGrossUsd ?? 'n/a'}`);
  console.log(`top_toxic_coverage_rate: ${snapshot.topAnomaly?.toxicCoverageRate ?? 'n/a'}`);
  console.log(`sbtc_stx_position: ${snapshot.sbtcStx.position ?? 'absent'}`);
  console.log(`bucket_counts: A=${snapshot.bucketCounts.A} B=${snapshot.bucketCounts.B} C=${snapshot.bucketCounts.C} D=${snapshot.bucketCounts.D}`);
  console.log(`snapshot_json: ${snapshotPath}`);
  console.log(`current_json: ${CURRENT_JSON}`);
  console.log(`history_json: ${HISTORY_JSON}`);
  console.log(`regime_log_json: ${CHANGELOG_JSON}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cycles = Math.max(1, toFiniteNumber(args.cycles, DEFAULTS.cycles));
  const intervalMs = Math.max(0, toFiniteNumber(args['interval-ms'], DEFAULTS.intervalMs));
  const maxSnapshots = Math.max(1, toFiniteNumber(args['max-snapshots'], DEFAULTS.maxSnapshots));
  const maxHistory = Math.max(1, toFiniteNumber(args['max-history'], DEFAULTS.maxHistory));
  const maxRegimeEvents = Math.max(1, toFiniteNumber(args['max-regime-events'], DEFAULTS.maxRegimeEvents));
  const watch = Boolean(args.watch);

  let previousSnapshot = readJson(CURRENT_JSON, null);
  for (let cycle = 1; watch || cycle <= cycles; cycle += 1) {
    const scan = runScanner();
    const snapshot = buildSnapshot(scan, cycle, previousSnapshot);
    const snapshotPath = persistSnapshot(snapshot, maxSnapshots);
    writeJson(CURRENT_JSON, snapshot);
    updateHistory(snapshot, maxHistory);
    updateRegimeLog(snapshot, previousSnapshot, maxRegimeEvents);
    printSnapshot(snapshot, snapshotPath);
    previousSnapshot = snapshot;
    if ((watch || cycle < cycles) && intervalMs > 0) sleep(intervalMs);
  }
}

main();
