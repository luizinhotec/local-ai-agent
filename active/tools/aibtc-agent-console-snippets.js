const AIBTC_AGENT = {
  displayName: "Speedy Indra",
  btcAddress: "bc1q7maxug87p9ul7cl8yvmv6za8aqxfpfea0h6tc9",
  stxAddress: "SP1H35Z548R39KCMMNP9498QQ28SZFE07FB7Q3CBT",
  claimCode: "3Y38HU",
  referralCode: "FJS5VH",
  proxyBase: "http://127.0.0.1:8765",
  timezone: "America/Sao_Paulo",
  heartbeatMessage(timestampIso) {
    return `AIBTC Check-In | ${timestampIso}`;
  },
  formatIsoForTimezone(timestampIso, timezone = "America/Sao_Paulo") {
    if (!timestampIso) {
      return null;
    }
    const date = new Date(timestampIso);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  },
  enrichHeartbeatWindow(windowInfo) {
    if (!windowInfo) {
      return windowInfo;
    }
    return {
      ...windowInfo,
      timezone: this.timezone,
      lastCheckInLocal: this.formatIsoForTimezone(windowInfo.lastCheckInAtIso, this.timezone),
      nextCheckInLocal: this.formatIsoForTimezone(windowInfo.nextCheckInAtIso, this.timezone)
    };
  },
  async signBitcoinMessageWithLeather(message, paymentType = "p2wpkh") {
    const response = await window.LeatherProvider.request("signMessage", {
      message,
      paymentType,
      network: "mainnet"
    });
    return response.result.signature;
  },
  async logEvent(type, details = {}) {
    const payload = {
      type,
      displayName: this.displayName,
      btcAddress: this.btcAddress,
      stxAddress: this.stxAddress,
      details
    };
    const response = await fetch(`${this.proxyBase}/api/log-event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async tryLogEvent(type, details = {}) {
    try {
      const result = await this.logEvent(type, details);
      return {
        ok: true,
        ...result
      };
    } catch (error) {
      const message = error?.message || String(error);
      console.warn("AIBTC logEvent failed", { type, message });
      return {
        ok: false,
        status: 0,
        body: {
          error: message
        }
      };
    }
  },
  async getLocalOpsLogs(limit = 20, type = "") {
    const params = new URLSearchParams({ limit: String(limit) });
    if (type) {
      params.set("type", type);
    }
    const response = await fetch(`${this.proxyBase}/api/logs-proxy?${params.toString()}`);
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async getOpsSummary() {
    const response = await fetch(`${this.proxyBase}/api/ops-summary`);
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async getOpsStatus() {
    const response = await fetch(`${this.proxyBase}/api/ops-status`);
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async getLatestOpsReport() {
    const response = await fetch(`${this.proxyBase}/api/ops-report-latest`);
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async exportOpsReport() {
    const response = await fetch(`${this.proxyBase}/api/export-ops-report`, {
      method: "POST"
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async repairLocalState() {
    const response = await fetch(`${this.proxyBase}/api/repair-local-state`, {
      method: "POST"
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async pruneLocalState() {
    const response = await fetch(`${this.proxyBase}/api/prune-local-state`, {
      method: "POST"
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async backupLocalState() {
    const response = await fetch(`${this.proxyBase}/api/backup-local-state`, {
      method: "POST"
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async restoreLocalState() {
    const response = await fetch(`${this.proxyBase}/api/restore-local-state`, {
      method: "POST"
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async runDailyCheck() {
    const response = await fetch(`${this.proxyBase}/api/run-daily-check`, {
      method: "POST"
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async runIntegrityAudit() {
    const response = await fetch(`${this.proxyBase}/api/run-integrity-audit`, {
      method: "POST"
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async runMaintenanceCycle() {
    const response = await fetch(`${this.proxyBase}/api/run-maintenance-cycle`, {
      method: "POST"
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  heartbeatPayload(signature, timestampIso) {
    return {
      signature,
      timestamp: timestampIso,
      btcAddress: this.btcAddress
    };
  },
  async postHeartbeat(signature, timestampIso) {
    const response = await fetch("https://aibtc.com/api/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.heartbeatPayload(signature, timestampIso))
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async getHeartbeatStatus() {
    const response = await fetch(`${this.proxyBase}/api/heartbeat-proxy?btcAddress=${encodeURIComponent(this.btcAddress)}`);
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  getNextHeartbeatInfo(lastCheckInAtIso) {
    if (!lastCheckInAtIso) {
      return this.enrichHeartbeatWindow({
        lastCheckInAtIso: null,
        nextCheckInAtIso: null,
        waitMs: null,
        waitSeconds: null,
        readyNow: true
      });
    }
    const last = new Date(lastCheckInAtIso).getTime();
    const next = last + 5 * 60 * 1000;
    const now = Date.now();
    const waitMs = Math.max(0, next - now);
    return this.enrichHeartbeatWindow({
      lastCheckInAtIso,
      nextCheckInAtIso: new Date(next).toISOString(),
      waitMs,
      waitSeconds: Math.ceil(waitMs / 1000),
      readyNow: waitMs === 0
    });
  },
  getNextHeartbeatInfoFromNextIso(nextCheckInAtIso) {
    if (!nextCheckInAtIso) {
      return this.enrichHeartbeatWindow({
        lastCheckInAtIso: null,
        nextCheckInAtIso: null,
        waitMs: null,
        waitSeconds: null,
        readyNow: true
      });
    }
    const next = new Date(nextCheckInAtIso).getTime();
    const now = Date.now();
    const waitMs = Math.max(0, next - now);
    return this.enrichHeartbeatWindow({
      lastCheckInAtIso: null,
      nextCheckInAtIso: new Date(next).toISOString(),
      waitMs,
      waitSeconds: Math.ceil(waitMs / 1000),
      readyNow: waitMs === 0
    });
  },
  extractHeartbeatWindowFromLogEvent(event) {
    const details = event?.details || {};
    const postBody = details?.postResult?.body || details?.result?.body || {};
    if (details?.timestampIso) {
      return this.getNextHeartbeatInfo(details.timestampIso);
    }
    if (postBody?.nextCheckInAt) {
      return this.getNextHeartbeatInfoFromNextIso(postBody.nextCheckInAt);
    }
    if (postBody?.lastCheckInAt) {
      return this.getNextHeartbeatInfo(postBody.lastCheckInAt);
    }
    return null;
  },
  async getHeartbeatWindowFromLocalLogs() {
    const result = await this.getLocalOpsLogs(20);
    const events = result?.body?.events || [];
    const relevant = [...events]
      .reverse()
      .find((event) => event?.type === "heartbeat_success" || event?.type === "heartbeat_attempt");
    const heartbeatWindow = this.extractHeartbeatWindowFromLogEvent(relevant);
    return {
      status: result.status,
      source: relevant ? "local_log" : "none",
      event: relevant || null,
      heartbeatWindow: heartbeatWindow || this.getNextHeartbeatInfo(null)
    };
  },
  async getLatestLocalEvent(eventType) {
    const result = await this.getLocalOpsLogs(50, eventType);
    const events = result?.body?.events || [];
    return {
      status: result.status,
      event: events.length ? events[events.length - 1] : null
    };
  },
  wrapReadError(label, error) {
    return {
      status: 0,
      body: {
        error: error?.message || String(error),
        source: label
      }
    };
  },
  getFallbackOperationalStateFromHeartbeat(heartbeat) {
    const timestampIso = heartbeat?.timestampIso || null;
    const heartbeatWindow = this.getNextHeartbeatInfo(timestampIso);
    const latestHeartbeatSuccess = heartbeat?.postResult?.status === 200
      ? {
        type: "heartbeat_success",
        details: {
          timestampIso
        }
      }
      : null;
    return {
      displayName: this.displayName,
      btcAddress: this.btcAddress,
      stxAddress: this.stxAddress,
      heartbeat: heartbeat?.statusResult || this.wrapReadError("heartbeat_status", new Error("refresh fallback")),
      heartbeatWindow,
      heartbeatWindowSource: "local_log",
      latestHeartbeatSuccess,
      identity: this.wrapReadError("identity", new Error("not refreshed")),
      verify: this.wrapReadError("verify", new Error("not refreshed"))
    };
  },
  async runHeartbeatCycle() {
    const timestampIso = new Date().toISOString();
    const message = this.heartbeatMessage(timestampIso);
    const signature = await this.signBitcoinMessageWithLeather(message, "p2wpkh");
    const postResult = await this.postHeartbeat(signature, timestampIso);
    let statusResult;
    try {
      statusResult = await this.getHeartbeatStatus();
    } catch (error) {
      statusResult = this.wrapReadError("heartbeat_status", error);
    }
    const result = {
      timestampIso,
      message,
      signatureLength: signature.length,
      postResult,
      statusResult,
      logResult: null
    };
    const logType = postResult.status === 200 ? "heartbeat_success" : "heartbeat_attempt";
    result.logResult = await this.tryLogEvent(logType, {
      timestampIso,
      postResult,
      statusResult
    });
    return result;
  },
  async runHeartbeatCycleAndRefresh() {
    const heartbeat = await this.runHeartbeatCycle();
    const [opsStatusResult] = await Promise.allSettled([
      this.getOpsStatus()
    ]);
    const warnings = [];
    const opsStatus = opsStatusResult.status === "fulfilled"
      ? opsStatusResult.value
      : (() => {
        warnings.push(`ops-status: ${opsStatusResult.reason?.message || String(opsStatusResult.reason)}`);
        return null;
      })();
    const logs = opsStatus
      ? {
        status: opsStatus.status,
        total: opsStatus.body?.recentEvents?.length || 0,
        events: opsStatus.body?.recentEvents || []
      }
      : {
        status: 0,
        total: 0,
        events: []
      };
    const registry = opsStatus
      ? {
        status: opsStatus.body?.registry?.statusCode || 200,
        body: opsStatus.body?.registry || {}
      }
      : {
        status: 0,
        body: {
          error: "ops-status indisponivel"
        }
      };
    return {
      heartbeat,
      opsStatus,
      logs,
      registry,
      warnings
    };
  },
  async recordManualHeartbeatSuccess(timestampIso, postResult, statusResult = null) {
    return this.tryLogEvent("heartbeat_success", {
      timestampIso,
      postResult,
      statusResult,
      warnings: ["manual_backfill_after_confirmed_api_200"]
    });
  },
  mapOpsStatusToOperationalState(opsStatusResult) {
    const body = opsStatusResult?.body || {};
    const heartbeat = body.heartbeat || {};
    const latestSuccessIso = heartbeat?.latestSuccess?.timestampIso || heartbeat?.latestSuccess?.loggedAt || null;
    const heartbeatWindow = heartbeat.nextCheckInUtc
      ? this.getNextHeartbeatInfoFromNextIso(heartbeat.nextCheckInUtc)
      : this.getNextHeartbeatInfo(latestSuccessIso);
    return {
      displayName: this.displayName,
      btcAddress: this.btcAddress,
      stxAddress: this.stxAddress,
      heartbeat: {
        status: 200,
        body: heartbeat
      },
      heartbeatWindow,
      heartbeatWindowSource: heartbeat?.latestSuccess ? "local_log" : "none",
      latestHeartbeatSuccess: heartbeat?.latestSuccess
        ? { details: { timestampIso: latestSuccessIso } }
        : null,
      identity: this.wrapReadError("identity", new Error("identity not loaded in consolidated state")),
      verify: this.wrapReadError("verify", new Error("verify not loaded in consolidated state"))
    };
  },
  async refreshOperationalState() {
    try {
      const opsStatus = await this.getOpsStatus();
      return this.mapOpsStatusToOperationalState(opsStatus);
    } catch {
    }
    const [heartbeatResult, identityResult, verifyResult] = await Promise.allSettled([
      this.getHeartbeatStatus(),
      this.getIdentity(),
      this.getVerify()
    ]);
    const heartbeat = heartbeatResult.status === "fulfilled"
      ? heartbeatResult.value
      : this.wrapReadError("heartbeat_status", heartbeatResult.reason);
    const identity = identityResult.status === "fulfilled"
      ? identityResult.value
      : this.wrapReadError("identity", identityResult.reason);
    const verify = verifyResult.status === "fulfilled"
      ? verifyResult.value
      : this.wrapReadError("verify", verifyResult.reason);
    const lastCheckInAt = heartbeat?.body?.orientation?.lastCheckInAt
      || heartbeat?.body?.lastCheckInAt
      || heartbeat?.body?.checkIn?.createdAt
      || null;
    let heartbeatWindow = this.getNextHeartbeatInfo(lastCheckInAt);
    let heartbeatWindowSource = "remote";
    if (!lastCheckInAt) {
      const localWindowResult = await this.getHeartbeatWindowFromLocalLogs();
      heartbeatWindow = localWindowResult.heartbeatWindow;
      heartbeatWindowSource = localWindowResult.source;
    }
    const latestHeartbeatSuccess = await this.getLatestLocalEvent("heartbeat_success");
    return {
      displayName: this.displayName,
      btcAddress: this.btcAddress,
      stxAddress: this.stxAddress,
      heartbeat,
      heartbeatWindow,
      heartbeatWindowSource,
      latestHeartbeatSuccess: latestHeartbeatSuccess.event,
      identity,
      verify
    };
  },
  viralPayload(tweetUrl) {
    return {
      tweetUrl,
      btcAddress: this.btcAddress
    };
  },
  async postViralClaim(tweetUrl) {
    const response = await fetch("https://aibtc.com/api/claims/viral", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.viralPayload(tweetUrl))
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    const result = { status: response.status, body };
    console.log(result);
    await this.tryLogEvent(response.status === 200 ? "viral_claim_success" : "viral_claim_attempt", {
      tweetUrl,
      result
    });
    return result;
  },
  async getIdentity() {
    const response = await fetch(`${this.proxyBase}/api/identity-proxy?stxAddress=${encodeURIComponent(this.stxAddress)}`);
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async getVerify() {
    const response = await fetch(`${this.proxyBase}/api/verify-proxy?stxAddress=${encodeURIComponent(this.stxAddress)}`);
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    console.log({ status: response.status, body });
    return { status: response.status, body };
  },
  async getRegistryStatus() {
    const response = await fetch(`${this.proxyBase}/api/registry-proxy`);
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    const result = { status: response.status, body };
    console.log(result);
    await this.tryLogEvent("registry_check", {
      result
    });
    return result;
  }
};

console.log("AIBTC snippets loaded", AIBTC_AGENT);
