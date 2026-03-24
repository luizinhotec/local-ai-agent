const { loadAgentConfig } = require('./agent-config.cjs');
const { appendJsonLog } = require('./agent-logger.cjs');

function buildTelegramMessage(snapshot) {
  const lines = [
    snapshot.status || 'OBSERVING',
    `pair: ${snapshot.pair || 'sbtc-usdcx'}`,
    `amount_sats: ${snapshot.amountSats ?? 3000}`,
    `decision: ${snapshot.decision || 'UNKNOWN'}`,
    `decisionReason: ${snapshot.decisionReason || 'unknown'}`,
    `estimatedFeeSats: ${snapshot.estimatedFeeSats ?? 'n/a'}`,
    `priceImpactBps: ${snapshot.priceImpactBps ?? 'n/a'}`,
  ];

  if (snapshot.watchGateEligible !== undefined) {
    lines.push(`watchGateEligible: ${snapshot.watchGateEligible ? 'true' : 'false'}`);
  }
  if (snapshot.watchGateReason) {
    lines.push(`watchGateReason: ${snapshot.watchGateReason}`);
  }
  if (snapshot.watchGateScore !== undefined && snapshot.watchGateScore !== null) {
    lines.push(`watchGateScore: ${snapshot.watchGateScore}`);
  }
  if (snapshot.edgeScore !== undefined && snapshot.edgeScore !== null) {
    lines.push(`edgeScore: ${snapshot.edgeScore}`);
  }
  if (snapshot.executionQualityScore !== undefined && snapshot.executionQualityScore !== null) {
    lines.push(`executionQualityScore: ${snapshot.executionQualityScore}`);
  }
  if (snapshot.lastShadowExecution?.simulatedLatencyMs !== undefined) {
    lines.push(`simulatedLatencyMs: ${snapshot.lastShadowExecution.simulatedLatencyMs}`);
  }
  if (snapshot.manualCommand) {
    lines.push(`command: ${snapshot.manualCommand}`);
  }

  if (snapshot.autoArmNonce) {
    lines.push(`nonce: ${snapshot.autoArmNonce}`);
  }
  if (snapshot.autoArmExpiresAt) {
    lines.push(`expiresAt: ${snapshot.autoArmExpiresAt}`);
  }
  if (snapshot.autoArmNonce) {
    lines.push(`reply: EXEC ${snapshot.autoArmNonce}`);
  }

  return lines.join('\n');
}

async function sendTelegramAlert(snapshot, options = {}) {
  const config = loadAgentConfig();
  const botToken = config.telegram?.botToken || '';
  const chatId = config.telegram?.chatId || '';
  const message = buildTelegramMessage(snapshot);

  if (!botToken || !chatId) {
    const record = appendJsonLog('championship_telegram_alert_skipped', {
      ok: false,
      reason: 'telegram_config_missing',
      telegramConfigured: false,
      pair: snapshot.pair || 'sbtc-usdcx',
      amountSats: snapshot.amountSats ?? null,
    });
    return {
      ok: false,
      skipped: true,
      reason: 'telegram_config_missing',
      message,
      record,
    };
  }

  if (options.mock) {
    const record = appendJsonLog('championship_telegram_alert_mocked', {
      ok: true,
      mocked: true,
      telegramConfigured: true,
      pair: snapshot.pair || 'sbtc-usdcx',
      amountSats: snapshot.amountSats ?? null,
      decision: snapshot.decision || null,
      decisionReason: snapshot.decisionReason || null,
    });
    return {
      ok: true,
      mocked: true,
      message,
      record,
    };
  }

  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });
    const body = await response.json().catch(() => null);
    const ok = Boolean(response.ok && body?.ok);
    const record = appendJsonLog(ok ? 'championship_telegram_alert_sent' : 'championship_telegram_alert_failed', {
      ok,
      telegramConfigured: true,
      pair: snapshot.pair || 'sbtc-usdcx',
      amountSats: snapshot.amountSats ?? null,
      responseStatus: response.status,
      telegramOk: body?.ok ?? false,
      telegramDescription: body?.description || null,
    });
    return {
      ok,
      skipped: false,
      message,
      responseStatus: response.status,
      body,
      record,
    };
  } catch (error) {
    const record = appendJsonLog('championship_telegram_alert_failed', {
      ok: false,
      telegramConfigured: true,
      pair: snapshot.pair || 'sbtc-usdcx',
      amountSats: snapshot.amountSats ?? null,
      error: error.message,
    });
    return {
      ok: false,
      skipped: false,
      reason: error.message,
      message,
      record,
    };
  }
}

module.exports = {
  buildTelegramMessage,
  sendTelegramAlert,
};
