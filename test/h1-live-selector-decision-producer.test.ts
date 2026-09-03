import test from "node:test";
import assert from "node:assert/strict";
import { produceH1LiveSelectorDecisions } from "../h1-live-selector-decision-producer.js";

const baseCandidate = {
  symbol: "NIFTY",
  side: "CE",
  strike: 24000,
  expiryDate: "2026-09-08",
  dte: 5,
  moneyness: "ATM",
  premiumLtp: 120,
  capitalFit: true,
  liquidityOk: true,
  spreadOk: true,
  premiumResponseConfirmed: true,
  deltaGammaResponseConfirmed: true,
  thetaIvBurdenAcceptable: true,
  multiExpiryConflictAbsent: true,
  currentOrNearExpiryUsable: true,
  higherDteUsable: false,
  fallbackDteApproved: true,
};

test("fails closed without exact live provenance", () => {
  const result = produceH1LiveSelectorDecisions({ provenance: "RESEARCH_SHADOW_ONLY", candidates: [baseCandidate] });
  assert.equal(result.sourceClass, "UNAVAILABLE");
  assert.equal(result.eligibleForLiveH1Marking, false);
  assert.equal(result.decisions.length, 0);
});

test("produces SELECT only through execution selector", () => {
  const result = produceH1LiveSelectorDecisions({ provenance: "LIVE_RUNTIME_EXACT", candidates: [baseCandidate] });
  assert.equal(result.sourceClass, "LIVE_DETERMINISTIC_EXACT");
  assert.equal(result.eligibleForLiveH1Marking, true);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].decision, "SELECT");
  assert.equal(result.decisions[0].selectorVersion, "EXECUTION_CANDIDATE_SELECTOR_V2");
  assert.deepEqual(result.decisions[0].reasonCodes, ["EXECUTION_CANDIDATE_SELECTED"]);
});

test("preserves BLOCK reasons and gates", () => {
  const result = produceH1LiveSelectorDecisions({
    provenance: "LIVE_RUNTIME_EXACT",
    candidates: [{ ...baseCandidate, liquidityOk: false }],
  });
  assert.equal(result.decisions[0].decision, "BLOCK");
  assert.ok(result.decisions[0].reasonCodes.includes("LIQUIDITY_GATE_FAILED"));
  assert.equal(result.decisions[0].gates?.liquidityOk, false);
});

test("rejects incomplete candidate rather than inventing a gate", () => {
  const { premiumResponseConfirmed: _missing, ...incomplete } = baseCandidate;
  const result = produceH1LiveSelectorDecisions({ provenance: "LIVE_RUNTIME_EXACT", candidates: [incomplete] });
  assert.equal(result.decisions.length, 0);
  assert.deepEqual(result.rejected, [{ index: 0, reason: "INVALID_OR_INCOMPLETE_EXECUTION_CANDIDATE_INPUT" }]);
});

test("does not auto-approve fallback DTE", () => {
  const { fallbackDteApproved: _missing, ...withoutFallbackApproval } = baseCandidate;
  const result = produceH1LiveSelectorDecisions({ provenance: "LIVE_RUNTIME_EXACT", candidates: [withoutFallbackApproval] });
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].decision, "BLOCK");
  assert.ok(result.decisions[0].reasonCodes.includes("FALLBACK_DTE_NOT_APPROVED"));
});
