import assert from "node:assert/strict";
import test from "node:test";
import { KiteH1ExactShadowPacketBridge } from "../kite-h1-exact-shadow-packet-bridge.js";
import type { KiteDecodedPacket } from "../kite-websocket-binary-decoder.js";
import type { KiteH1ExactDualPathResult } from "../kite-h1-exact-dual-path-core.js";

function packet(token: number): KiteDecodedPacket {
  return { instrumentToken: token } as KiteDecodedPacket;
}

function result(token: number, exactReady = false, processed = true): KiteH1ExactDualPathResult {
  return {
    version: "KITE_H1_EXACT_DUAL_PATH_CORE_V1",
    instrumentToken: token,
    processed,
    exactReady,
    immediate: null,
    exact: null,
    blockers: processed ? [] : ["H1_EXACT_PATH_EXCEPTION"],
    productionImpact: "NONE",
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    failClosed: true,
  };
}

test("feeds decoded packets without opening transport or granting authority", async () => {
  const seen: number[] = [];
  const bridge = new KiteH1ExactShadowPacketBridge({
    async ingestPacket(p) {
      seen.push(p.instrumentToken);
      return result(p.instrumentToken, p.instrumentToken === 22);
    },
  });

  const out = await bridge.ingestTicks([packet(11), packet(22)], "2026-09-03T10:00:00.000Z");
  assert.equal(out.accepted, true);
  assert.deepEqual(seen, [11, 22]);
  assert.equal(out.status.packetCount, 2);
  assert.equal(out.status.exactReadyCount, 1);
  assert.equal(out.status.opensTransport, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsVerdict, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.productionImpact, "NONE");
});

test("fails closed when decoded tick batch is empty", async () => {
  const bridge = new KiteH1ExactShadowPacketBridge({
    async ingestPacket(p) { return result(p.instrumentToken); },
  });
  const out = await bridge.ingestTicks([], "2026-09-03T10:00:00.000Z");
  assert.equal(out.accepted, false);
  assert.deepEqual(out.blockers, ["NO_DECODED_TICKS"]);
  assert.equal(out.status.rejectedCount, 1);
});

test("fails closed on invalid packet chronology metadata", async () => {
  let called = false;
  const bridge = new KiteH1ExactShadowPacketBridge({
    async ingestPacket(p) { called = true; return result(p.instrumentToken); },
  });
  const out = await bridge.ingestTicks([packet(33)], "not-a-time");
  assert.equal(out.accepted, false);
  assert.equal(called, false);
  assert.ok(out.blockers.includes("INVALID_SHADOW_PACKET_TIME"));
});

test("contains per-packet processor exceptions and continues remaining shadow evidence", async () => {
  const seen: number[] = [];
  const bridge = new KiteH1ExactShadowPacketBridge({
    async ingestPacket(p) {
      seen.push(p.instrumentToken);
      if (p.instrumentToken === 44) throw new Error("boom");
      return result(p.instrumentToken, true);
    },
  });
  const out = await bridge.ingestTicks([packet(44), packet(55)], "2026-09-03T10:00:00.000Z");
  assert.equal(out.accepted, false);
  assert.deepEqual(seen, [44, 55]);
  assert.deepEqual(out.blockers, ["PACKET_PROCESSOR_EXCEPTION:44"]);
  assert.equal(out.status.packetCount, 1);
  assert.equal(out.status.exactReadyCount, 1);
  assert.equal(out.status.rejectedCount, 1);
});

test("counts dual-path fail-closed results as rejected without promoting exact readiness", async () => {
  const bridge = new KiteH1ExactShadowPacketBridge({
    async ingestPacket(p) { return result(p.instrumentToken, false, false); },
  });
  const out = await bridge.ingestTicks([packet(66)], "2026-09-03T10:00:00.000Z");
  assert.equal(out.accepted, true);
  assert.equal(out.status.packetCount, 1);
  assert.equal(out.status.exactReadyCount, 0);
  assert.equal(out.status.rejectedCount, 1);
  assert.equal(out.status.lastExactReadyTimestamp, null);
});
