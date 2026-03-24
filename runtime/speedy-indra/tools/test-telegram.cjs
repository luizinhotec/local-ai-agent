const { loadAgentConfig } = require('../lib/agent-config.cjs');
const { appendJsonLog } = require('../lib/agent-logger.cjs');

const TEST_MESSAGE = 'Speedy Indra Telegram Test OK';

async function main() {
  const config = loadAgentConfig();
  const botToken = config.telegram?.botToken || '';
  const chatId = config.telegram?.chatId || '';

  if (!botToken || !chatId) {
    appendJsonLog('telegram_test_missing_config', {
      ok: false,
      hasBotToken: Boolean(botToken),
      hasChatId: Boolean(chatId),
    });
    console.log('ERROR: TELEGRAM MESSAGE FAILED');
    return;
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
        text: TEST_MESSAGE,
      }),
    });

    const body = await response.json().catch(() => null);

    if (response.ok && body?.ok === true) {
      appendJsonLog('telegram_test_success', {
        ok: true,
        responseOk: body.ok === true,
        responseStatus: response.status,
        resultMessageId: body?.result?.message_id || null,
      });
      console.log('SUCCESS: TELEGRAM MESSAGE SENT');
      console.log(JSON.stringify({
        ok: true,
        responseStatus: response.status,
        telegramOk: body.ok,
        resultMessageId: body?.result?.message_id || null,
      }, null, 2));
      return;
    }

    appendJsonLog('telegram_test_failed', {
      ok: false,
      error: body?.description || `telegram_http_${response.status}`,
      responseStatus: response.status,
      responseBody: body,
    });
    console.log('ERROR: TELEGRAM MESSAGE FAILED');
    console.log(JSON.stringify({
      ok: false,
      responseStatus: response.status,
      responseBody: body,
    }, null, 2));
  } catch (error) {
    appendJsonLog('telegram_test_failed', {
      ok: false,
      error: error.message,
    });
    console.log('ERROR: TELEGRAM MESSAGE FAILED');
    console.log(JSON.stringify({
      ok: false,
      error: error.message,
    }, null, 2));
  }
}

main().catch(error => {
  appendJsonLog('telegram_test_failed', {
    ok: false,
    error: error.message,
  });
  console.log('ERROR: TELEGRAM MESSAGE FAILED');
  console.log(JSON.stringify({
    ok: false,
    error: error.message,
  }, null, 2));
  process.exit(1);
});
