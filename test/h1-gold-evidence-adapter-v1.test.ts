import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptH1GoldEvidence,
  type H1GoldEvidenceAdapterInput,
  type H1GoldExactFamilySignal,
} from "../h1-gold-evidence-adapter-v1.js";

const T = "2026-09-07T03:51:00.000Z";

function signal(overrides: Partial<H1GoldExactFamilySignal> = {}): H1GoldExactFamilySignal {
  return {
    state: "PASS",
    source: "EXACT_TEST_SOURCE",
    observedAt: T,
    provenance: "RESEARCH_EXACT",
    reasonCodes: ["UPSTREAM_EXACT"],
    ...overrides,
  };
}

function input(): H1GoldEvidenceAdapterInput {
  return {
    symbol: "NIFTY",
    side: "PE",
    observedAt: T,
    dataIntegrity: signal(),
    premiumPair: signal(),
    spotStructure: signal(),
    targetFuturesPositioning: signal(),
    leaderPositioning: signal(),
    peerConflictAbsent: signal(),
    chainRepositioning: signal(),
    executionQuality: signal(),
    chasePhase: signal(),
    horizonComplete: signal(),
  };
}

test("all exact synchronized PASS families remain Gold eligible research-only", () => {
  const out = adaptH1GoldEvidence(input());
  assert.equal(out.eligibility.decision, "GOLD_ELIGIBLE_RESEARCH");
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.calculatesThresholds, false);
});

test("PASS with empty source is downgraded to MISSING and blocks", () => {
  const x = input();
  x.premiumPair = signal({ source: "" });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.premiumPair, "MISSING");
  assert.equal(out.eligibility.decision, "BLOCKED");
  assert.ok(out.familyAudit.premiumPair.reasonCodes.includes("MISSING_UPSTREAM_SOURCE"));
});

test("invalid runtime provenance is downgraded to MISSING", () => {
  const x = input();
  x.spotStructure = signal({ provenance: "UNVERIFIED" as H1GoldExactFamilySignal["provenance"] });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.spotStructure, "MISSING");
  assert.ok(out.familyAudit.spotStructure.reasonCodes.includes("INVALID_UPSTREAM_PROVENANCE"));
});

test("timestamp mismatch without explicit synchronization is downgraded", () => {
  const x = input();
  x.targetFuturesPositioning = signal({ observedAt: "2026-09-07T03:48:00.000Z" });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.targetFuturesPositioning, "MISSING");
  assert.ok(out.familyAudit.targetFuturesPositioning.reasonCodes.includes("UPSTREAM_TIMESTAMP_NOT_SYNCHRONIZED"));
});

test("timestamp mismatch with explicit synchronized assertion preserves PASS", () => {
  const x = input();
  x.leaderPositioning = signal({
    observedAt: "2026-09-07T03:50:55.000Z",
    synchronized: true,
    provenance: "LIVE_RUNTIME_EXACT",
  });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.leaderPositioning, "PASS");
  assert.equal(out.familyAudit.leaderPositioning.provenance, "LIVE_RUNTIME_EXACT");
  assert.equal(out.eligibility.decision, "GOLD_ELIGIBLE_RESEARCH");
});

test("valid upstream FAIL passes through and blocks Gold", () => {
  const x = input();
  x.peerConflictAbsent = signal({ state: "FAIL", reasonCodes: ["STRONG_OPPOSITE_PEER"] });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.peerConflictAbsent, "FAIL");
  assert.equal(out.eligibility.decision, "BLOCKED");
  assert.ok(out.eligibility.reasonCodes.includes("FAILED_PEER_CONFLICT_ABSENT"));
});

test("upstream MISSING stays MISSING and blocks Gold", () => {
  const x = input();
  x.chainRepositioning = signal({ state: "MISSING", reasonCodes: ["CHAIN_SOURCE_UNAVAILABLE"] });
  const out = adaptH1GoldEvidence(x);
  assert.equal(out.families.chainRepositioning, "MISSING");
  assert.equal(out.eligibility.decision, "BLOCKED");
  assert.ok(out.eligibility.reasonCodes.includes("MISSING_CHAIN_REPOSITIONING"));
});

test("source, provenance and upstream reasons are preserved in family audit", () => {
  const x = input();
  x.executionQuality = signal({
    source: "H1_EXECUTION_EXACT_V1",
    provenance: "LIVE_RUNTIME_EXACT",
    reasonCodes: ["SPREAD_OK", "QUOTE_FRESH"],
  });
  const out = adaptH1GoldEvidence(x);
  const audit = out.familyAudit.executionQuality;
  assert.equal(audit.source, "H1_EXECUTION_EXACT_V1");
  assert.equal(audit.provenance, "LIVE_RUNTIME_EXACT");
  assert.deepEqual(audit.reasonCodes, ["SPREAD_OK", "QUOTE_FRESH"]);
});
