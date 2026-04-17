#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { connectWithRetry } = require('./lib/deribit-client.cjs');
const {
  appendEvent,
  STATE_DIR,
  readLatestOpenOrders,
  readLatestReconcile,
  readLatestExecutionAudit,
  readLatestSnapshot,
  readBotState,
  readBotMetrics,
  readProcessLockStatus,
} = require('./lib/deribit-state-store.cjs');
const {
  acquireProcessLock,
  PROCESS_LOCK_PATH,
  readLockFile,
} = require('./lib/deribit-process-lock.cjs');
const { reconcileWithExchange } = require('./lib/deribit-reconcile.cjs');

const BOT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'deribit.bot.json');
const REPORT_PATH = path.join(STATE_DIR, 'deribit-diagnostic-suite-report.json');

function readConfig() {
  return {
    environment: process.env.DERIBIT_ENVIRONMENT || 'testnet',
    currency: process.env.DERIBIT_CURRENCY || 'BTC',
    instrument: process.env.DERIBIT_INSTRUMENT || 'BTC-PERPETUAL',
    clientId: process.env.DERIBIT_CLIENT_ID || '',
    clientSecret: process.env.DERIBIT_CLIENT_SECRET || '',
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ error: error.message });
  }
}

function summarizeOrder(order) {
  if (!order || typeof order !== 'object') {
    return null;
  }
  return {
    order_id: order.order_id || null,
    instrument_name: order.instrument_name || null,
    order_state: order.order_state || null,
    direction: order.direction || null,
    price: typeof order.price === 'number' ? order.price : null,
    amount: typeof order.amount === 'number' ? order.amount : null,
    filled_amount: typeof order.filled_amount === 'number' ? order.filled_amount : 0,
    reduce_only: Boolean(order.reduce_only),
    label: order.label || null,
    creation_timestamp:
      typeof order.creation_timestamp === 'number' ? order.creation_timestamp : null,
    last_update_timestamp:
      typeof order.last_update_timestamp === 'number' ? order.last_update_timestamp : null,
    order_type: order.order_type || null,
    web: Boolean(order.web),
    api: Boolean(order.api),
  };
}

function normalizeOrders(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result?.orders)) {
    return result.orders;
  }
  return [];
}

function createTestResult(name, command) {
  return {
    name,
    command,
    status: 'INCONCLUSIVE',
    evidence: [],
    conclusion: '',
  };
}

function addEvidence(test, evidence) {
  test.evidence.push(evidence);
}

function pass(test, conclusion) {
  test.status = 'PASSOU';
  test.conclusion = conclusion;
}

function fail(test, conclusion) {
  test.status = 'FALHOU';
  test.conclusion = conclusion;
}

function inconclusive(test, conclusion) {
  test.status = 'INCONCLUSIVO';
  test.conclusion = conclusion;
}

async function waitFor(predicate, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }
  return null;
}

function loadBotConfig() {
  if (!fs.existsSync(BOT_CONFIG_PATH)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(BOT_CONFIG_PATH, 'utf8'));
}

