import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateH1GoldEligibility,
  type GoldEvidenceFamily,
  type GoldEvidenceState,
  type H1GoldEligibilityEvidence,
} from "../h1-gold-eligibility-v1.js";

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

function evidence(
  observedAt: string,
  overrides: Partial<Record<GoldEvidenceFamily, GoldEvidenceState>> = {},
): H1GoldEligibilityEvidence {
  return {
    symbol: "NIFTY",
    side: "PE",
    observedAt,
    source: "FROZEN_GOLD_RESEARCH_CASE",
    provenance: "RESEARCH_EXACT",
    families: families(overrides),
  };
}

test("Sep-7 09:21 reference Gold remains research eligible when every family passes", () => {
  const out = evaluateH1GoldEligibility(evidence("2026-09-07T03:51:00.000Z"));
  assert.equal(out.decision, "GOLD_ELIGIBLE_RESEARCH");
  assert.deepEqual(out.failedFamilies, []);
  assert.deepEqual(out.missingFamilies, []);
  assert.deepEqual(out.reasonCodes, ["ALL_GOLD_EVIDENCE_FAMILIES_PASS"]);
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
});

test("SENSEX uses the same Gold evidence-family standard as NIFTY", () => {
  const x = evidence("2026-09-07T03:51:00.000Z");
  x.symbol = "SENSEX";
  x.side = "CE";
  const out = evaluateH1GoldEligibility(x);
  assert.equal(out.decision, "GOLD_ELIGIBLE_RESEARCH");
  assert.deepEqual(out.reasonCodes, ["ALL_GOLD_EVIDENCE_FAMILIES_PASS"]);
});

test("BANKNIFTY cannot become a Gold trade candidate through this boundary", () => {
  const x = evidence("2026-09-07T03:51:00.000Z") as H1GoldEligibilityEvidence & { symbol: string };
  x.symbol = "BANKNIFTY";
  const out = evaluateH1GoldEligibility(x as H1GoldEligibilityEvidence);
  assert.equal(out.decision, "BLOCKED");
  assert.ok(out.reasonCodes.includes("INVALID_GOLD_SYMBOL"));
});

test("Sep-7 10:18 false PE is blocked by leader positioning regime", () => {
  const out = evaluateH1GoldEligibility(evidence("2026-09-07T04:48:00.000Z", {
    leaderPositioning: "FAIL",
  }));
  assert.equal(out.decision, "BLOCKED");
  assert.ok(out.reasonCodes.includes("FAILED_LEADER_POSITIONING"));
});

test("Sep-10 09:24 false PE is blocked by target positioning and chain contradiction", () => {
  const out = evaluateH1GoldEligibility(evidence("2026-09-10T03:54:00.000Z", {
    targetFuturesPositioning: "FAIL",
    chainRepositioning: "FAIL",
  }));
  assert.equal(out.decision, "BLOCKED");
  assert.ok(out.reasonCodes.includes("FAILED_TARGET_FUTURES_POSITIONING"));
  assert.ok(out.reasonCodes.includes("FAILED_CHAIN_REPOSITIONING"));
});

test("Sep-10 15:03 Gold-looking PE fails closed when peer evidence is missing and normal Gold horizon is incomplete", () => {
  const out = evaluateH1GoldEligibility(evidence("2026-09-10T09:33:00.000Z", {
    leaderPositioning: "MISSING",
    peerConflictAbsent: "MISSING",
    horizonComplete: "FAIL",
  }));
  assert.equal(out.decision, "BLOCKED");
  assert.ok(out.reasonCodes.includes("MISSING_LEADER_POSITIONING"));
  assert.ok(out.reasonCodes.includes("MISSING_PEER_CONFLICT_ABSENT"));
  assert.ok(out.reasonCodes.includes("FAILED_HORIZON_COMPLETE"));
});

test("Sep-7 14:36 positive opportunity can remain non-Gold when positioning quality is insufficient", () => {
  const out = evaluateH1GoldEligibility(evidence("2026-09-07T09:06:00.000Z", {
    targetFuturesPositioning: "FAIL",
    leaderPositioning: "FAIL",
  }));
  assert.equal(out.decision, "BLOCKED");
  assert.ok(out.reasonCodes.includes("FAILED_TARGET_FUTURES_POSITIONING"));
  assert.ok(out.reasonCodes.includes("FAILED_LEADER_POSITIONING"));
});

test("missing evidence fails closed instead of being inferred from premium strength", () => {
  const out = evaluateH1GoldEligibility(evidence("2026-09-07T03:51:00.000Z", {
    chainRepositioning: "MISSING",
  }));
  assert.equal(out.decision, "BLOCKED");
  assert.ok(out.reasonCodes.includes("MISSING_CHAIN_REPOSITIONING"));
});
