import test from "node:test";
import assert from "node:assert/strict";
import { bindH1ForwardCandidateDecisions } from "../h1-forward-candidate-decision-binding.js";

test("explicit SELECT creates exact candidate key while BLOCK does not", () => {
  const result = bindH1ForwardCandidateDecisions([
    { symbol: "nifty", expiry: "2026-09-10", strike: 24000, side: "ce", decision: "SELECT", reasonCodes: ["EXECUTION_CANDIDATE_SELECTED"], selectorVersion: "V2" },
    { symbol: "NIFTY", expiry: "2026-09-10", strike: 23950, side: "PE", decision: "BLOCK", reasonCodes: ["SPREAD_GATE_FAILED"] },
  ]);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.candidateKeys.has("NIFTY|2026-09-10|24000|CE"), true);
  assert.equal(result.candidateKeys.has("NIFTY|2026-09-10|23950|PE"), false);
});

test("absent input is backward-compatible no-evidence, not a fabricated BLOCK", () => {
  const result = bindH1ForwardCandidateDecisions(undefined);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.candidateKeys.size, 0);
});

test("invalid selector evidence fails closed and creates no candidate", () => {
  const result = bindH1ForwardCandidateDecisions([
    { symbol: "NIFTY", expiry: "bad-date", strike: 24000, side: "CE", decision: "SELECT", reasonCodes: [] },
    { symbol: "NIFTY", expiry: "2026-09-10", strike: -1, side: "PE", decision: "SELECT", reasonCodes: [] },
  ]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 2);
  assert.equal(result.candidateKeys.size, 0);
});

test("candidate keys retain symbol identity for downstream symbol scoping", () => {
  const result = bindH1ForwardCandidateDecisions([
    { symbol: "NIFTY", expiry: "2026-09-10", strike: 24000, side: "CE", decision: "SELECT", reasonCodes: [] },
    { symbol: "SENSEX", expiry: "2026-09-10", strike: 80000, side: "PE", decision: "SELECT", reasonCodes: [] },
  ]);
  assert.deepEqual([...result.candidateKeys].sort(), [
    "NIFTY|2026-09-10|24000|CE",
    "SENSEX|2026-09-10|80000|PE",
  ]);
});

test("non-array provided evidence is rejected rather than inferred", () => {
  const result = bindH1ForwardCandidateDecisions({ decision: "SELECT" });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.candidateKeys.size, 0);
  assert.equal(result.rejected[0]?.reason, "CANDIDATE_DECISIONS_NOT_ARRAY");
});
