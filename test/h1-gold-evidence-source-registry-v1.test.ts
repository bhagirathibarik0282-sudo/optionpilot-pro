import test from "node:test";
import assert from "node:assert/strict";
import {
  auditGoldProducer,
  H1_GOLD_EVIDENCE_SOURCE_REGISTRY_SAFETY,
  listApprovedGoldProducers,
} from "../h1-gold-evidence-source-registry-v1.js";

const PREMIUM_PAIR_SOURCE = "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION";
const EXECUTION_SOURCE = "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1";

test("only code-proven Gold producers are approved", () => {
  const all = listApprovedGoldProducers();
  assert.deepEqual(all.map((x) => [x.family, x.source, x.provenance]), [
    ["premiumPair", PREMIUM_PAIR_SOURCE, "LIVE_RUNTIME_EXACT"],
    ["executionQuality", EXECUTION_SOURCE, "LIVE_RUNTIME_EXACT"],
  ]);
});

test("premium-pair source is accepted only for premiumPair", () => {
  const out = auditGoldProducer("premiumPair", PREMIUM_PAIR_SOURCE, "LIVE_RUNTIME_EXACT");
  assert.equal(out.approved, true);
  assert.equal(out.reason, "APPROVED_GOLD_PRODUCER");
  assert.equal(out.matchedFamily, "premiumPair");
  assert.match(out.registration?.evidenceBasis ?? "", /supporting-only/i);
});

test("approved execution-quality producer is accepted only for its exact family and provenance", () => {
  const out = auditGoldProducer("executionQuality", EXECUTION_SOURCE, "LIVE_RUNTIME_EXACT");
  assert.equal(out.approved, true);
  assert.equal(out.reason, "APPROVED_GOLD_PRODUCER");
  assert.equal(out.matchedFamily, "executionQuality");
});

test("approved execution source cannot be swapped into premiumPair", () => {
  const out = auditGoldProducer("premiumPair", EXECUTION_SOURCE, "LIVE_RUNTIME_EXACT");
  assert.equal(out.approved, false);
  assert.equal(out.reason, "SOURCE_APPROVED_FOR_DIFFERENT_GOLD_FAMILY");
  assert.equal(out.matchedFamily, "executionQuality");
});

test("approved premium-pair source cannot be swapped into executionQuality", () => {
  const out = auditGoldProducer("executionQuality", PREMIUM_PAIR_SOURCE, "LIVE_RUNTIME_EXACT");
  assert.equal(out.approved, false);
  assert.equal(out.reason, "SOURCE_APPROVED_FOR_DIFFERENT_GOLD_FAMILY");
  assert.equal(out.matchedFamily, "premiumPair");
});

test("generic exact-looking source is rejected", () => {
  const out = auditGoldProducer("executionQuality", "EXACT_TEST_SOURCE", "LIVE_RUNTIME_EXACT");
  assert.equal(out.approved, false);
  assert.equal(out.reason, "UNKNOWN_GOLD_EVIDENCE_SOURCE");
});

test("same producer with research provenance is rejected", () => {
  const out = auditGoldProducer("executionQuality", EXECUTION_SOURCE, "RESEARCH_EXACT");
  assert.equal(out.approved, false);
  assert.equal(out.reason, "UNAPPROVED_GOLD_PROVENANCE");
});

test("unproven Gold families remain fail-closed", () => {
  for (const family of [
    "dataIntegrity",
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