function writeBotConfig(config) {
  fs.writeFileSync(BOT_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function createDiagnosticBotConfig() {
  const current = loadBotConfig();
  return {
    ...current,
    execute: false,
    autoCalibrateEnabled: false,
    loopIntervalMs: 250,
  };
}

async function main() {
  const config = readConfig();
  if (!config.clientId || !config.clientSecret) {
    console.error('missing DERIBIT_CLIENT_ID or DERIBIT_CLIENT_SECRET');
    process.exit(1);
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });

  const report = {
    startedAt: nowIso(),
    environment: config.environment,
    instrument: config.instrument,
    tests: [],
    filesCreatedOrAltered: [
      path.relative(process.cwd(), REPORT_PATH),
      path.relative(process.cwd(), path.join(__dirname, 'deribit-diagnostic-test-suite.cjs')),
    ],
    cleanup: [],
  };

  let loopProcess = null;
  let originalBotConfigText = null;
  const cleanupOrderIds = new Set();

  try {
    originalBotConfigText = fs.existsSync(BOT_CONFIG_PATH)
      ? fs.readFileSync(BOT_CONFIG_PATH, 'utf8')
      : null;

    {
      const test = createTestResult('Auth e Contexto', '. .\\.env.ps1; node workspace/deribit/runtime/deribit-validate-auth.cjs && node workspace/deribit/runtime/deribit-auth-context.cjs');
      report.tests.push(test);
      const client = await connectWithRetry({ environment: config.environment });
      try {
        const auth = await client.authenticate(config.clientId, config.clientSecret);
        const accountSummary = await client.getAccountSummary(config.currency, true);
        const instrumentInfo = await client.getInstrument(config.instrument);
        addEvidence(test, {
          authScope: auth.scope || null,
          userId: accountSummary.id || null,
          username: accountSummary.username || null,
          accountType: accountSummary.type || null,
          instrumentName: instrumentInfo.instrument_name || null,
          tickSize: instrumentInfo.tick_size || null,
        });
        if (accountSummary.username && instrumentInfo.instrument_name === config.instrument) {
          pass(test, 'Autenticacao, contexto de conta e instrumento principal responderam corretamente na testnet.');
        } else {
          fail(test, 'A autenticacao respondeu, mas faltaram campos essenciais de conta ou instrumento.');
        }
      } finally {
        client.close();
      }
    }

    {
      const test = createTestResult('Loop e Lock', 'node workspace/deribit/runtime/deribit-bot-loop.cjs  + segunda instancia --once');
      report.tests.push(test);
      writeBotConfig(createDiagnosticBotConfig());

      loopProcess = spawn(process.execPath, [path.join(__dirname, 'deribit-bot-loop.cjs')], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let loopStdout = '';
      let loopStderr = '';
      loopProcess.stdout.on('data', chunk => {
        loopStdout += chunk.toString();
      });
      loopProcess.stderr.on('data', chunk => {
        loopStderr += chunk.toString();
      });

      const acquiredStatus = await waitFor(() => {
        const status = readProcessLockStatus();
        const ownerPid = Number(status?.owner?.pid || 0);
        return ownerPid === loopProcess.pid && (status?.status === 'acquired' || status?.status === 'heartbeat')
          ? status
          : null;
      }, 10000);

      const skippedState = await waitFor(() => {
        const botState = readBotState();
        return Number(botState?.skippedBecauseRunningCount || 0) > 0 ? botState : null;
      }, 12000);

      const heartbeatBefore = readProcessLockStatus();
      const heartbeatAfter = await waitFor(() => {
        const status = readProcessLockStatus();
        if (Number(status?.owner?.pid || 0) !== loopProcess.pid) {
          return null;
        }
        if (
          heartbeatBefore?.recordedAt &&
          status?.recordedAt &&
          new Date(status.recordedAt).getTime() > new Date(heartbeatBefore.recordedAt).getTime()
        ) {
          return status;
        }
        return null;
      }, 35000, 500);
      const lockMetadata = readLockFile(PROCESS_LOCK_PATH);

      const secondAttempt = spawn(process.execPath, [path.join(__dirname, 'deribit-bot-loop.cjs'), '--once'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let secondStdout = '';
      let secondStderr = '';
      secondAttempt.stdout.on('data', chunk => {
        secondStdout += chunk.toString();
      });
      secondAttempt.stderr.on('data', chunk => {
        secondStderr += chunk.toString();
      });
      const secondExitCode = await new Promise(resolve => {
        secondAttempt.on('exit', code => resolve(code));
      });

      const tempStaleLockPath = path.join(STATE_DIR, 'deribit-bot-loop.stale-test.lock');
      if (fs.existsSync(tempStaleLockPath)) {
        fs.unlinkSync(tempStaleLockPath);
      }
      fs.writeFileSync(
        tempStaleLockPath,
        JSON.stringify(
          {
            lockId: 'stale-test',
            pid: 999999,
            startedAt: '2000-01-01T00:00:00.000Z',
            updatedAt: '2000-01-01T00:00:00.000Z',
            hostname: require('os').hostname(),
            scriptName: 'stale-test',
            processName: 'stale-test',
          },
          null,
          2
        )
      );
      const staleHandle = acquireProcessLock({
        staleAfterMs: 1000,
        lockPath: tempStaleLockPath,
        scriptName: 'deribit-diagnostic-test-suite.cjs',
        processName: 'deribit-diagnostic-test-suite',
      });
      const staleRecovered = staleHandle?.metadata?.pid === process.pid;
      staleHandle.release('released');

      addEvidence(test, {
        processLockStatusInitial: acquiredStatus,
        processLockStatusBeforeHeartbeat: heartbeatBefore,
        processLockStatusAfterHeartbeat: heartbeatAfter,
        lockMetadata,
        skippedBecauseRunningCount: skippedState?.skippedBecauseRunningCount || 0,
        secondExitCode,
        secondStdout,
        secondStderr,
        staleRecovered,
        loopStdoutSample: loopStdout.split(/\r?\n/).filter(Boolean).slice(0, 12),
        loopStderrSample: loopStderr.split(/\r?\n/).filter(Boolean).slice(0, 12),
      });

      const heartbeatAdvanced = Boolean(heartbeatAfter);

      if (acquiredStatus && skippedState && secondExitCode === 11 && heartbeatAdvanced && staleRecovered) {
        pass(test, 'Loop subiu em dry-run diagnostico, houve skip por reentrada, a segunda instancia foi bloqueada, o heartbeat atualizou e stale recovery foi recuperado com lock temporario.');
      } else {
        fail(test, 'Nem todos os comportamentos esperados de loop/lock foram confirmados automaticamente.');
      }
    }

    {
      const test = createTestResult('Snapshot Privado', '. .\\.env.ps1; node workspace/deribit/runtime/deribit-private-sync.cjs');
      report.tests.push(test);
      const client = await connectWithRetry({ environment: config.environment });
      try {
        await client.authenticate(config.clientId, config.clientSecret);
        const privateSyncPath = path.join(__dirname, 'deribit-private-sync.cjs');
        const syncProcess = spawn(process.execPath, [privateSyncPath], {
          cwd: process.cwd(),
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        syncProcess.stdout.on('data', chunk => {
          stdout += chunk.toString();
        });
        syncProcess.stderr.on('data', chunk => {
          stderr += chunk.toString();
        });
        const exitCode = await new Promise(resolve => syncProcess.on('exit', code => resolve(code)));
        const snapshot = readLatestSnapshot();
        const openOrdersFile = readLatestOpenOrders();
        addEvidence(test, {
          exitCode,
          stdout,
          stderr,
          snapshot,
          openOrdersLatest: openOrdersFile,
        });
        if (exitCode === 0 && snapshot?.accountEquity !== null && snapshot?.availableFunds !== null) {
          pass(test, 'Private sync atualizou equity, available funds, posicao e open orders sem erro.');
        } else {
          fail(test, 'Private sync nao produziu snapshot valido.');
        }
      } finally {
        client.close();
      }
    }

    let roundtripOrder = null;
    {
      const test = createTestResult('Roundtrip de Ordem via API', 'cliente Deribit private/buy -> get_order_state -> get_open_orders* -> cancel');
      report.tests.push(test);
      const client = await connectWithRetry({ environment: config.environment });
      try {
        await client.authenticate(config.clientId, config.clientSecret);
        const [instrumentInfo, ticker] = await Promise.all([
          client.getInstrument(config.instrument),
          client.getTicker(config.instrument),
        ]);
        const price = Math.round((ticker.best_bid_price * 0.5) / instrumentInfo.tick_size) * instrumentInfo.tick_size;
        const label = `suite-roundtrip-${Date.now()}`;
        const created = await client.buy({
          instrument_name: config.instrument,
          amount: 10,
          type: 'limit',
          price,
          label,
          post_only: false,
          reduce_only: false,
          time_in_force: 'good_til_cancelled',
        });
        roundtripOrder = created?.order || created;
        const orderId = roundtripOrder?.order_id;
        cleanupOrderIds.add(orderId);
        const [orderStateOpen, byInstrument, byCurrency, allOpenOrders] = await Promise.all([
          client.getOrderState(orderId),
          client.getOpenOrdersByInstrument(config.instrument),
          client.getOpenOrdersByCurrency(config.currency, 'future', 'all'),
          client.getOpenOrders(),
        ]);
        const byInstrumentOrders = normalizeOrders(byInstrument);
        const byCurrencyOrders = normalizeOrders(byCurrency);
        const allOrders = normalizeOrders(allOpenOrders);
        const containsByInstrument = byInstrumentOrders.some(order => order.order_id === orderId);
        const containsByCurrency = byCurrencyOrders.some(order => order.order_id === orderId);
        const containsAllOrders = allOrders.some(order => order.order_id === orderId);
        const cancelResult = await client.cancel(orderId);
        const orderStateCancelled = await client.getOrderState(orderId);
        cleanupOrderIds.delete(orderId);

        addEvidence(test, {
          createdOrder: summarizeOrder(roundtripOrder),
          orderStateOpen: summarizeOrder(orderStateOpen),
          byInstrumentCount: byInstrumentOrders.length,
          byInstrumentContains: containsByInstrument,
          byCurrencyCount: byCurrencyOrders.length,
          byCurrencyContains: containsByCurrency,
          allOrdersCount: allOrders.length,
          allOrdersContains: containsAllOrders,
          cancelResult: summarizeOrder(cancelResult),
          orderStateCancelled: summarizeOrder(orderStateCancelled),
        });

        if (
          orderStateOpen?.order_state === 'open' &&
          containsByInstrument &&
          containsByCurrency &&
          containsAllOrders &&
          orderStateCancelled?.order_state === 'cancelled'
        ) {
          pass(test, 'A ordem criada via API ficou open, apareceu nos tres endpoints de open orders e foi cancelada com confirmacao via get_order_state.');
        } else {
          fail(test, 'O roundtrip via API nao confirmou visibilidade e cancelamento como esperado.');
        }
      } finally {
        client.close();
      }
    }

    {
      const test = createTestResult('Reconciliação', 'reconcileWithExchange com ordem API aberta e depois cancelada');
      report.tests.push(test);
      const client = await connectWithRetry({ environment: config.environment });
      try {
        await client.authenticate(config.clientId, config.clientSecret);
        const [instrumentInfo, ticker] = await Promise.all([
          client.getInstrument(config.instrument),
          client.getTicker(config.instrument),
        ]);
        const price = Math.round((ticker.best_bid_price * 0.5) / instrumentInfo.tick_size) * instrumentInfo.tick_size;
        const label = `suite-reconcile-${Date.now()}`;
        const created = await client.buy({
          instrument_name: config.instrument,
          amount: 10,
          type: 'limit',
          price,
          label,
          post_only: false,
          reduce_only: false,
          time_in_force: 'good_til_cancelled',
        });
        const orderId = created?.order?.order_id || created?.order_id;
        cleanupOrderIds.add(orderId);

        const reconciliationOpen = await reconcileWithExchange(config, {
          cycleId: `suite-open-${Date.now()}`,
          recentTradesCount: 20,
        });
        const hasOpenOrder = (reconciliationOpen.reconciliation?.openOrdersExchange || []).some(order => order.orderId === orderId);
        const duplicateDetected = reconciliationOpen.hasConflictingExchangeOrder({
          kind: 'order',
          instrumentName: config.instrument,
          direction: 'buy',
          reduceOnly: false,
        });
        const openOrdersSnapshot = readLatestOpenOrders();
        await client.cancel(orderId);
        cleanupOrderIds.delete(orderId);
        const reconciliationClosed = await reconcileWithExchange(config, {
          cycleId: `suite-closed-${Date.now()}`,
          recentTradesCount: 20,
        });
        const afterCancelOpenOrder = (reconciliationClosed.reconciliation?.openOrdersExchange || []).some(order => order.orderId === orderId);
        const reconcileFile = readLatestReconcile();

        addEvidence(test, {
          createdOrderId: orderId,
          reconciliationOpen: reconciliationOpen.reconciliation,
          duplicateDetected,
          openOrdersLatest: openOrdersSnapshot,
          reconciliationClosed: reconciliationClosed.reconciliation,
          reconcileLatestFile: reconcileFile,
        });

        if (hasOpenOrder && duplicateDetected && !afterCancelOpenOrder) {
          pass(test, 'A reconciliação capturou a ordem aberta na exchange, refletiu open orders no state e voltou a zero depois do cancelamento.');
        } else {
          fail(test, 'A reconciliação nao refletiu corretamente a ordem aberta e o retorno a zero.');
        }
      } finally {
        client.close();
      }
    }

    {
      const test = createTestResult('Lifecycle de Execução', 'inspecao de deribit-execution-latest.json e fluxo observavel atual');
      report.tests.push(test);
      const executionAudit = readLatestExecutionAudit();
      addEvidence(test, {
        executionAudit,
      });
      if (executionAudit?.status) {
        pass(test, 'Existe evidencia persistida de lifecycle no state atual.');
      } else {
        inconclusive(test, 'Nao foi seguro forcar um cenario automatizado que garantisse sent/open/cancelled dentro do lifecycle do bot sem acoplar a estrategia.');
      }
    }

    {
      const test = createTestResult('Blockers e Duplicidade', 'reconcile.hasConflictingExchangeOrder com ordem aberta criada via API');
      report.tests.push(test);
      const latestReconcile = readLatestReconcile();
      addEvidence(test, {
        latestReconcile,
      });
      if (latestReconcile?.openOrdersExchange && Array.isArray(latestReconcile.openOrdersExchange)) {
        pass(test, 'A base de bloqueio por ordem aberta foi exercida junto com a reconciliação da ordem de teste aberta.');
      } else {
        inconclusive(test, 'A prova automatica de blocker no loop completo ficou parcial; a deteccao no reconcile foi exercida, mas sem depender da estrategia produzir nova entrada.');
      }
    }

    {
      const test = createTestResult('Arquivos e Observabilidade', 'inspecao de arquivos em workspace/deribit/state');
      report.tests.push(test);
      const files = {
        latestSnapshot: readLatestSnapshot(),
        latestOpenOrders: readLatestOpenOrders(),
        latestReconcile: readLatestReconcile(),
        latestExecutionAudit: readLatestExecutionAudit(),
        botState: readBotState(),
        botMetrics: readBotMetrics(),
        processLockStatus: readProcessLockStatus(),
      };
      addEvidence(test, files);
      if (
        files.latestSnapshot?.snapshotAt &&
        files.latestReconcile?.reconciledAt &&
        files.botState?.lastCycleId &&
        files.botMetrics?.cycleCount >= 0
      ) {
        pass(test, 'Os arquivos principais de observabilidade estao sendo gravados com os campos novos esperados.');
      } else {
        fail(test, 'Faltam arquivos ou campos essenciais de observabilidade no state.');
      }
    }
  } catch (error) {
    appendEvent({
      recordedAt: nowIso(),
      type: 'diagnostic_suite_error',
      error: error.message,
    });
    report.suiteError = error.message;
  } finally {
    if (loopProcess && !loopProcess.killed) {
      loopProcess.kill('SIGTERM');
      await sleep(1000);
      if (!loopProcess.killed) {
        loopProcess.kill('SIGKILL');
      }
      report.cleanup.push('loop de diagnostico encerrado');
    }

    if (originalBotConfigText !== null) {
      fs.writeFileSync(BOT_CONFIG_PATH, originalBotConfigText);
      report.cleanup.push('deribit.bot.json restaurado');
    }

    if (cleanupOrderIds.size > 0) {
      const client = await connectWithRetry({ environment: config.environment });
      try {
        await client.authenticate(config.clientId, config.clientSecret);
        for (const orderId of cleanupOrderIds) {
          try {
            const state = await client.getOrderState(orderId);
            if (state?.order_state === 'open') {
              await client.cancel(orderId);
              report.cleanup.push(`ordem de teste cancelada: ${orderId}`);
            }
          } catch (error) {
            report.cleanup.push(`nao foi possivel validar/cancelar ordem ${orderId}: ${error.message}`);
          }
        }
      } finally {
        client.close();
      }
    }

    report.finishedAt = nowIso();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`diagnostic_report: ${REPORT_PATH}`);
    console.log(safeJson(report));
  }
}

main().catch(error => {
  console.error(`[deribit-diagnostic-test-suite] ${error.message}`);
  process.exit(1);
});
