import test from "node:test";
import assert from "node:assert/strict";
import { analyzeObservedCandidateMdiAvoidance } from "../h1-observed-candidate-mdi-avoidance.js";

test("MDI avoidance analyzer remains research-only and fail-closed without samples",()=>{
  const out=analyzeObservedCandidateMdiAvoidance([]);
  assert.equal(out.state,"UNAVAILABLE");
  assert.ok(out.blockers.includes("NO_OBSERVED_CANDIDATE_MDI_SAMPLES"));
  assert.equal(out.affectsVerdict,false);
  assert.equal(out.affectsTelegram,false);
  assert.equal(out.affectsExecution,false);
  assert.equal(out.createsOrders,false);
  assert.equal(out.aiMayOverride,false);
  assert.equal(out.semantics,"OBSERVED_H1_EXACT30M_GROSS_MDI_AVOIDANCE_DESCRIPTIVE_ONLY");
  assert.equal(out.mdiPolicy,"MDI_RESEARCH_SHADOW_V1_EXACT_SIGNAL_TIMESTAMP_DIRECTIONAL_ALIGNMENT");
});
