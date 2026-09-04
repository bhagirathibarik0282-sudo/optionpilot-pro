import test from "node:test";
import assert from "node:assert/strict";
import {
  getH1DynamicReadOnlyServerStatus,
  isH1DynamicReadOnlyLiveEnabled,
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
  const fakeService = {
    status: () => ({
      version: "H1_LIVE_EXACT_READONLY_WEBSOCKET_SERVICE_V1" as const,
      started: true,
      connected: true,
      state: "OPEN" as const,
      subscribedTokenCount: 21,
      receivedPacketCount: 42,
      rejectedPacketCount: 0,
      lastPacketTimestamp: "2026-09-04T07:50:00.000Z",
      productionImpact: "NONE" as const,
      readOnly: true as const,
      forwardsDownstream: false as const,
      affectsDirection: false as const,
      affectsVerdict: false as const,
      affectsExecution: false as const,
      affectsTelegram: false as const,
      failClosed: true as const,
    }),
  } as unknown as H1LiveExactReadOnlyWebSocketService;

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
  assert.equal(out.lastPacketTimestamp, "2026-09-04T07:50:00.000Z");
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
