import test from "node:test";
import assert from "node:assert/strict";
import {
  H1_GOLD_EVIDENCE_ADAPTER_VERSION,
  type H1GoldEvidenceAdapterResult,
} from "../h1-gold-evidence-adapter-v1.js";
import {
  evaluateH1GoldEligibility,
  type GoldEvidenceFamily,
  type GoldEvidenceState,
} from "../h1-gold-eligibility-v1.js";
import { evaluateGoldenShadowCandidate } from "../h1-golden-shadow-candidate-v1.js";

const PASS = "PASS" as const;

function families(overrides: Partial<Record<GoldEvidenceFamily, GoldEvidenceState>> = {}): Record<GoldEvidenceFamily, GoldEvidenceState> {
  return {
    dataIntegrity: PASS,
    premiumPair: PASS,
    spotStructure: PASS,
    targetFuturesPositioning: PASS,
    leaderPositioning: PASS,
    peerConflictAbsent: PASS,
    chainRepositioning: PASS,
    executionQuality: PASS,
    chasePhase: PASS,
    horizonComplete: PASS,
    ...overrides,
  };
}

function adapter(
  observedAt: string,
  overrides: Partial<Record<GoldEvidenceFamily, GoldEvidenceState>> = {},
): H1GoldEvidenceAdapterResult {
  const fs = families(overrides);
  const eligibility = evaluateH1GoldEligibility({
    symbol: "NIFTY",
    side: "PE",
    observedAt,
    source: "FROZEN_GOLD_RESEARCH_CASE",
    provenance: "RESEARCH_EXACT",
    families: fs,
  });

  return {
    version: H1_GOLD_EVIDENCE_ADAPTER_VERSION,
    symbol: "NIFTY",
    side: "PE",
    observedAt,
    canonicalSnapshotId: `FROZEN:${observedAt}`,
    canonicalRootValid: true,
    canonicalRootReasonCodes: [],
    families: fs,
    familyAudit: {} as H1GoldEvidenceAdapterResult["familyAudit"],
    eligibility,
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

test("Sep-7 09:21 reference Gold remains a Golden shadow candidate", () => {
  const input = adapter("2026-09-07T03:51:00.000Z");
  const out = evaluateGoldenShadowCandidate(input);
  assert.equal(input.eligibility.decision, "GOLD_ELIGIBLE_RESEARCH");
  assert.equal(out.state, "GOLDEN_SHADOW_CANDIDATE");
  assert.equal(out.failedFamilies.length, 0);
  assert.equal(out.passedCoreConfirmations.length, 4);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

for (const frozen of [
  {
    name: "Sep-7 10:18 false PE leader contradiction",
    observedAt: "2026-09-07T04:48:00.000Z",
    overrides: { leaderPositioning: "FAIL" } as const,
    reason: "CORE_CONTRADICTION_LEADER_POSITIONING",
  },
  {
    name: "Sep-10 09:24 false PE futures plus chain contradiction",
    observedAt: "2026-09-10T03:54:00.000Z",
    overrides: { targetFuturesPositioning: "FAIL", chainRepositioning: "FAIL" } as const,
    reason: "CORE_CONTRADICTION_TARGET_FUTURES_POSITIONING",
  },
  {
    name: "Sep-10 15:03 Gold-looking late PE incomplete horizon",
    observedAt: "2026-09-10T09:33:00.000Z",
    overrides: { leaderPositioning: "MISSING", peerConflictAbsent: "MISSING", horizonComplete: "FAIL" } as const,
    reason: "CONTEXT_CONTRADICTION_HORIZON_COMPLETE",
  },
  {
    name: "Sep-7 14:36 weaker PE positioning contradiction",
    observedAt: "2026-09-07T09:06:00.000Z",
    overrides: { targetFuturesPositioning: "FAIL", leaderPositioning: "FAIL" } as const,
    reason: "CORE_CONTRADICTION_TARGET_FUTURES_POSITIONING",
  },
] as const) {
  test(`${frozen.name} cannot leak through the Golden shadow gate`, () => {
    const input = adapter(frozen.observedAt, frozen.overrides);
    const out = evaluateGoldenShadowCandidate(input);
    assert.equal(input.eligibility.decision, "BLOCKED");
    assert.equal(out.state, "REJECTED");
    assert.ok(out.reasonCodes.includes(frozen.reason));
    assert.equal(out.grantsPromotionAuthority, false);
    assert.equal(out.createsOrders, false);
  });
}

test("single missing core family exposes the intentional strict-Gold vs shadow-candidate divergence", () => {
  const input = adapter("2026-09-07T03:51:00.000Z", { chainRepositioning: "MISSING" });
  const out = evaluateGoldenShadowCandidate(input);

  assert.equal(input.eligibility.decision, "BLOCKED");
  assert.equal(out.state, "GOLDEN_SHADOW_CANDIDATE");
  assert.deepEqual(out.missingCoreConfirmations, ["chainRepositioning"]);
  assert.ok(out.reasonCodes.includes("CORE_CONFIRMATION_PASS_3_OF_4"));
  assert.ok(out.reasonCodes.includes("SHADOW_ONLY_NO_PRODUCTION_AUTHORITY"));
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
});

test("missing hard-gate evidence never receives the 3-of-4 core exception", () => {
  const input = adapter("2026-09-07T03:51:00.000Z", { premiumPair: "MISSING" });
  const out = evaluateGoldenShadowCandidate(input);
  assert.equal(input.eligibility.decision, "BLOCKED");
  assert.equal(out.state, "REJECTED");
  assert.ok(out.reasonCodes.includes("HARD_GATE_MISSING_PREMIUM_PAIR"));
});
