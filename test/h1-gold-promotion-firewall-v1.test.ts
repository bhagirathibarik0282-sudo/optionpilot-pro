import test from "node:test";
import assert from "node:assert/strict";
import {
  H1_GOLD_EVIDENCE_ADAPTER_VERSION,
  type H1GoldEvidenceAdapterResult,
  type H1GoldEvidenceFamilyAudit,
} from "../h1-gold-evidence-adapter-v1.js";
import {
  evaluateH1GoldEligibility,
  type GoldEvidenceFamily,
  type GoldEvidenceState,
} from "../h1-gold-eligibility-v1.js";
import { evaluateH1GoldPromotionFirewall } from "../h1-gold-promotion-firewall-v1.js";

const FAMILY_LIST: readonly GoldEvidenceFamily[] = [
  "dataIntegrity",
  "premiumPair",
  "spotStructure",
  "targetFuturesPositioning",
  "leaderPositioning",
  "peerConflictAbsent",
  "chainRepositioning",
  "executionQuality",
  "chasePhase",
  "horizonComplete",
] as const;

function families(overrides: Partial<Record<GoldEvidenceFamily, GoldEvidenceState>> = {}): Record<GoldEvidenceFamily, GoldEvidenceState> {
  return {
    dataIntegrity: "PASS",
    premiumPair: "PASS",
    spotStructure: "PASS",
    targetFuturesPositioning: "PASS",
    leaderPositioning: "PASS",
    peerConflictAbsent: "PASS",
    chainRepositioning: "PASS",
    executionQuality: "PASS",
    chasePhase: "PASS",
    horizonComplete: "PASS",
    ...overrides,
  };
}

function audits(fs: Record<GoldEvidenceFamily, GoldEvidenceState>): Record<GoldEvidenceFamily, H1GoldEvidenceFamilyAudit> {
  return Object.fromEntries(FAMILY_LIST.map((family) => [family, {
    family,
    requestedState: fs[family],
    adaptedState: fs[family],
    source: `TEST_EXACT_${family}`,
    snapshotId: "NIFTY-20260916-054500",
    observedAt: "2026-09-16T05:45:00.000Z",
    provenance: "LIVE_RUNTIME_EXACT",
    canonicalBound: true,
    producerApproved: true,
    producerApprovalReason: "APPROVED_GOLD_PRODUCER",
    producerMatchedFamily: family,
    futureLeakageBlocked: false,
    reasonCodes: [],
  }])) as Record<GoldEvidenceFamily, H1GoldEvidenceFamilyAudit>;
}

function adapter(
  overrides: Partial<Record<GoldEvidenceFamily, GoldEvidenceState>> = {},
  withAudits = true,
): H1GoldEvidenceAdapterResult {
  const fs = families(overrides);
  const observedAt = "2026-09-16T05:45:00.000Z";
  return {
    version: H1_GOLD_EVIDENCE_ADAPTER_VERSION,
    symbol: "NIFTY",
    side: "CE",
    observedAt,
    canonicalSnapshotId: "NIFTY-20260916-054500",
    canonicalRootValid: true,
    canonicalRootReasonCodes: [],
    families: fs,
    familyAudit: withAudits ? audits(fs) : ({} as H1GoldEvidenceAdapterResult["familyAudit"]),
    eligibility: evaluateH1GoldEligibility({
      symbol: "NIFTY",
      side: "CE",
      observedAt,
      source: "FIREWALL_TEST",
      provenance: "RESEARCH_EXACT",
      families: fs,
    }),
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    calculatesThresholds: false,
    failClosed: true,
    semantics: "CANONICAL_EXACT_APPROVED_PRODUCER_MAPPING_ONLY_NO_MARKET_INFERENCE",
  };
}

test("fully coherent strict Gold can only advance to forward validation, never production", () => {
  const out = evaluateH1GoldPromotionFirewall(adapter());
  assert.equal(out.state, "FORWARD_VALIDATION_REQUIRED");
  assert.equal(out.strictEligibilityDecision, "GOLD_ELIGIBLE_RESEARCH");
  assert.equal(out.shadowState, "GOLDEN_SHADOW_CANDIDATE");
  assert.equal(out.auditedFamilies.length, 10);
  assert.equal(out.forwardValidationRequired, true);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
  assert.ok(out.reasonCodes.includes("INDEPENDENT_HELD_OUT_FORWARD_VALIDATION_REQUIRED"));
});

test("intentional 3-of-4 shadow candidate divergence remains blocked by strict Gold firewall", () => {
  const input = adapter({ chainRepositioning: "MISSING" });
  const out = evaluateH1GoldPromotionFirewall(input);
  assert.equal(out.shadowState, "GOLDEN_SHADOW_CANDIDATE");
  assert.equal(out.strictEligibilityDecision, "BLOCKED");
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("STRICT_GOLD_NOT_ELIGIBLE"));
  assert.ok(out.blockerCodes.includes("FAMILY_NOT_PASS_CHAIN_REPOSITIONING"));
});

test("synthetic all-PASS fixture without exact family audits cannot leak into promotion review", () => {
  const out = evaluateH1GoldPromotionFirewall(adapter({}, false));
  assert.equal(out.strictEligibilityDecision, "GOLD_ELIGIBLE_RESEARCH");
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("MISSING_FAMILY_AUDIT_DATA_INTEGRITY"));
  assert.ok(out.blockerCodes.includes("MISSING_FAMILY_AUDIT_HORIZON_COMPLETE"));
});

test("cross-family producer alias is blocked even when all adapted family states say PASS", () => {
  const input = adapter();
  input.familyAudit.peerConflictAbsent.producerMatchedFamily = "leaderPositioning";
  const out = evaluateH1GoldPromotionFirewall(input);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("AUDIT_PRODUCER_FAMILY_MISMATCH_PEER_CONFLICT_ABSENT"));
});

test("future outcome leakage in any family audit blocks promotion review", () => {
  const input = adapter();
  input.familyAudit.horizonComplete.futureLeakageBlocked = true;
  input.familyAudit.horizonComplete.reasonCodes = ["DECISION_TIME_FUTURE_LEAKAGE_BLOCKED"];
  const out = evaluateH1GoldPromotionFirewall(input);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("AUDIT_FUTURE_LEAKAGE_HORIZON_COMPLETE"));
});

test("canonical root failure blocks before any research result can advance", () => {
  const input = adapter();
  input.canonicalRootValid = false;
  input.canonicalRootReasonCodes = ["CANONICAL_NOT_READY_FOR_STRICT_FILTERING"];
  const out = evaluateH1GoldPromotionFirewall(input);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("CANONICAL_ROOT_NOT_VALID_FOR_PROMOTION_REVIEW"));
});

test("tampered embedded eligibility decision is detected by independent strict recomputation", () => {
  const input = adapter({ peerConflictAbsent: "MISSING" });
  input.eligibility = { ...input.eligibility, decision: "GOLD_ELIGIBLE_RESEARCH" };
  const out = evaluateH1GoldPromotionFirewall(input);
  assert.equal(out.strictEligibilityDecision, "BLOCKED");
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockerCodes.includes("EMBEDDED_ELIGIBILITY_DECISION_MISMATCH"));
  assert.ok(out.blockerCodes.includes("STRICT_GOLD_NOT_ELIGIBLE"));
});
