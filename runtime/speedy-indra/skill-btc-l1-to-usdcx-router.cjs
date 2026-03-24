const { runBtcL1ToUsdcRouterSkill } = require('./skill-btc-l1-to-usdc-router.cjs');

async function runBtcL1ToUsdcxRouterSkill(options = {}) {
  return runBtcL1ToUsdcRouterSkill(options);
}

module.exports = {
  runBtcL1ToUsdcxRouterSkill,
};
