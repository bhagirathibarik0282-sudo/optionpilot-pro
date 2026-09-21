import test from "node:test";
import assert from "node:assert/strict";
import {
  H1_SELECTOR_INDEPENDENT_PROSPECTIVE_POLICY_V1 as policy,
  validateH1SelectorIndependentProspectivePolicyV1,
} from "../h1-selector-independent-prospective-policy-v1.js";

test("freezes the independent protocol before the untouched evidence window", () => {
  const result = validateH1SelectorIndependentProspectivePolicyV1();
  assert.equal(result.readyForUntouchedEvidenceCollection, true);
  assert.deepEqual(result.blockers, []);
  assert.ok(Date.parse(policy.frozenAt) < Date.parse(policy.untouchedEvidenceStartsAt));
  assert.equal(policy.direction.rubricVersion, "H1_DIRECTION_SELECTION_RUBRIC_V1");
  assert.equal(policy.direction.candidateLabel, "P75");
  assert.equal(policy.direction.minimumUntouchedTradingDates, 10);
});

test("requires full Delta Gamma and IV reference validation in addition to timing", () => {
  assert.equal(policy.greeks.minimumUntouchedContractObservations, 1_000);
  assert.equal(policy.greeks.maximumObservationAgeMs, 5_000);
  assert.equal(policy.greeks.maximumUnderlyingSkewMs, 2_000);
  assert.ok(policy.greeks.maximumAbsoluteDeltaError > 0);
  assert.ok(policy.greeks.maximumAbsoluteGammaError > 0);
  assert.ok(policy.greeks.maximumAbsoluteIvError > 0);
  assert.equal(policy.evidenceRules.greekReference, "INDEPENDENT_REFERENCE_IMPLEMENTATION_REQUIRED");
  assert.equal(policy.evidenceRules.timingEvidenceAloneInsufficient, true);
});

test("keeps all production and downstream authority disabled", () => {
  const result = validateH1SelectorIndependentProspectivePolicyV1();
  assert.equal(result.productionPromotionEligible, false);
  assert.equal(result.affectsSelector, false);
  assert.equal(result.affectsBusinessCard, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.createsOrders, false);
  assert.equal(policy.interpretation.passingCreatesProductionAuthority, false);
  assert.equal(policy.interpretation.passingCreatesCandidate, false);
  assert.equal(policy.interpretation.passingPublishesEntryStopTarget, false);
});

test("does not misrepresent direction agreement as business win rate", () => {
  assert.equal(policy.interpretation.directionAgreementIsTradeWinRate, false);
  assert.equal(policy.evidenceRules.markerCountAloneForbidden, true);
  assert.equal(policy.evidenceRules.completeReplayContinuityRequired, true);
  assert.equal(policy.evidenceRules.chronologicalNoLeakageRequired, true);
});
