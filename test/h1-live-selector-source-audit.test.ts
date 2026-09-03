import test from "node:test";
import assert from "node:assert/strict";
import { auditH1LiveSelectorSource } from "../h1-live-selector-source-audit.js";

test("H1 live selector source audit fails closed on research-shadow-only source", () => {
  const result = auditH1LiveSelectorSource();
  assert.equal(result.version, "H1_LIVE_SELECTOR_SOURCE_AUDIT_V1");
  assert.equal(result.sourceKind, "RESEARCH_SHADOW_ONLY");
  assert.equal(result.h1CandidateMarkingAllowed, false);
  assert.equal(result.failClosed, true);
  assert.deepEqual(result.blockers, ["NO_VERIFIED_LIVE_DETERMINISTIC_SELECTOR_SOURCE"]);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.createsOrders, false);
  assert.equal(result.aiMayOverride, false);
});

test("shadow evidence cannot be represented as permission to mark H1 candidates", () => {
  const result = auditH1LiveSelectorSource();
  assert.ok(result.evidence.includes("CANDIDATE_RANKING_SHADOW_USES_EXECUTION_SELECTOR"));
  assert.ok(result.evidence.includes("CANDIDATE_RANKING_SHADOW_HAS_NO_EXECUTION_AUTHORITY"));
  assert.ok(result.evidence.includes("RESEARCH_ENGINE_CHAIN_IS_CALLER_SUPPLIED_SHADOW_ONLY"));
  assert.ok(result.evidence.includes("H1_RUNTIME_HOOK_HAS_NO_EXACT_SELECTOR_DECISION_ARGUMENT"));
  assert.notEqual(result.sourceKind, "LIVE_DETERMINISTIC_EXACT");
  assert.equal(result.h1CandidateMarkingAllowed, false);
});
