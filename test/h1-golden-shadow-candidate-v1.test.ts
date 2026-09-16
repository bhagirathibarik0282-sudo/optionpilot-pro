import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGoldenShadowCandidate,
  GOLDEN_SHADOW_MIN_CORE_CONFIRMATIONS,
} from "../h1-golden-shadow-candidate-v1.js";
import {
  H1_GOLD_EVIDENCE_ADAPTER_VERSION,
  type H1GoldEvidenceAdapterResult,
} from "../h1-gold-evidence-adapter-v1.js";
import type { GoldEvidenceFamily, GoldEvidenceState } from "../h1-gold-eligibility-v1.js";

function families(overrides: Partial<Record<GoldEvidenceFamily, GoldEvidenceState>> = {}): Record<GoldEvidenceFamily, GoldEvidenceState> {
  return {
    dataIntegrity: "PASS",
    premiumPair: "PASS",
    spotStructure: "PASS",
    targetFuturesPositioning: "PASS",
    leaderPositioning: "PASS",
    peerConflictAbsent: "MISSING",
    chainRepositioning: "MISSING",
    executionQuality: "PASS",
    chasePhase: "MISSING",
    horizonComplete: "MISSING",
    ...overrides,
  };
}

function adapter(overrides: Partial<Record<GoldEvidenceFamily, GoldEvidenceState>> = {}): H1GoldEvidenceAdapterResult {
  const fs = families(overrides);
  return {
    version: H1_GOLD_EVIDENCE_ADAPTER_VERSION,
    symbol: "NIFTY",
    side: "CE",
    observedAt: "2026-09-16T05:45:00.000Z",
    canonicalSnapshotId: "NIFTY-20260916-054500",
    canonicalRootValid: true,
    canonicalRootReasonCodes: [],
    families: fs,
    familyAudit: {} as H1GoldEvidenceAdapterResult["familyAudit"],
    eligibility: {
      version: "H1_GOLD_ELIGIBILITY_V1",
      decision: "BLOCKED",
      passedFamilies: Object.entries(fs).filter(([, state]) => state === "PASS").map(([family]) => family as GoldEvidenceFamily),
      failedFamilies: Object.entries(fs).filter(([, state]) => state === "FAIL").map(([family]) => family as GoldEvidenceFamily),
      missingFamilies: Object.entries(fs).filter(([, state]) => state === "MISSING").map(([family]) => family as GoldEvidenceFamily),
      reasonCodes: [],
      productionImpact: "NONE",
      affectsSelector: false,
      affectsTelegram: false,
      affectsExecution: false,
      grantsPromotionAuthority: false,
      failClosed: true,
      semantics: "RESEARCH_GOLD_CONVERGENCE_AUDIT_ONLY_NO_THRESHOLD_PROMOTION",
    },
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

test("forms a Golden shadow candidate with all hard gates and 3-of-4 core confirmations even when support context is missing", () => {
  const out = evaluateGoldenShadowCandidate(adapter());
  assert.equal(GOLDEN_SHADOW_MIN_CORE_CONFIRMATIONS, 3);
  assert.equal(out.state, "GOLDEN_SHADOW_CANDIDATE");
  assert.deepEqual(out.passedCoreConfirmations.sort(), [
    "leaderPositioning",
    "spotStructure",
    "targetFuturesPositioning",
  ].sort());
  assert.deepEqual(out.missingCoreConfirmations, ["chainRepositioning"]);
  assert.ok(out.reasonCodes.includes("HARD_GATES_PASS"));
  assert.ok(out.reasonCodes.includes("CORE_CONFIRMATION_PASS_3_OF_4"));
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
});

test("missing hard gate rejects instead of turning unavailable data into a candidate", () => {
  const out = evaluateGoldenShadowCandidate(adapter({ premiumPair: "MISSING" }));
  assert.equal(out.state, "REJECTED");
  assert.ok(out.reasonCodes.includes("HARD_GATE_MISSING_PREMIUM_PAIR"));
});

test("explicit core contradiction vetoes candidate even when three other core confirmations pass", () => {
  const out = evaluateGoldenShadowCandidate(adapter({ chainRepositioning: "FAIL" }));
  assert.equal(out.state, "REJECTED");
  assert.ok(out.reasonCodes.includes("CORE_CONTRADICTION_CHAIN_REPOSITIONING"));
});

test("explicit context contradiction vetoes candidate while missing context alone does not", () => {
  const out = evaluateGoldenShadowCandidate(adapter({ peerConflictAbsent: "FAIL" }));
  assert.equal(out.state, "REJECTED");
  assert.ok(out.reasonCodes.includes("CONTEXT_CONTRADICTION_PEER_CONFLICT_ABSENT"));
});

test("two core confirmations remain WATCH rather than being promoted by context", () => {
  const out = evaluateGoldenShadowCandidate(adapter({
    leaderPositioning: "MISSING",
    chainRepositioning: "MISSING",
  }));
  assert.equal(out.state, "WATCH");
  assert.ok(out.reasonCodes.includes("CORE_CONFIRMATION_INCOMPLETE_2_OF_4"));
  assert.equal(out.grantsPromotionAuthority, false);
});

test("invalid canonical root is rejected before convergence logic", () => {
  const input = adapter();
  input.canonicalRootValid = false;
  input.canonicalRootReasonCodes = ["CANONICAL_NOT_READY_FOR_STRICT_FILTERING"];
  const out = evaluateGoldenShadowCandidate(input);
  assert.equal(out.state, "REJECTED");
  assert.deepEqual(out.reasonCodes, ["CANONICAL_ROOT_NOT_VALID_FOR_GOLDEN_SHADOW"]);
});
