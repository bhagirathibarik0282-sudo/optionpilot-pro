import test from "node:test";
import assert from "node:assert/strict";
import { validateH1ThreePolicyValidationProtocol } from "../h1-three-policy-validation-protocol-v1.js";

function protocol() {
  return {
    protocolId: "THREE_POLICY_PROTOCOL_TEST",
    ownerApprovalRef: "OWNER_APPROVAL_TEST",
    frozenAt: "2026-09-21T15:00:00.000Z",
    untouchedEvidenceStartsAt: "2026-09-22T03:45:00.000Z",
    premiumDeltaGamma: {
      minimumUntouchedTradingDates: 2,
      minimumEvidenceObservations: 100,
      minimumPassRate: 0.8,
    },
    thetaIvMultiExpiry: {
      minimumUntouchedTradingDates: 2,
      minimumEvidenceObservations: 100,
      minimumPassRate: 0.8,
    },
    capitalLiquidityDte: {
      minimumUntouchedTradingDates: 2,
      minimumEvidenceObservations: 100,
      minimumPassRate: 0.8,
    },
  };
}

test("accepts only an explicit pre-registered protocol and grants no authority", () => {
  const out = validateH1ThreePolicyValidationProtocol(protocol());
  assert.equal(out.readyForUntouchedEvidenceCollection, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.acceptanceThresholdsFrozen, true);
  assert.equal(out.productionPromotionEligible, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsBusinessCard, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("requires the protocol to be frozen before untouched evidence starts", () => {
  const input = protocol();
  input.frozenAt = input.untouchedEvidenceStartsAt;
  const out = validateH1ThreePolicyValidationProtocol(input);
  assert.equal(out.readyForUntouchedEvidenceCollection, false);
  assert.ok(out.blockers.includes("THREE_POLICY_PROTOCOL_MUST_PRECEDE_UNTOUCHED_EVIDENCE"));
});

test("fails closed when any sample criterion is missing or invalid", () => {
  const input = protocol();
  input.premiumDeltaGamma.minimumUntouchedTradingDates = 0;
  input.thetaIvMultiExpiry.minimumEvidenceObservations = 0;
  input.capitalLiquidityDte.minimumPassRate = 1.2;
  const out = validateH1ThreePolicyValidationProtocol(input);
  assert.equal(out.readyForUntouchedEvidenceCollection, false);
  assert.ok(out.blockers.includes("PREMIUM_DELTA_GAMMA_MINIMUM_TRADING_DATES_REQUIRED"));
  assert.ok(out.blockers.includes("THETA_IV_MULTI_EXPIRY_MINIMUM_EVIDENCE_OBSERVATIONS_REQUIRED"));
  assert.ok(out.blockers.includes("CAPITAL_LIQUIDITY_DTE_MINIMUM_PASS_RATE_REQUIRED"));
});

test("requires explicit owner approval reference", () => {
  const input = protocol();
  input.ownerApprovalRef = "";
  const out = validateH1ThreePolicyValidationProtocol(input);
  assert.equal(out.readyForUntouchedEvidenceCollection, false);
  assert.ok(out.blockers.includes("THREE_POLICY_OWNER_APPROVAL_REFERENCE_REQUIRED"));
});
