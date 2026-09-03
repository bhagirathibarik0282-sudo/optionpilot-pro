import test from "node:test";
import assert from "node:assert/strict";
import {
  KiteH1ExactDualPathCore,
  type KiteH1ExactPacketPath,
  type KiteImmediatePacketPath,
} from "../kite-h1-exact-dual-path-core.js";
import type { H1KiteExactRuntimeCoordinatorResult } from "../h1-kite-exact-runtime-coordinator.js";
import type { KiteImmediateRuntimePacketResult } from "../kite-immediate-runtime-core.js";
import type { KiteDecodedPacket } from "../kite-websocket-binary-decoder.js";

const packet = {
  mode: "full",
  instrumentToken: 111,
  lastPrice: 100,
  exchangeTimestamp: "2026-09-03T10:00:00.000Z",
  isIndex: true,
} as KiteDecodedPacket;

function immediateResult(): KiteImmediateRuntimePacketResult {
  return {
    version: "KITE_IMMEDIATE_RUNTIME_CORE_V1",
    instrumentToken: 111,
    ignoredReason: null,
    decision: null,
    freshEventsAdded: 0,
    productionImpact: "NONE",
  };
}

function exactResult(ready = true): H1KiteExactRuntimeCoordinatorResult {
  return {
    version: "H1_KITE_EXACT_RUNTIME_COORDINATOR_V1",
    ready,
    instrumentToken: 111,
    action: "UNDERLYING_CACHED",
    bridge: null,
    blocker: ready ? null : "INVALID_EXACT_UNDERLYING_PACKET",
    productionImpact: "NONE",
    failClosed: true,
  };
}

test("one packet is processed by both isolated paths", async () => {
  let immediateCalls = 0;
  let exactCalls = 0;
  const immediate: KiteImmediatePacketPath = {
    async ingestPacket() { immediateCalls += 1; return immediateResult(); },
  };
  const exact: KiteH1ExactPacketPath = {
    ingest() { exactCalls += 1; return exactResult(); },
  };

  const out = await new KiteH1ExactDualPathCore(immediate, exact)
    .ingestPacket(packet, "2026-09-03T10:00:00.500Z");

  assert.equal(immediateCalls, 1);
  assert.equal(exactCalls, 1);
  assert.equal(out.processed, true);
  assert.equal(out.exactReady, true);
  assert.deepEqual(out.blockers, []);
});

test("exact-path exception is contained while immediate evidence survives", async () => {
  const immediate: KiteImmediatePacketPath = { async ingestPacket() { return immediateResult(); } };
  const exact: KiteH1ExactPacketPath = { ingest() { throw new Error("synthetic"); } };
  const out = await new KiteH1ExactDualPathCore(immediate, exact)
    .ingestPacket(packet, "2026-09-03T10:00:00.500Z");

  assert.equal(out.processed, false);
  assert.equal(out.immediate?.instrumentToken, 111);
  assert.equal(out.exact, null);
  assert.deepEqual(out.blockers, ["H1_EXACT_PATH_EXCEPTION"]);
});

test("immediate-path exception is contained while exact evidence survives", async () => {
  const immediate: KiteImmediatePacketPath = { async ingestPacket() { throw new Error("synthetic"); } };
  const exact: KiteH1ExactPacketPath = { ingest() { return exactResult(); } };
  const out = await new KiteH1ExactDualPathCore(immediate, exact)
    .ingestPacket(packet, "2026-09-03T10:00:00.500Z");

  assert.equal(out.processed, false);
  assert.equal(out.immediate, null);
  assert.equal(out.exact?.instrumentToken, 111);
  assert.deepEqual(out.blockers, ["IMMEDIATE_PATH_EXCEPTION"]);
});

test("exact path starts without waiting for the asynchronous immediate path", async () => {
  let exactStarted = false;
  const immediate: KiteImmediatePacketPath = {
    async ingestPacket() {
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(exactStarted, true);
      return immediateResult();
    },
  };
  const exact: KiteH1ExactPacketPath = {
    ingest() { exactStarted = true; return exactResult(); },
  };

  const out = await new KiteH1ExactDualPathCore(immediate, exact)
    .ingestPacket(packet, "2026-09-03T10:00:00.500Z");
  assert.equal(out.processed, true);
});

test("non-ready exact evidence stays fail-closed without becoming an exception", async () => {
  const immediate: KiteImmediatePacketPath = { async ingestPacket() { return immediateResult(); } };
  const exact: KiteH1ExactPacketPath = { ingest() { return exactResult(false); } };
  const out = await new KiteH1ExactDualPathCore(immediate, exact)
    .ingestPacket(packet, "2026-09-03T10:00:00.500Z");

  assert.equal(out.processed, true);
  assert.equal(out.exactReady, false);
  assert.equal(out.exact?.blocker, "INVALID_EXACT_UNDERLYING_PACKET");
  assert.deepEqual(out.blockers, []);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
});
