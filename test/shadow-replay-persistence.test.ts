import test from "node:test";
import assert from "node:assert/strict";
import { verifyShadowReplayPersistence } from "../shadow-replay-persistence.js";

const base = {
  journalVersion: "SHADOW_EXECUTION_REPLAY_JOURNAL_V1" as const,
  journalDecision: "RECORD_NEW" as const,
  stableReplayKey: "SHADOW_EXEC:exec-1:NIFTY-CE-25000",
  resultFingerprint: "fp-1",
  writeAttempted: true,
  writeSucceeded: true,
  readBackFound: true,
  readBackReplayKey: "SHADOW_EXEC:exec-1:NIFTY-CE-25000",
  readBackResultFingerprint: "fp-1",
  authorizesOrder: false as const,
  brokerOrderAllowed: false as const,
  placesOrder: false as const,
  shadowOnly: true as const,
  failClosed: true as const,
};

test("confirms durable write plus exact read-back", () => {
  const out = verifyShadowReplayPersistence(base);
  assert.equal(out.decision, "PERSISTENCE_CONFIRMED");
  assert.equal(out.persistenceConfirmed, true);
  assert.equal(out.reusableAfterRestart, true);
  assert.equal(out.placesOrder, false);
});

test("blocks when durable write was not attempted", () => {
  const out = verifyShadowReplayPersistence({ ...base, writeAttempted: false });
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("DURABLE_WRITE_NOT_ATTEMPTED"));
});

test("blocks failed durable write", () => {
  const out = verifyShadowReplayPersistence({ ...base, writeSucceeded: false });
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("DURABLE_WRITE_FAILED"));
});

test("blocks missing read-back", () => {
  const out = verifyShadowReplayPersistence({ ...base, readBackFound: false });
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("DURABLE_READ_BACK_MISSING"));
});

test("blocks replay key mismatch", () => {
  const out = verifyShadowReplayPersistence({ ...base, readBackReplayKey: "SHADOW_EXEC:other:key" });
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("DURABLE_READ_BACK_KEY_MISMATCH"));
});

test("blocks fingerprint mismatch", () => {
  const out = verifyShadowReplayPersistence({ ...base, readBackResultFingerprint: "fp-conflict" });
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("DURABLE_READ_BACK_FINGERPRINT_MISMATCH"));
});

test("reuse requires exact durable read-back but no new write", () => {
  const out = verifyShadowReplayPersistence({
    ...base,
    journalDecision: "REUSE_IDENTICAL",
    writeAttempted: false,
    writeSucceeded: false,
  });
  assert.equal(out.decision, "REUSE_CONFIRMED");
  assert.equal(out.persistenceConfirmed, true);
  assert.equal(out.reusableAfterRestart, true);
});

test("upstream conflict stays blocked", () => {
  const out = verifyShadowReplayPersistence({ ...base, journalDecision: "BLOCK_CONFLICT" });
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("UPSTREAM_REPLAY_JOURNAL_BLOCKED"));
});

test("fails closed on broker order invariant tampering", () => {
  const unsafeKey = "brokerOrder" + "Allowed";
  const out = verifyShadowReplayPersistence({ ...base, [unsafeKey]: Boolean(1) } as any);
  assert.equal(out.decision, "BLOCK");
  assert.ok(out.reasonCodes.includes("BROKER_ORDER_INVARIANT_VIOLATED"));
});
