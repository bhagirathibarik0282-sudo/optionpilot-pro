import test from "node:test";
import assert from "node:assert/strict";
import { validateReplayBatch, validateReplayObservation } from "../h1-replay-guard.js";

const base = {
  logicalKey: "NIFTY|2026-08-28T09:30:00.000Z",
  observedAt: "2026-08-28T09:30:00.000Z",
  decisionAt: "2026-08-28T09:31:00.000Z",
  blockEnd: "2026-08-28T09:30:00.000Z",
  blockClosed: true,
  quality: "TRUE" as const,
  expiry: "2026-09-03",
  tradingDate: "2026-08-28",
  dte: 6,
  sessionEligible: true,
};

test("closed TRUE observation at or before decision time is replay eligible", () => {
  assert.equal(validateReplayObservation(base).eligible, true);
});

test("future observation and running block are blocked", () => {
  const result = validateReplayObservation({ ...base, observedAt: "2026-08-28T09:32:00.000Z", blockClosed: false });
  assert.equal(result.eligible, false);
  assert.ok(result.errors.includes("LOOKAHEAD_FUTURE_OBSERVATION"));
  assert.ok(result.errors.includes("UNCONFIRMED_RUNNING_BLOCK"));
});

test("PARTIAL cannot become research replay evidence", () => {
  const result = validateReplayObservation({ ...base, quality: "PARTIAL" });
  assert.equal(result.eligible, false);
  assert.ok(result.errors.includes("NON_RESEARCH_QUALITY_PARTIAL"));
});

test("DTE/date mismatch is blocked", () => {
  const result = validateReplayObservation({ ...base, dte: 5 });
  assert.equal(result.eligible, false);
  assert.ok(result.errors.includes("DTE_DATE_MISMATCH"));
});

test("duplicate logical keys fail the batch", () => {
  const result = validateReplayBatch([base, { ...base }]);
  assert.equal(result.eligible, false);
  assert.ok(result.errors.some((x) => x.endsWith("DUPLICATE_LOGICAL_KEY")));
});
