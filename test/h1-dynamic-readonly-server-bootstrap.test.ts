import test from "node:test";
import assert from "node:assert/strict";
import {
  getH1DynamicReadOnlyServerStatus,
  isH1DynamicReadOnlyLiveEnabled,
  refreshH1DynamicReadOnlyLiveFromServerEnv,
  resetH1DynamicReadOnlyServerBootstrapForTest,
  startH1DynamicReadOnlyLiveFromServerEnv,
} from "../h1-dynamic-readonly-server-bootstrap.js";
import type { H1DynamicReadOnlyLiveStartResult } from "../h1-dynamic-readonly-live-chain.js";
import type { H1LiveExactReadOnlyWebSocketService } from "../h1-live-exact-readonly-websocket-service.js";

process.env.NODE_ENV = "test";

function liveResult(started = true, service: H1LiveExactReadOnlyWebSocketService | null = null): H1DynamicReadOnlyLiveStartResult {
  return {
    version: "H1_DYNAMIC_READONLY_LIVE_CHAIN_V1",
    started,
    reason: started ? "STARTED" : "PREPARATION_BLOCKED",
    subscribedTokenCount: started ? 21 : 0,
    constituentRegistryReady: false,
    constituentTokenCount: 0,
    constituentBlockers: [],
    productionImpact: "NONE",
    readOnly: true,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
    service,
  };
}

function fakeLifecycleService(state: "OPEN" | "ERROR" | "CLOSED" = "OPEN", onStop: () => void = () => {}): H1LiveExactReadOnlyWebSocketService {
  return {
    status: () => ({
      version: "H1_LIVE_EXACT_READONLY_WEBSOCKET_SERVICE_V1" as const,
      started: true,
      connected: state === "OPEN",
      state,
      subscribedTokenCount: 21,
      receivedPacketCount: state === "OPEN" ? 42 : 0,
      rejectedPacketCount: 0,
      lastPacketTimestamp: state === "OPEN" ? "2026-09-08T10:00:00.000Z" : null,
      rawEvidenceReady: false,
      rawEvidenceExpectedTokenCount: 21,
      rawEvidenceFreshTokenCount: 0,
      rawEvidenceMissingTokenCount: 21,
      rawEvidenceStaleTokenCount: 0,
      rawEvidenceMissing: [],
      rawEvidenceSymbolReadiness: [],
      nearestPeerReadiness: [],
      readOnlyConsumerReadySymbolCount: 0,
      readOnlyConsumerObservations: [],
      readOnlyDirectionReadySymbolCount: 0,
      readOnlyDirectionObservations: [],
      readOnlyShadowInputReadySymbolCount: 0,
      readOnlyShadowInputObservations: [],
      selectorRuntimePolicyReady: true,
      selectorRuntimeAttached: true,
      selectorRuntimeBlockers: [],
      greekEvidenceStatus: "NOT_CONFIGURED" as const,
      productionImpact: "NONE" as const,
      readOnly: true as const,
      forwardsDownstream: false as const,
      affectsDirection: false as const,
      affectsVerdict: false as const,
      affectsExecution: false as const,
      affectsTelegram: false as const,
      failClosed: true as const,
    }),
    stop: () => {
      onStop();
      return {} as any;
    },
  } as unknown as H1LiveExactReadOnlyWebSocketService;
}

test("default/off env performs zero live-chain calls", async () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  let calls = 0;
  const out = await startH1DynamicReadOnlyLiveFromServerEnv({}, async () => {
    calls += 1;
    return liveResult();
  });
  assert.equal(calls, 0);
  assert.equal(out.enabled, false);
  assert.equal(out.attempted, false);
  assert.equal(out.started, false);
  assert.equal(out.reason, "DISABLED");
  assert.equal(out.connected, false);
  assert.equal(out.socketState, "UNAVAILABLE");
  assert.equal(out.receivedPacketCount, 0);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
});

test("only exact true enables the bootstrap", () => {
  assert.equal(isH1DynamicReadOnlyLiveEnabled({ H1_DYNAMIC_READONLY_LIVE_ENABLED: "true" }), true);
  assert.equal(isH1DynamicReadOnlyLiveEnabled({ H1_DYNAMIC_READONLY_LIVE_ENABLED: " TRUE " }), true);
  assert.equal(isH1DynamicReadOnlyLiveEnabled({ H1_DYNAMIC_READONLY_LIVE_ENABLED: "1" }), false);
  assert.equal(isH1DynamicReadOnlyLiveEnabled({ H1_DYNAMIC_READONLY_LIVE_ENABLED: "yes" }), false);
});

test("enabled path calls the read-only chain once and exposes no service handle", async () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  let calls = 0;
  let receivedDate = "";
  const startFn = async (asOfDate: string, enabled: boolean) => {
    calls += 1;
    receivedDate = asOfDate;
    assert.equal(enabled, true);
    return liveResult();
  };
  const env = { H1_DYNAMIC_READONLY_LIVE_ENABLED: "true" };
  const now = new Date("2026-09-03T20:00:00.000Z");
  const first = await startH1DynamicReadOnlyLiveFromServerEnv(env, startFn, now);
  const second = await startH1DynamicReadOnlyLiveFromServerEnv(env, startFn, now);
  assert.equal(calls, 1);
  assert.equal(receivedDate, "2026-09-04");
  assert.equal(first.started, true);
  assert.equal(first.subscribedTokenCount, 21);
  assert.deepEqual(second, first);
  assert.equal("service" in first, false);
});

