import test from "node:test";
import assert from "node:assert/strict";
import {
  auditGoldProducer,
  H1_GOLD_EVIDENCE_SOURCE_REGISTRY_SAFETY,
  listApprovedGoldProducers,
} from "../h1-gold-evidence-source-registry-v1.js";

test("only code-proven execution-quality producer is currently approved", () => {
  const all = listApprovedGoldProducers();
  assert.deepEqual(all.map((x) => [x.family, x.source, x.provenance]), [
    ["executionQuality", "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1", "LIVE_RUNTIME_EXACT"],
  ]);
});

test("approved producer is accepted only for its exact family and provenance", () => {
  const out = auditGoldProducer(
    "executionQuality",
    "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1",
    "LIVE_RUNTIME_EXACT",
  );
  assert.equal(out.approved, true);
  assert.equal(out.reason, "APPROVED_GOLD_PRODUCER");
  assert.equal(out.matchedFamily, "executionQuality");
});

test("approved execution source cannot be swapped into premiumPair", () => {
  const out = auditGoldProducer(
    "premiumPair",
    "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1",
    "LIVE_RUNTIME_EXACT",
  );
  assert.equal(out.approved, false);
  assert.equal(out.reason, "SOURCE_APPROVED_FOR_DIFFERENT_GOLD_FAMILY");
  assert.equal(out.matchedFamily, "executionQuality");
});

test("generic exact-looking source is rejected", () => {
  const out = auditGoldProducer("executionQuality", "EXACT_TEST_SOURCE", "LIVE_RUNTIME_EXACT");
  assert.equal(out.approved, false);
  assert.equal(out.reason, "UNKNOWN_GOLD_EVIDENCE_SOURCE");
});

test("same producer with research provenance is rejected", () => {
  const out = auditGoldProducer(
    "executionQuality",
    "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1",
    "RESEARCH_EXACT",
  );
  assert.equal(out.approved, false);
  assert.equal(out.reason, "UNAPPROVED_GOLD_PROVENANCE");
});

test("unproven market-positioning families remain fail-closed", () => {
  for (const family of [
    "premiumPair",
    "spotStructure",
    "targetFuturesPositioning",
    "leaderPositioning",
    "peerConflictAbsent",
    "chainRepositioning",
    "chasePhase",
    "horizonComplete",
  ] as const) {
    const out = auditGoldProducer(family, `CLAIMED_${family}`, "LIVE_RUNTIME_EXACT");
    assert.equal(out.approved, false);
    assert.equal(out.reason, "NO_APPROVED_GOLD_PRODUCER_FOR_FAMILY");
  }
});

test("registry remains research-only and cannot promote or execute", () => {
  assert.equal(H1_GOLD_EVIDENCE_SOURCE_REGISTRY_SAFETY.productionImpact, "NONE");
  assert.equal(H1_GOLD_EVIDENCE_SOURCE_REGISTRY_SAFETY.affectsSelector, false);
  assert.equal(H1_GOLD_EVIDENCE_SOURCE_REGISTRY_SAFETY.affectsTelegram, false);
  assert.equal(H1_GOLD_EVIDENCE_SOURCE_REGISTRY_SAFETY.affectsExecution, false);
  assert.equal(H1_GOLD_EVIDENCE_SOURCE_REGISTRY_SAFETY.grantsPromotionAuthority, false);
  assert.equal(H1_GOLD_EVIDENCE_SOURCE_REGISTRY_SAFETY.failClosed, true);
});
