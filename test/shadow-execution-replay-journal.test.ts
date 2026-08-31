import test from "node:test";
import assert from "node:assert/strict";
import { evaluateShadowExecutionReplayJournal } from "../shadow-execution-replay-journal.js";

const previousBase = {
  executionId: "exec-1",
  snapshotVersion: "EXECUTION_CONSISTENCY_SNAPSHOT_V1" as const,
  harnessVersion: "SHADOW_EXECUTION_E2E_HARNESS_V1" as const,
  contractKey: "NIFTY:CE:25000:2026-09-03",
  actionState: "READY",
  finalTarget: "SHADOW_SUBMISSION_STATE",
  resultFingerprint: "fp-123",
};

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

test("reuses an identical replay only when all semantics match", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, previous: previousBase });
  assert.equal(out.decision, "REUSE_IDENTICAL");
  assert.equal(out.reuseExistingRecord, true);
});

test("blocks conflicting replay result", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, previous: { ...previousBase, resultFingerprint: "different" } });
  assert.equal(out.decision, "BLOCK_CONFLICT");
  assert.ok(out.reasonCodes.includes("REPLAY_RESULT_CONFLICT"));
});

test("blocks replay identity conflict", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, previous: { ...previousBase, executionId: "exec-other" } });
  assert.equal(out.decision, "BLOCK_CONFLICT");
  assert.ok(out.reasonCodes.includes("REPLAY_IDENTITY_CONFLICT"));
});

test("blocks same fingerprint when final target changed", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, previous: { ...previousBase, finalTarget: "MANAGEMENT_ENGINE" } });
  assert.equal(out.decision, "BLOCK_CONFLICT");
  assert.ok(out.reasonCodes.includes("REPLAY_SEMANTIC_CONFLICT"));
});

test("blocks same fingerprint when action state changed", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, previous: { ...previousBase, actionState: "RECONCILE" } });
  assert.equal(out.decision, "BLOCK_CONFLICT");
  assert.ok(out.reasonCodes.includes("REPLAY_SEMANTIC_CONFLICT"));
});

test("fails closed on invalid previous snapshot version", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, previous: { ...previousBase, snapshotVersion: "OTHER" } as any });
  assert.equal(out.decision, "BLOCK_INVALID");
  assert.ok(out.reasonCodes.includes("INVALID_PREVIOUS_REPLAY_RECORD"));
});

test("fails closed on invalid previous harness version", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, previous: { ...previousBase, harnessVersion: "OTHER" } as any });
  assert.equal(out.decision, "BLOCK_INVALID");
  assert.ok(out.reasonCodes.includes("INVALID_PREVIOUS_REPLAY_RECORD"));
});

test("fails closed on invalid fingerprint", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, resultFingerprint: "" });
  assert.equal(out.decision, "BLOCK_INVALID");
  assert.equal(out.failClosed, true);
  assert.equal(out.authorizesOrder, false);
  assert.equal(out.brokerOrderAllowed, false);
});

test("rejects colon in execution id so stable key identity boundary cannot collide", () => {
  const out = evaluateShadowExecutionReplayJournal({ ...base, executionId: "exec:1" });
  assert.equal(out.decision, "BLOCK_INVALID");
  assert.equal(out.stableReplayKey, null);
  assert.ok(out.reasonCodes.includes("INVALID_EXECUTION_ID"));
  assert.equal(out.placesOrder, false);
});

test("rejects colon-bearing previous execution id before replay reuse", () => {
  const out = evaluateShadowExecutionReplayJournal({
    ...base,
    previous: { ...previousBase, executionId: "exec:1" },
  });
  assert.equal(out.decision, "BLOCK_INVALID");
  assert.ok(out.reasonCodes.includes("INVALID_PREVIOUS_REPLAY_RECORD"));
  assert.equal(out.reuseExistingRecord, false);
});
