import test from "node:test";
import assert from "node:assert/strict";
import {
  buildH1SelectorCanonicalValidationHandoffFromEvidenceV1,
  H1_SELECTOR_THREE_POLICY_VALIDATION_ENV,
} from "../h1-selector-canonical-validation-handoff-v1.js";

const greekPolicy = {
  annualRiskFreeRate: 0.05,
  annualDividendYield: 0,
  maxAgeMs: 5_000,
  maxUnderlyingSkewMs: 2_000,
};

const premiumPolicy = {
  maxObservationGapMs: 10_000,
  minPremiumMovePct: 0.1,
  minAbsoluteDeltaChange: 0.01,
  minCurrentGamma: 0.0001,
};

const burdenPolicy = {
  maxObservationAgeMs: 30_000,
  maxAbsThetaPctOfPremium: 10,
  minIv: 1,
  maxIv: 100,
  requiredPeerCount: 1,
  maxConflictingPeerCount: 0,
};

const capitalLiquidityDtePolicy = {
  maxCapitalPerTrade: 100_000,
  maxRelativeSpreadPct: 1.5,
  minBidDepthCoverageMultiple: 2,
  minAskDepthCoverageMultiple: 2,
  allowFallbackDte5To7: false,
};

function prospective(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    version: "H1_SELECTOR_PROSPECTIVE_EVIDENCE_READBACK_V1",
    mode: "READ_ONLY",
    productionImpact: "NONE",
    evidenceWindowStartsAt: "2026-09-22T03:45:00.000Z",
    evidenceWindowEndsAt: "2026-10-06T10:00:00.000Z",
    direction: {
      recordedDates: Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`),
      completeTradingDates: Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`),
      incompleteTradingDates: [],
      p75ThresholdPct: 0.04454867692571917,
      evidence: {},
      blockers: [],
    },
    greeks: {
      timingRowCount: 1_000,
      policyIdentifiedCrosscheckCount: 1_000,
      legacyOrUnidentifiedCrosscheckCount: 0,
      uniqueGreekPolicyCount: 1,
      policySnapshot: greekPolicy,
      worstGammaObservation: null,
      evidence: {},
      blockers: [],
    },
    evaluation: {
      version: "H1_SELECTOR_PROSPECTIVE_VALIDATION_EVALUATION_V1",
      readyForOwnerPromotionReview: true,
      protocolId: "H1_SELECTOR_INDEPENDENT_PROSPECTIVE_POLICY_V1",
      directionPass: true,
      greekPass: true,
      blockers: [],
      productionPromotionEligible: false,
      affectsSelector: false,
      affectsBusinessCard: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      failClosed: true,
    },
    blockers: [],
    safety: {
      readOnly: true,
      productionPromotionEligible: false,
      affectsSelector: false,
      affectsBusinessCard: false,
      affectsTelegram: false,
      affectsExecution: false,
      createsOrders: false,
      failClosed: true,
    },
    ...overrides,
  } as any;
}

function threePolicyInput() {
  const observedAt = "2026-10-06T10:00:00.000Z";
  return {
    validationId: "H1_THREE_POLICY_VALIDATION_2026_10_06",
    ownerApprovalRef: "OWNER_APPROVED_EXACT_POLICY_REVIEW_2026_10_06",
    validatedAt: observedAt,
    source: "EXPLICIT_VALIDATED_POLICY_ONLY",
    policies: {
      premiumPolicy,
      burdenPolicy,
      capitalLiquidityDtePolicy,
    },
    premiumDeltaGamma: {
      evidenceRef: "premium-evidence-2026-10-06",
      evaluatorVersion: "PREMIUM_VALIDATOR_V1",
      observedAt,
      provenance: "UNTOUCHED_OOS_VALIDATION",
      decision: "PASS",
      policySnapshot: premiumPolicy,
    },
    thetaIvMultiExpiry: {
      evidenceRef: "burden-evidence-2026-10-06",
      evaluatorVersion: "BURDEN_VALIDATOR_V1",
      observedAt,
      provenance: "UNTOUCHED_OOS_VALIDATION",
      decision: "PASS",
      policySnapshot: burdenPolicy,
    },
    capitalLiquidityDte: {
      evidenceRef: "capital-evidence-2026-10-06",
      evaluatorVersion: "CAPITAL_VALIDATOR_V1",
      observedAt,
      provenance: "UNTOUCHED_OOS_VALIDATION",
      decision: "PASS",
      policySnapshot: capitalLiquidityDtePolicy,
    },
  };
}

test("keeps canonical handoff fail-closed when explicit three-policy validation is absent", () => {
  const out = buildH1SelectorCanonicalValidationHandoffFromEvidenceV1(prospective(), {});
  assert.equal(out.readyForCanonicalPolicySource, false);
  assert.ok(out.blockers.includes("KITE_H1_THREE_POLICY_VALIDATION_JSON_REQUIRED"));
  assert.equal(out.proof.threePolicyValidation, null);
  assert.equal(out.proof.directionThresholdPct, 0.04454867692571917);
  assert.deepEqual(out.proof.greekPolicySnapshot, greekPolicy);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsBusinessCard, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.failClosed, true);
});

test("passes only explicit evidence-linked three-policy validation through the existing validator", () => {
  const out = buildH1SelectorCanonicalValidationHandoffFromEvidenceV1(prospective(), {
    [H1_SELECTOR_THREE_POLICY_VALIDATION_ENV]: JSON.stringify(threePolicyInput()),
  });
  assert.equal(out.readyForCanonicalPolicySource, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.source, "EXPLICIT_VALIDATED_EVIDENCE_HANDOFF");
  assert.equal(out.proof.prospectiveEvaluation?.directionPass, true);
  assert.equal(out.proof.prospectiveEvaluation?.greekPass, true);
  assert.equal(out.proof.threePolicyValidation?.readyForCanonicalPolicySource, true);
  assert.equal(out.proof.threePolicyValidation?.source, "EXPLICIT_VALIDATED_POLICY_ONLY");
});

test("malformed three-policy validation JSON cannot create authority", () => {
  const out = buildH1SelectorCanonicalValidationHandoffFromEvidenceV1(prospective(), {
    [H1_SELECTOR_THREE_POLICY_VALIDATION_ENV]: "{not-json",
  });
  assert.equal(out.readyForCanonicalPolicySource, false);
  assert.ok(out.blockers.includes("KITE_H1_THREE_POLICY_VALIDATION_JSON_INVALID"));
  assert.equal(out.proof.threePolicyValidation, null);
  assert.equal(out.source, "NONE");
});
