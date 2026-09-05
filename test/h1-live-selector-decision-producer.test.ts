import test from "node:test";
import assert from "node:assert/strict";
import { produceH1LiveSelectorDecisions } from "../h1-live-selector-decision-producer.js";
import { buildCanonicalBuyerCandidatePacketFromSelection } from "../canonical-buyer-candidate-packet.js";

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
  assert.equal(result.evaluations.length, 0);
});

test("produces SELECT only through execution selector and exposes the same evaluation", () => {
  const result = produceH1LiveSelectorDecisions({ provenance: "LIVE_RUNTIME_EXACT", candidates: [baseCandidate] });
  assert.equal(result.sourceClass, "LIVE_DETERMINISTIC_EXACT");
  assert.equal(result.eligibleForLiveH1Marking, true);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.evaluations.length, 1);
  assert.equal(result.decisions[0].decision, "SELECT");
  assert.equal(result.decisions[0].selectorVersion, "EXECUTION_CANDIDATE_SELECTOR_V2");
  assert.deepEqual(result.decisions[0].reasonCodes, ["EXECUTION_CANDIDATE_SELECTED"]);
  assert.equal(result.evaluations[0].selector.decision, "SELECT");
  assert.equal(result.evaluations[0].candidate.side, "CE");
});

test("canonical packet consumes authoritative live selector result without re-selection", () => {
  const result = produceH1LiveSelectorDecisions({ provenance: "LIVE_RUNTIME_EXACT", candidates: [baseCandidate] });
  const evaluation = result.evaluations[0];
  assert.ok(evaluation);
  const canonical = buildCanonicalBuyerCandidatePacketFromSelection(evaluation.candidate, evaluation.selector);
  assert.equal(canonical.decision, "READY");
  assert.equal(canonical.packet?.candidateKey, evaluation.selector.candidateKey);
  assert.equal(canonical.packet?.sourceAuthority, "EXECUTION_CANDIDATE_SELECTOR_V2");
  assert.equal(canonical.packet?.role, "OPTION_BUYER");
});

test("pre-evaluated canonical handoff fails closed on selector identity mismatch", () => {
  const result = produceH1LiveSelectorDecisions({ provenance: "LIVE_RUNTIME_EXACT", candidates: [baseCandidate] });
  const evaluation = result.evaluations[0];
  assert.ok(evaluation);
  const tampered = { ...evaluation.selector, candidateKey: `${evaluation.selector.candidateKey}:TAMPERED` };
  const canonical = buildCanonicalBuyerCandidatePacketFromSelection(evaluation.candidate, tampered);
  assert.equal(canonical.decision, "BLOCK");
  assert.equal(canonical.packet, null);
  assert.ok(canonical.reasonCodes.includes("CANONICAL_SELECTOR_IDENTITY_MISMATCH"));
});

test("preserves BLOCK reasons and gates", () => {
  const result = produceH1LiveSelectorDecisions({
    provenance: "LIVE_RUNTIME_EXACT",
    candidates: [{ ...baseCandidate, liquidityOk: false }],
  });
  assert.equal(result.decisions[0].decision, "BLOCK");
  assert.equal(result.evaluations[0].selector.decision, "BLOCK");
  assert.ok(result.decisions[0].reasonCodes.includes("LIQUIDITY_GATE_FAILED"));
  assert.equal(result.decisions[0].gates?.liquidityOk, false);
});

test("rejects incomplete candidate rather than inventing a gate", () => {
  const { premiumResponseConfirmed: _missing, ...incomplete } = baseCandidate;
  const result = produceH1LiveSelectorDecisions({ provenance: "LIVE_RUNTIME_EXACT", candidates: [incomplete] });
  assert.equal(result.decisions.length, 0);
  assert.equal(result.evaluations.length, 0);
  assert.deepEqual(result.rejected, [{ index: 0, reason: "INVALID_OR_INCOMPLETE_EXECUTION_CANDIDATE_INPUT" }]);
});

test("does not auto-approve fallback DTE", () => {
  const { fallbackDteApproved: _missing, ...withoutFallbackApproval } = baseCandidate;
  const result = produceH1LiveSelectorDecisions({ provenance: "LIVE_RUNTIME_EXACT", candidates: [withoutFallbackApproval] });
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].decision, "BLOCK");
  assert.equal(result.evaluations[0].selector.decision, "BLOCK");
  assert.ok(result.decisions[0].reasonCodes.includes("FALLBACK_DTE_NOT_APPROVED"));
});
