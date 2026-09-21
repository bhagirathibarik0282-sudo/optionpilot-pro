import test from "node:test";
import assert from "node:assert/strict";
import { validateH1SelectorThreePolicyBundle } from "../h1-selector-three-policy-validation-v1.js";

const policies = {
  premiumPolicy: {
    maxObservationGapMs: 180_000,
    minPremiumMovePct: 2,
    minAbsoluteDeltaChange: 0.03,
    minCurrentGamma: 0.001,
  },
  burdenPolicy: {
    maxObservationAgeMs: 60_000,
    maxAbsThetaPctOfPremium: 3,
    minIv: 8,
    maxIv: 30,
    requiredPeerCount: 2,
    maxConflictingPeerCount: 0,
  },
  capitalLiquidityDtePolicy: {
    maxCapitalPerTrade: 50_000,
    maxRelativeSpreadPct: 1.5,
    minBidDepthCoverageMultiple: 2,
    minAskDepthCoverageMultiple: 2,
    allowFallbackDte5To7: false,
  },
};

function bundle() {
  return {
    validationId: "THREE_POLICY_VALIDATION_TEST",
    ownerApprovalRef: "OWNER_APPROVAL_TEST",
    validatedAt: "2026-09-21T14:00:00.000Z",
    source: "EXPLICIT_VALIDATED_POLICY_ONLY" as const,
    policies,
    premiumDeltaGamma: {
      evidenceRef: "live-premium-delta-gamma:test",
      evaluatorVersion: "H1_LIVE_PREMIUM_DELTA_GAMMA_EVALUATOR_V1",
      observedAt: "2026-09-21T13:50:00.000Z",
      provenance: "LIVE_RUNTIME_EXACT" as const,
      decision: "PASS" as const,
      policySnapshot: policies.premiumPolicy,
    },
    thetaIvMultiExpiry: {
      evidenceRef: "live-theta-iv-multi-expiry:test",
      evaluatorVersion: "H1_LIVE_THETA_IV_MULTI_EXPIRY_EVALUATOR_V1",
      observedAt: "2026-09-21T13:51:00.000Z",
      provenance: "LIVE_RUNTIME_EXACT" as const,
      decision: "PASS" as const,
      policySnapshot: policies.burdenPolicy,
    },
    capitalLiquidityDte: {
      evidenceRef: "live-capital-liquidity-dte:test",
      evaluatorVersion: "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1",
      observedAt: "2026-09-21T13:52:00.000Z",
      provenance: "LIVE_RUNTIME_EXACT" as const,
      decision: "PASS" as const,
      policySnapshot: policies.capitalLiquidityDtePolicy,
    },
  };
}

test("accepts only an explicit evidence-linked PASS bundle for the exact three policies", () => {
  const out = validateH1SelectorThreePolicyBundle(bundle());
  assert.equal(out.readyForCanonicalPolicySource, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.source, "EXPLICIT_VALIDATED_POLICY_ONLY");
  assert.deepEqual(out.validatedPolicies, policies);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsBusinessCard, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
});

test("fails closed when any evidence decision is not PASS", () => {
  const input = bundle();
  input.thetaIvMultiExpiry.decision = "FAIL";
  const out = validateH1SelectorThreePolicyBundle(input);
  assert.equal(out.readyForCanonicalPolicySource, false);
  assert.equal(out.validatedPolicies, null);
  assert.ok(out.blockers.includes("THETA_IV_MULTI_EXPIRY_VALIDATION_NOT_PASSED"));
});

test("rejects policy drift between evidence and requested production policy", () => {
  const input = bundle();
  input.premiumDeltaGamma.policySnapshot = {
    ...policies.premiumPolicy,
    minPremiumMovePct: 1,
  };
  const out = validateH1SelectorThreePolicyBundle(input);
  assert.equal(out.readyForCanonicalPolicySource, false);
  assert.ok(out.blockers.includes("PREMIUM_DELTA_GAMMA_POLICY_SNAPSHOT_MISMATCH"));
});

test("rejects shadow calibration as production validation provenance", () => {
  const input = bundle() as any;
  input.capitalLiquidityDte.provenance = "SHADOW_CALIBRATION_ONLY";
  const out = validateH1SelectorThreePolicyBundle(input);
  assert.equal(out.readyForCanonicalPolicySource, false);
  assert.ok(out.blockers.includes("CAPITAL_LIQUIDITY_DTE_VALIDATED_PROVENANCE_REQUIRED"));
});

test("requires explicit owner approval and evidence references", () => {
  const input = bundle();
  input.ownerApprovalRef = "";
  input.premiumDeltaGamma.evidenceRef = "";
  const out = validateH1SelectorThreePolicyBundle(input);
  assert.equal(out.readyForCanonicalPolicySource, false);
  assert.ok(out.blockers.includes("THREE_POLICY_OWNER_APPROVAL_REF_REQUIRED"));
  assert.ok(out.blockers.includes("PREMIUM_DELTA_GAMMA_EVIDENCE_REF_REQUIRED"));
});

test("does not convert invalid policy shapes into validated production policy", () => {
  const input = bundle() as any;
  input.policies.capitalLiquidityDtePolicy.maxRelativeSpreadPct = 0;
  const out = validateH1SelectorThreePolicyBundle(input);
  assert.equal(out.readyForCanonicalPolicySource, false);
  assert.ok(out.blockers.includes("CAPITAL_LIQUIDITY_DTE_POLICY_UNVERIFIED"));
  assert.equal(out.validatedPolicies, null);
});