test("public status reflects ongoing read-only socket packet counters without exposing service", async () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  const fakeService = fakeLifecycleService("OPEN");

  await startH1DynamicReadOnlyLiveFromServerEnv(
    { H1_DYNAMIC_READONLY_LIVE_ENABLED: "true" },
    async () => liveResult(true, fakeService),
    new Date("2026-09-04T04:00:00.000Z"),
  );

  const out = getH1DynamicReadOnlyServerStatus();
  assert.equal(out.connected, true);
  assert.equal(out.socketState, "OPEN");
  assert.equal(out.receivedPacketCount, 42);
  assert.equal(out.rejectedPacketCount, 0);
  assert.equal(out.selectorRuntimePolicyReady, true);
  assert.equal(out.selectorRuntimeAttached, true);
  assert.deepEqual(out.selectorRuntimeBlockers, []);
  assert.equal(out.forwardsDownstream, false);
  assert.equal(out.affectsDirection, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal("service" in out, false);
});

test("startup exception fails closed", async () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  const out = await startH1DynamicReadOnlyLiveFromServerEnv(
    { H1_DYNAMIC_READONLY_LIVE_ENABLED: "true" },
    async () => { throw new Error("boom"); },
    new Date("2026-09-04T04:00:00.000Z"),
  );
  assert.equal(out.started, false);
  assert.equal(out.reason, "START_FAILED");
  assert.equal(out.subscribedTokenCount, 0);
  assert.equal(out.socketState, "UNAVAILABLE");
  assert.deepEqual(getH1DynamicReadOnlyServerStatus(), out);
});

test("disabled status keeps selector runtime fail-closed", async () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  const out = await startH1DynamicReadOnlyLiveFromServerEnv({}, async () => liveResult());
  assert.equal(out.selectorRuntimePolicyReady, false);
  assert.equal(out.selectorRuntimeAttached, false);
  assert.deepEqual(out.selectorRuntimeBlockers, []);
});

test("lifecycle refresh restarts the read-only chain on IST date rollover", async () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  const env = { H1_DYNAMIC_READONLY_LIVE_ENABLED: "true" };
  const dates: string[] = [];
  let stops = 0;
  const startFn = async (asOfDate: string) => {
    dates.push(asOfDate);
    return liveResult(true, fakeLifecycleService("OPEN", () => { stops += 1; }));
  };

  await startH1DynamicReadOnlyLiveFromServerEnv(env, startFn, new Date("2026-09-08T18:29:00.000Z"));
  const refreshed = await refreshH1DynamicReadOnlyLiveFromServerEnv(env, startFn, new Date("2026-09-08T18:31:00.000Z"));

  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.reason, "IST_DATE_ROLLOVER");
  assert.deepEqual(dates, ["2026-09-08", "2026-09-09"]);
  assert.equal(stops, 1);
  assert.equal(refreshed.status.asOfDate, "2026-09-09");
  assert.equal(refreshed.status.started, true);
  assert.equal(refreshed.status.affectsExecution, false);
  assert.equal(refreshed.status.affectsTelegram, false);
});

test("lifecycle refresh retries a chain that was not started", async () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  const env = { H1_DYNAMIC_READONLY_LIVE_ENABLED: "true" };
  let calls = 0;
  const startFn = async () => {
    calls += 1;
    return calls === 1 ? liveResult(false, null) : liveResult(true, fakeLifecycleService("OPEN"));
  };

  const first = await startH1DynamicReadOnlyLiveFromServerEnv(env, startFn, new Date("2026-09-09T03:40:00.000Z"));
  assert.equal(first.started, false);
  const refreshed = await refreshH1DynamicReadOnlyLiveFromServerEnv(env, startFn, new Date("2026-09-09T03:41:00.000Z"));

  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.reason, "RUNTIME_NOT_STARTED");
  assert.equal(calls, 2);
  assert.equal(refreshed.status.started, true);
  assert.equal(refreshed.status.connected, true);
});

test("lifecycle refresh rebinds an unhealthy socket but leaves a healthy same-day socket alone", async () => {
  resetH1DynamicReadOnlyServerBootstrapForTest();
  const env = { H1_DYNAMIC_READONLY_LIVE_ENABLED: "true" };
  let calls = 0;
  let stops = 0;
  const startFn = async () => {
    calls += 1;
    const state = calls === 1 ? "ERROR" : "OPEN";
    return liveResult(true, fakeLifecycleService(state, () => { stops += 1; }));
  };

  await startH1DynamicReadOnlyLiveFromServerEnv(env, startFn, new Date("2026-09-09T04:00:00.000Z"));
  const recovered = await refreshH1DynamicReadOnlyLiveFromServerEnv(env, startFn, new Date("2026-09-09T04:01:00.000Z"));
  assert.equal(recovered.refreshed, true);
  assert.equal(recovered.reason, "SOCKET_UNHEALTHY");
  assert.equal(calls, 2);
  assert.equal(stops, 1);
  assert.equal(recovered.status.connected, true);

  const healthy = await refreshH1DynamicReadOnlyLiveFromServerEnv(env, startFn, new Date("2026-09-09T04:02:00.000Z"));
  assert.equal(healthy.refreshed, false);
  assert.equal(healthy.reason, null);
  assert.equal(calls, 2);
});