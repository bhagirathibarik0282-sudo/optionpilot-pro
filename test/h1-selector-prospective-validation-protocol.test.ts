import test from "node:test";
import assert from "node:assert/strict";
import {
  validateH1SelectorProspectiveValidationProtocol,
  type H1SelectorProspectiveValidationProtocolInput,
} from "../h1-selector-prospective-validation-protocol.js";

function completeProtocol(): H1SelectorProspectiveValidationProtocolInput {
  return {
    protocolId: "OWNER_APPROVED_PROTOCOL_EXAMPLE",
    ownerApprovalRef: "approval-reference",
    frozenAt: "2026-09-21T07:00:00.000Z",
    untouchedEvidenceStartsAt: "2026-09-22T03:45:00.000Z",
    direction: {
      rubricVersion: "H1_DIRECTION_SELECTION_RUBRIC_V1",
      candidateLabel: "P75",
      minimumUntouchedTradingDates: 1,
      minimumOosRetentionRate: 0.5,
      minimumOosStrictMajorityIntervalRate: 0.5,
      minimumOosMeanSideBalancedAgreementShare: 0.5,
      maximumCalibrationToOosStrictMajorityDrop: 0.25,
    },
    greeks: {
      minimumUntouchedContractObservations: 1,
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

test("accepts a structurally complete protocol frozen before untouched evidence without granting authority", () => {
  const out = validateH1SelectorProspectiveValidationProtocol(completeProtocol());
  assert.equal(out.readyForUntouchedEvidenceCollection, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.productionPromotionEligible, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsBusinessCard, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("rejects a protocol frozen at or after the evidence window", () => {
  const protocol = completeProtocol();
  protocol.frozenAt = protocol.untouchedEvidenceStartsAt;
  const out = validateH1SelectorProspectiveValidationProtocol(protocol);
  assert.equal(out.readyForUntouchedEvidenceCollection, false);
  assert.ok(out.blockers.includes("PROTOCOL_MUST_PRECEDE_UNTOUCHED_EVIDENCE"));
  assert.equal(out.protocol, null);
});

test("Greek timing evidence alone cannot create a complete model-validation protocol", () => {
  const protocol = completeProtocol();
  protocol.greeks.maximumAbsoluteDeltaError = Number.NaN;
  protocol.greeks.maximumAbsoluteGammaError = Number.NaN;
  protocol.greeks.maximumAbsoluteIvError = Number.NaN;
  const out = validateH1SelectorProspectiveValidationProtocol(protocol);
  assert.equal(out.readyForUntouchedEvidenceCollection, false);
  assert.ok(out.blockers.includes("DELTA_MODEL_ERROR_CRITERION_REQUIRED"));
  assert.ok(out.blockers.includes("GAMMA_MODEL_ERROR_CRITERION_REQUIRED"));
  assert.ok(out.blockers.includes("IV_MODEL_ERROR_CRITERION_REQUIRED"));
});

test("missing owner approval and incomplete direction criteria fail closed", () => {
  const protocol = completeProtocol();
  protocol.ownerApprovalRef = "";
  protocol.direction.minimumOosRetentionRate = Number.NaN;
  const out = validateH1SelectorProspectiveValidationProtocol(protocol);
  assert.equal(out.readyForUntouchedEvidenceCollection, false);
  assert.ok(out.blockers.includes("OWNER_APPROVAL_REFERENCE_REQUIRED"));
  assert.ok(out.blockers.includes("DIRECTION_OOS_RETENTION_CRITERION_REQUIRED"));
  assert.equal(out.productionPromotionEligible, false);
});
