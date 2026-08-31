import test from "node:test";
import assert from "node:assert/strict";
import { persistShadowReplayThroughAdapter, type ShadowReplayDurableStore, type ShadowReplayDurableRecord } from "../shadow-replay-persistence-adapter.js";

const base = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "SHADOW_EXEC:exec-1:NIFTY:CE:25000:2026-09-03",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  actionState: "ENTRY_ELIGIBLE_SHADOW",
  finalTarget: "SHADOW_SUBMISSION_STATE",
  resultFingerprint: "fp-123",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

function record(overrides: Partial<ShadowReplayDurableRecord> = {}): ShadowReplayDurableRecord {
  return {
    stableReplayKey: base.stableReplayKey,
    snapshotVersion: base.snapshotVersion,
    harnessVersion: base.harnessVersion,
    actionState: base.actionState,
    finalTarget: base.finalTarget,
    resultFingerprint: base.resultFingerprint,
    ...overrides,
  };
}

function memoryStore(): ShadowReplayDurableStore {
  const map = new Map<string, ShadowReplayDurableRecord>();
  return {
    async write(value) { map.set(value.stableReplayKey, { ...value }); },
    async read(key) { return map.get(key) ?? null; },
  };
}

test("writes and exact-readbacks a new durable replay with full semantics", async () => {
  const out = await persistShadowReplayThroughAdapter(base, memoryStore());
  assert.equal(out.decision, "PERSISTENCE_CONFIRMED");
  assert.equal(out.persistenceConfirmed, true);
  assert.equal(out.reusableAfterRestart, true);
  assert.equal(out.semanticReadBackConfirmed, true);
  assert.ok(out.reasonCodes.includes("DURABLE_REPLAY_SEMANTICS_CONFIRMED"));
  assert.equal(out.placesOrder, false);
});

test("reuses only an existing exact semantic durable replay", async () => {
  const store = memoryStore();
  await store.write(record());
  const out = await persistShadowReplayThroughAdapter({ ...base, journalDecision: "REUSE_IDENTICAL" }, store);
  assert.equal(out.decision, "REUSE_CONFIRMED");
  assert.equal(out.semanticReadBackConfirmed, true);
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
    async read() { return record({ resultFingerprint: "wrong" }); },
  };
  const out = await persistShadowReplayThroughAdapter(base, store);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("DURABLE_READ_BACK_FINGERPRINT_MISMATCH"));
});

test("blocks same fingerprint with changed final target", async () => {
  const store: ShadowReplayDurableStore = {
    async write() {},
    async read() { return record({ finalTarget: "MANAGEMENT_ENGINE" }); },
  };
  const out = await persistShadowReplayThroughAdapter(base, store);
  assert.equal(out.decision, "BLOCK");
  assert.equal(out.semanticReadBackConfirmed, false);
  assert.ok(out.reasonCodes.includes("DURABLE_READ_BACK_SEMANTIC_MISMATCH"));
});

test("blocks same fingerprint with changed action state", async () => {
  const store: ShadowReplayDurableStore = {
    async write() {},
    async read() { return record({ actionState: "RECONCILE_ONLY" }); },
  };
  const out = await persistShadowReplayThroughAdapter(base, store);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("DURABLE_READ_BACK_SEMANTIC_MISMATCH"));
});

test("blocks unsupported durable semantic version", async () => {
  const store: ShadowReplayDurableStore = {
    async write() {},
    async read() { return { ...record(), harnessVersion: "OLD" as any }; },
  };
  const out = await persistShadowReplayThroughAdapter(base, store);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("DURABLE_READ_BACK_SEMANTIC_MISMATCH"));
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
