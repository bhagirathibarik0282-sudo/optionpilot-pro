import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateH1SelectorProspectiveValidation,
  type H1SelectorProspectiveValidationEvidence,
} from "../h1-selector-prospective-validation-evaluator.js";
import type { H1SelectorProspectiveValidationProtocolInput } from "../h1-selector-prospective-validation-protocol.js";

function protocol(): H1SelectorProspectiveValidationProtocolInput {
  return {
    protocolId: "OWNER_APPROVED_PROTOCOL_TEST",
    ownerApprovalRef: "test-owner-approval",
    frozenAt: "2026-09-21T07:00:00.000Z",
    untouchedEvidenceStartsAt: "2026-09-22T03:45:00.000Z",
    direction: {
      rubricVersion: "H1_DIRECTION_SELECTION_RUBRIC_V1",
      candidateLabel: "P75",
      minimumUntouchedTradingDates: 2,
      minimumOosRetentionRate: 0.6,
      minimumOosStrictMajorityIntervalRate: 0.6,
      minimumOosMeanSideBalancedAgreementShare: 0.6,
      maximumCalibrationToOosStrictMajorityDrop: 0.2,
    },
    greeks: {
      minimumUntouchedContractObservations: 100,
      maximumObservationAgeMs: 5_000,
      maximumUnderlyingSkewMs: 2_000,
      minimumTimingPassRate: 0.95,
      minimumUnderlyingSkewPassRate: 0.95,
      maximumAbsoluteDeltaError: 0.05,
      maximumAbsoluteGammaError: 0.001,
      maximumAbsoluteIvError: 2,
      minimumDeltaModelPassRate: 0.95,
      minimumGammaModelPassRate: 0.95,
      minimumIvModelPassRate: 0.95,
    },
  };
}

function evidence(): H1SelectorProspectiveValidationEvidence {
  return {
    evidenceWindowStartsAt: "2026-09-22T03:45:00.000Z",
    evidenceWindowEndsAt: "2026-09-23T10:00:00.000Z",
    direction: {
      candidateLabel: "P75",
      untouchedTradingDates: 2,
      oosRetentionRate: 0.7,
      oosStrictMajorityIntervalRate: 0.7,
      oosMeanSideBalancedAgreementShare: 0.7,
      calibrationToOosStrictMajorityDrop: 0.1,
    },
    greeks: {
      untouchedContractObservations: 100,
      timingPassRate: 0.98,
      underlyingSkewPassRate: 0.98,
      maximumAbsoluteDeltaErrorObserved: 0.04,
      maximumAbsoluteGammaErrorObserved: 0.0008,
      maximumAbsoluteIvErrorObserved: 1.5,
      deltaModelPassRate: 0.97,
      gammaModelPassRate: 0.97,
      ivModelPassRate: 0.97,
    },
  };
}

test("passes untouched evidence only for owner promotion review and grants no production authority", () => {
  const out = evaluateH1SelectorProspectiveValidation(protocol(), evidence());
  assert.equal(out.readyForOwnerPromotionReview, true);
  assert.equal(out.directionPass, true);
  assert.equal(out.greekPass, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.productionPromotionEligible, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsBusinessCard, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("rejects evidence that begins before the pre-registered untouched window", () => {
  const e = evidence();
  e.evidenceWindowStartsAt = "2026-09-21T09:15:00.000Z";
  const out = evaluateH1SelectorProspectiveValidation(protocol(), e);
  assert.equal(out.readyForOwnerPromotionReview, false);
  assert.ok(out.blockers.includes("PRE_REGISTRATION_EVIDENCE_FORBIDDEN"));
});

test("fails closed when direction or Greek criteria are not met", () => {
  const e = evidence();
  e.direction.oosRetentionRate = 0.5;
  e.greeks.deltaModelPassRate = 0.9;
  const out = evaluateH1SelectorProspectiveValidation(protocol(), e);
  assert.equal(out.readyForOwnerPromotionReview, false);
  assert.equal(out.directionPass, false);
  assert.equal(out.greekPass, false);
  assert.ok(out.blockers.includes("DIRECTION_OOS_RETENTION_BELOW_CRITERION"));
  assert.ok(out.blockers.includes("DELTA_MODEL_PASS_RATE_BELOW_CRITERION"));
});

test("rejects an invalid protocol before evaluating evidence", () => {
  const p = protocol();
  p.ownerApprovalRef = "";
  const out = evaluateH1SelectorProspectiveValidation(p, evidence());
  assert.equal(out.readyForOwnerPromotionReview, false);
  assert.equal(out.protocolId, null);
  assert.ok(out.blockers.includes("VALID_PRE_REGISTERED_PROTOCOL_REQUIRED"));
  assert.ok(out.blockers.includes("OWNER_APPROVAL_REFERENCE_REQUIRED"));
  assert.equal(out.productionPromotionEligible, false);
});
