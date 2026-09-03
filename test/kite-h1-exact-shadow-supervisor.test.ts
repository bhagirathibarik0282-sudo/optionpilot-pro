import test from "node:test";
import assert from "node:assert/strict";
import { KiteH1ExactShadowSupervisor, type KiteH1ExactDualPathIngestor } from "../kite-h1-exact-shadow-supervisor.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import type { KiteH1ExactDualPathResult } from "../kite-h1-exact-dual-path-core.js";

class FakeSocket {
  binaryType = "";
  readyState = 1;
  sent: string[] = [];
  listeners = new Map<string, Array<(event: any) => void>>();
  send(data: string) { this.sent.push(data); }
  close() { this.emit("close", {}); }
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: any) => void) {
    const rows = this.listeners.get(type) ?? [];
    rows.push(listener);
    this.listeners.set(type, rows);
  }
  emit(type: string, event: any) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

function registry() {
  return new KiteImmediateTokenRegistry([
    { instrumentToken: 256265, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY-SPOT" },
  ]);
}

function fullIndexFrame(): ArrayBuffer {
  const packet = new Uint8Array(32);
  const packetView = new DataView(packet.buffer);
  packetView.setInt32(0, 256265, false);
  packetView.setInt32(4, 2408050, false);
  packetView.setInt32(28, 1_700_000_000, false);
  const frame = new Uint8Array(36);
  const frameView = new DataView(frame.buffer);
  frameView.setUint16(0, 1, false);
  frameView.setUint16(2, packet.byteLength, false);
  frame.set(packet, 4);
  return frame.buffer;
}

function result(exactReady = true, processed = true): KiteH1ExactDualPathResult {
  return {
    version: "KITE_H1_EXACT_DUAL_PATH_CORE_V1",
    instrumentToken: 256265,
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

const okRuntime: KiteH1ExactDualPathIngestor = {
  async ingestPacket() { return result(); },
};

test("disabled supervisor is inert and has no production authority", () => {
  const s = new KiteH1ExactShadowSupervisor({ enabled: false, registry: registry(), runtime: okRuntime });
  const status = s.start();
  assert.equal(status.state, "DISABLED");
  assert.equal(status.subscribedTokenCount, 0);
  assert.equal(status.productionImpact, "NONE");
  assert.equal(status.affectsTelegram, false);
  assert.equal(status.affectsVerdict, false);
  assert.equal(status.affectsExecution, false);
});

test("enabled supervisor fails closed without credentials", () => {
  const s = new KiteH1ExactShadowSupervisor({ enabled: true, registry: registry(), runtime: okRuntime });
  assert.throws(() => s.start(), /CREDENTIALS_REQUIRED/);
});

test("enabled supervisor subscribes only the exact registry in FULL mode", () => {
  const socket = new FakeSocket();
  const s = new KiteH1ExactShadowSupervisor({
    enabled: true, apiKey: "k", accessToken: "t", registry: registry(), runtime: okRuntime, socketFactory: () => socket,
  });
  s.start();
  socket.emit("open", {});
  assert.deepEqual(JSON.parse(socket.sent[0]), { a: "subscribe", v: [256265] });
  assert.deepEqual(JSON.parse(socket.sent[1]), { a: "mode", v: ["full", [256265]] });
  assert.equal(s.status().connected, true);
  s.stop();
});

test("decoded FULL packet reaches the dual-path runtime and updates exact readiness", async () => {
  const socket = new FakeSocket();
  let calls = 0;
  const runtime: KiteH1ExactDualPathIngestor = {
    async ingestPacket(packet) {
      calls += 1;
      assert.equal(packet.instrumentToken, 256265);
      assert.equal(packet.mode, "full");
      return result(true, true);
    },
  };
  const s = new KiteH1ExactShadowSupervisor({
    enabled: true, apiKey: "k", accessToken: "t", registry: registry(), runtime, socketFactory: () => socket,
  });
  s.start();
  socket.emit("open", {});
  socket.emit("message", { data: fullIndexFrame() });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(s.status().processedPacketCount, 1);
  assert.ok(s.status().lastExactReadyTimestamp);
  assert.equal(s.status().dualPathBlockedCount, 0);
  s.stop();
});

test("blocked result and thrown runtime remain observable without escaping transport", async () => {
  const socket = new FakeSocket();
  let calls = 0;
  const runtime: KiteH1ExactDualPathIngestor = {
    async ingestPacket() {
      calls += 1;
      if (calls === 1) return result(false, false);
      throw new Error("synthetic");
    },
  };
  const s = new KiteH1ExactShadowSupervisor({
    enabled: true, apiKey: "k", accessToken: "t", registry: registry(), runtime, socketFactory: () => socket,
  });
  s.start();
  socket.emit("message", { data: fullIndexFrame() });
  socket.emit("message", { data: fullIndexFrame() });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(s.status().processedPacketCount, 1);
  assert.equal(s.status().dualPathBlockedCount, 1);
  assert.equal(s.status().runtimeExceptionCount, 1);
  assert.equal(s.status().lastExactReadyTimestamp, null);
  s.stop();
});
