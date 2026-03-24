const fs = require('fs');
const path = require('path');
const { writeLatestRisk } = require('./deribit-state-store.cjs');

const DEFAULT_RISK_LIMITS = {
  maxSpreadUsd: 5,
  maxMarkIndexGapUsd: 25,
  maxPositionUsd: 1000,
  minAvailableFundsBtc: 0.01,
  maxFundingAbs: 0.0005,
  maxSnapshotAgeMs: 15000,
};

function loadRiskConfig() {
  const configPath = path.join(__dirname, '..', '..', 'config', 'deribit.risk.json');
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_RISK_LIMITS };
  }

  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    ...DEFAULT_RISK_LIMITS,
    ...fileConfig,
  };
}

function createCheck(name, status, detail) {
  return { name, status, detail };
}

function worstStatus(checks) {
  if (checks.some(check => check.status === 'block')) {
    return 'block';
  }
  if (checks.some(check => check.status === 'warn')) {
    return 'warn';
  }
  return 'ok';
}

function evaluateRisk(snapshot, limits) {
  const checks = [];
  const now = Date.now();
  const snapshotAt = snapshot?.snapshotAt ? new Date(snapshot.snapshotAt).getTime() : NaN;
  const snapshotAgeMs = Number.isFinite(snapshotAt) ? now - snapshotAt : Number.POSITIVE_INFINITY;
  const spreadUsd =
    typeof snapshot?.bestAsk === 'number' && typeof snapshot?.bestBid === 'number'
      ? snapshot.bestAsk - snapshot.bestBid
      : null;
  const markIndexGapUsd =
    typeof snapshot?.markPrice === 'number' && typeof snapshot?.indexPrice === 'number'
      ? Math.abs(snapshot.markPrice - snapshot.indexPrice)
      : null;
  const positionAbsUsd =
    typeof snapshot?.positionSizeUsd === 'number' ? Math.abs(snapshot.positionSizeUsd) : null;
  const fundingAbs =
    typeof snapshot?.currentFunding === 'number' ? Math.abs(snapshot.currentFunding) : null;

  if (!Number.isFinite(snapshotAgeMs)) {
    checks.push(createCheck('snapshot_age', 'block', 'snapshot timestamp unavailable'));
  } else if (snapshotAgeMs > limits.maxSnapshotAgeMs) {
    checks.push(
      createCheck(
        'snapshot_age',
        'block',
        `snapshot age ${snapshotAgeMs}ms exceeds ${limits.maxSnapshotAgeMs}ms`
      )
    );
  } else {
    checks.push(createCheck('snapshot_age', 'ok', `snapshot age ${snapshotAgeMs}ms`));
  }

  if (spreadUsd === null) {
    checks.push(createCheck('spread', 'warn', 'spread unavailable'));
  } else if (spreadUsd > limits.maxSpreadUsd) {
    checks.push(createCheck('spread', 'block', `spread ${spreadUsd.toFixed(2)} exceeds ${limits.maxSpreadUsd}`));
  } else {
    checks.push(createCheck('spread', 'ok', `spread ${spreadUsd.toFixed(2)}`));
  }

  if (markIndexGapUsd === null) {
    checks.push(createCheck('mark_index_gap', 'warn', 'mark/index gap unavailable'));
  } else if (markIndexGapUsd > limits.maxMarkIndexGapUsd) {
    checks.push(
      createCheck(
        'mark_index_gap',
        'block',
        `mark/index gap ${markIndexGapUsd.toFixed(2)} exceeds ${limits.maxMarkIndexGapUsd}`
      )
    );
  } else {
    checks.push(createCheck('mark_index_gap', 'ok', `mark/index gap ${markIndexGapUsd.toFixed(2)}`));
  }

  if (fundingAbs === null) {
    checks.push(createCheck('funding', 'warn', 'funding unavailable'));
  } else if (fundingAbs > limits.maxFundingAbs) {
    checks.push(
      createCheck(
        'funding',
        'warn',
        `abs funding ${fundingAbs.toFixed(6)} exceeds ${limits.maxFundingAbs}`
      )
    );
  } else {
    checks.push(createCheck('funding', 'ok', `abs funding ${fundingAbs.toFixed(6)}`));
  }

  if (positionAbsUsd === null) {
    checks.push(createCheck('position_size', 'warn', 'position unavailable'));
  } else if (positionAbsUsd > limits.maxPositionUsd) {
    checks.push(
      createCheck(
        'position_size',
        'block',
        `position ${positionAbsUsd.toFixed(0)} exceeds ${limits.maxPositionUsd}`
      )
    );
  } else {
    checks.push(createCheck('position_size', 'ok', `position ${positionAbsUsd.toFixed(0)} USD`));
  }

  if (snapshot?.authEnabled) {
    if (typeof snapshot.availableFunds !== 'number') {
      checks.push(createCheck('available_funds', 'warn', 'available funds unavailable'));
    } else if (snapshot.availableFunds < limits.minAvailableFundsBtc) {
      checks.push(
        createCheck(
          'available_funds',
          'block',
          `available funds ${snapshot.availableFunds.toFixed(6)} below ${limits.minAvailableFundsBtc}`
        )
      );
    } else {
      checks.push(
        createCheck('available_funds', 'ok', `available funds ${snapshot.availableFunds.toFixed(6)} BTC`)
      );
    }

    if (
      snapshot.positionDirection &&
      snapshot.positionDirection !== 'flat' &&
      typeof snapshot.estimatedLiquidationPrice === 'number' &&
      typeof snapshot.markPrice === 'number'
    ) {
      const liquidationGapUsd = Math.abs(snapshot.markPrice - snapshot.estimatedLiquidationPrice);
      if (liquidationGapUsd < limits.maxMarkIndexGapUsd) {
        checks.push(
          createCheck(
            'liquidation_gap',
            'block',
            `liq gap ${liquidationGapUsd.toFixed(2)} is too small`
          )
        );
      } else {
        checks.push(
          createCheck('liquidation_gap', 'ok', `liq gap ${liquidationGapUsd.toFixed(2)}`)
        );
      }
    } else {
      checks.push(createCheck('liquidation_gap', 'ok', 'no active leveraged liquidation signal'));
    }
  } else {
    checks.push(createCheck('available_funds', 'warn', 'private account data unavailable'));
    checks.push(createCheck('liquidation_gap', 'warn', 'position risk unavailable without auth'));
  }

  const result = {
    evaluatedAt: new Date().toISOString(),
    limits,
    checks,
    overallStatus: worstStatus(checks),
  };
  writeLatestRisk(result);
  return result;
}

module.exports = {
  DEFAULT_RISK_LIMITS,
  loadRiskConfig,
  evaluateRisk,
};
