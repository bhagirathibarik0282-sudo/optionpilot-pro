import test from "node:test";
import assert from "node:assert/strict";
import {
  auditGoldProducer,
  H1_GOLD_EVIDENCE_SOURCE_REGISTRY_SAFETY,
  listApprovedGoldProducers,
} from "../h1-gold-evidence-source-registry-v1.js";

const DATA_INTEGRITY_SOURCE = "H1_GOLD_CANONICAL_DATA_INTEGRITY_BRIDGE_V1";
const PREMIUM_PAIR_SOURCE = "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION";
const SPOT_STRUCTURE_SOURCE = "H1_GOLD_ATTESTED_MARKET_STRUCTURE_BRIDGE_V1";
const FUTURES_SOURCE = "H1_GOLD_ATTESTED_FUTURES_CONFIRMATION_BRIDGE_V1";
const LEADER_SOURCE = "H1_GOLD_ATTESTED_HEAVYWEIGHTS_BRIDGE_V1";
const PEER_SOURCE = "H1_GOLD_EXACT_PEER_CONFLICT_ABSENT_V1";
const CHAIN_SOURCE = "H1_GOLD_ATTESTED_OI_POSITIONING_BRIDGE_V1";
const EXECUTION_SOURCE = "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1";

test("only code-proven Gold producers are approved", () => {
  const all = listApprovedGoldProducers();
  assert.deepEqual(all.map((x) => [x.family, x.source, x.provenance]), [
    ["dataIntegrity", DATA_INTEGRITY_SOURCE, "LIVE_RUNTIME_EXACT"],
    ["premiumPair", PREMIUM_PAIR_SOURCE, "LIVE_RUNTIME_EXACT"],
    ["spotStructure", SPOT_STRUCTURE_SOURCE, "LIVE_RUNTIME_EXACT"],
    ["targetFuturesPositioning", FUTURES_SOURCE, "LIVE_RUNTIME_EXACT"],
    ["leaderPositioning", LEADER_SOURCE, "LIVE_RUNTIME_EXACT"],
    ["peerConflictAbsent", PEER_SOURCE, "LIVE_RUNTIME_EXACT"],
    ["chainRepositioning", CHAIN_SOURCE, "LIVE_RUNTIME_EXACT"],
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

test("typed canonical data-integrity producer is accepted only for dataIntegrity", () => {
  const out = auditGoldProducer("dataIntegrity", DATA_INTEGRITY_SOURCE, "LIVE_RUNTIME_EXACT");
  assert.equal(out.approved, true);
  assert.equal(out.reason, "APPROVED_GOLD_PRODUCER");
  assert.equal(out.matchedFamily, "dataIntegrity");
});

test("typed four-family bridges are approved for their exact families", () => {
  for (const [family, source] of [
    ["spotStructure", SPOT_STRUCTURE_SOURCE],
    ["targetFuturesPositioning", FUTURES_SOURCE],
    ["leaderPositioning", LEADER_SOURCE],
    ["chainRepositioning", CHAIN_SOURCE],
  ] as const) {
    const out = auditGoldProducer(family, source, "LIVE_RUNTIME_EXACT");
    assert.equal(out.approved, true);
    assert.equal(out.reason, "APPROVED_GOLD_PRODUCER");
    assert.equal(out.matchedFamily, family);
  }
});

test("exact peer-conflict producer is accepted only for peerConflictAbsent", () => {
  const out = auditGoldProducer("peerConflictAbsent", PEER_SOURCE, "LIVE_RUNTIME_EXACT");
  assert.equal(out.approved, true);
  assert.equal(out.reason, "APPROVED_GOLD_PRODUCER");
  assert.equal(out.matchedFamily, "peerConflictAbsent");
  assert.match(out.registration?.evidenceBasis ?? "", /no consensus vote or new threshold/i);
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

test("approved core source cannot be swapped into another core family", () => {
  const out = auditGoldProducer("leaderPositioning", FUTURES_SOURCE, "LIVE_RUNTIME_EXACT");
  assert.equal(out.approved, false);
  assert.equal(out.reason, "SOURCE_APPROVED_FOR_DIFFERENT_GOLD_FAMILY");
  assert.equal(out.matchedFamily, "targetFuturesPositioning");
});

test("approved peer source cannot be swapped into another Gold family", () => {
  const out = auditGoldProducer("chainRepositioning", PEER_SOURCE, "LIVE_RUNTIME_EXACT");
  assert.equal(out.approved, false);
  assert.equal(out.reason, "SOURCE_APPROVED_FOR_DIFFERENT_GOLD_FAMILY");
  assert.equal(out.matchedFamily, "peerConflictAbsent");
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

test("remaining unproven context Gold families stay fail-closed", () => {
  for (const family of ["chasePhase", "horizonComplete"] as const) {
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
