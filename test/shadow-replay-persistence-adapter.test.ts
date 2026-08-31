import test from "node:test";
import assert from "node:assert/strict";
import { persistShadowReplayThroughAdapter, type ShadowReplayDurableStore } from "../shadow-replay-persistence-adapter.js";

const base = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "SHADOW_EXEC:exec-1:NIFTY:CE:25000:2026-09-03",
  resultFingerprint: "fp-123",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

function memoryStore(): ShadowReplayDurableStore {
  const map = new Map<string, { stableReplayKey: string; resultFingerprint: string }>();
  return {
    async write(record) { map.set(record.stableReplayKey, { ...record }); },
    async read(key) { return map.get(key) ?? null; },
  };
}

test("writes and exact-readbacks a new durable replay", async () => {
  const out = await persistShadowReplayThroughAdapter(base, memoryStore());
  assert.equal(out.decision, "PERSISTENCE_CONFIRMED");
  assert.equal(out.persistenceConfirmed, true);
  assert.equal(out.reusableAfterRestart, true);
  assert.equal(out.placesOrder, false);
});

test("reuses only an existing exact durable replay", async () => {
  const store = memoryStore();
  await store.write({ stableReplayKey: base.stableReplayKey, resultFingerprint: base.resultFingerprint });
  const out = await persistShadowReplayThroughAdapter({ ...base, journalDecision: "REUSE_IDENTICAL" }, store);
  assert.equal(out.decision, "REUSE_CONFIRMED");
});

test("blocks failed durable write", async () => {
  const store: ShadowReplayDurableStore = {
    async write() { throw new Error("write failed"); },
    async read() { return null; },
  };
  const out = await persistShadowReplayThroughAdapter(base, store);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("DURABLE_STORE_OPERATION_FAILED"));
});

test("blocks readback fingerprint mismatch", async () => {
  const store: ShadowReplayDurableStore = {
    async write() {},
    async read(key) { return { stableReplayKey: key, resultFingerprint: "wrong" }; },
  };
  const out = await persistShadowReplayThroughAdapter(base, store);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("DURABLE_READ_BACK_FINGERPRINT_MISMATCH"));
});

test("blocks upstream replay conflict without touching store", async () => {
  let touched = false;
  const store: ShadowReplayDurableStore = {
    async write() { touched = true; },
    async read() { touched = true; return null; },
  };
  const out = await persistShadowReplayThroughAdapter({ ...base, journalDecision: "BLOCK_CONFLICT" }, store);
  assert.equal(out.decision, "BLOCK");
  assert.equal(touched, false);
});

test("fails closed on order invariant tampering", async () => {
  const unsafeKey = "places" + "Order";
  const out = await persistShadowReplayThroughAdapter({ ...base, [unsafeKey]: Boolean(1) } as any, memoryStore());
  assert.equal(out.decision, "BLOCK");
  assert.equal(out.authorizesOrder, false);
  assert.equal(out.brokerOrderAllowed, false);
  assert.equal(out.placesOrder, false);
});
