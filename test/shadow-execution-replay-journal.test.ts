import test from "node:test";
import assert from "node:assert/strict";
import { evaluateShadowExecutionReplayJournal } from "../shadow-execution-replay-journal.js";

const base = {
  executionId: "exec-1",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  contractKey: "NIFTY:CE:25000:2026-09-03",
  actionState: "READY",
  finalTarget: "SHADOW_SUBMISSION_STATE",
  resultFingerprint: "fp-123",
  previous: null,
};

test("records a new replay safely", () => {
  const out = evaluateShadowExecutionReplayJournal(base);
  assert.equal(out.decision, "RECORD_NEW");
  assert.equal(out.durableRecordRequired, true);
  assert.equal(out.placesOrder, false);
});

test("reuses an identical replay", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, previous: { executionId: "exec-1", contractKey: base.contractKey, resultFingerprint: "fp-123" } });
  assert.equal(out.decision, "REUSE_IDENTICAL");
  assert.equal(out.reuseExistingRecord, true);
});

test("blocks conflicting replay result", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, previous: { executionId: "exec-1", contractKey: base.contractKey, resultFingerprint: "different" } });
  assert.equal(out.decision, "BLOCK_CONFLICT");
  assert.ok(out.reasonCodes.includes("REPLAY_RESULT_CONFLICT"));
});

test("blocks replay identity conflict", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, previous: { executionId: "exec-other", contractKey: base.contractKey, resultFingerprint: "fp-123" } });
  assert.equal(out.decision, "BLOCK_CONFLICT");
  assert.ok(out.reasonCodes.includes("REPLAY_IDENTITY_CONFLICT"));
});

test("fails closed on invalid fingerprint", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, resultFingerprint: "" });
  assert.equal(out.decision, "BLOCK_INVALID");
  assert.equal(out.failClosed, true);
  assert.equal(out.authorizesOrder, false);
  assert.equal(out.brokerOrderAllowed, false);
});
