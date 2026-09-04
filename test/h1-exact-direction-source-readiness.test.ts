import assert from "node:assert/strict";
import test from "node:test";
import { auditH1ExactDirectionSourceReadiness } from "../h1-exact-direction-source-readiness.js";

test("accepts only verified deterministic LIVE_RUNTIME_EXACT direction source", () => {
  const out = auditH1ExactDirectionSourceReadiness({
    source: "VERIFIED_DETERMINISTIC_RUNTIME",
    sourceId: "H1_DETERMINISTIC_DIRECTION_RUNTIME_V1",
    liveRuntimeExact: true,
    deterministic: true,
    optionSideInferenceUsed: false,
    callerStaticDirectionUsed: false,
  });
  assert.equal(out.ready, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.affectsExecution, false);
});

test("static contract UP/DOWN direction is forbidden for activation", () => {
  const out = auditH1ExactDirectionSourceReadiness({
    source: "STATIC_CONTRACT_DIRECTION",
    sourceId: "KITE_H1_EXACT_POLICY_JSON",
    liveRuntimeExact: false,
    deterministic: true,
    optionSideInferenceUsed: false,
    callerStaticDirectionUsed: true,
  });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("STATIC_CONTRACT_DIRECTION_FORBIDDEN"));
  assert.ok(out.blockers.includes("VERIFIED_DETERMINISTIC_RUNTIME_DIRECTION_SOURCE_REQUIRED"));
});

test("CE/PE option-side inference is explicitly forbidden", () => {
  const out = auditH1ExactDirectionSourceReadiness({
    source: "OPTION_SIDE_INFERENCE",
    sourceId: "CE_PE_SIDE",
    liveRuntimeExact: true,
    deterministic: true,
    optionSideInferenceUsed: true,
    callerStaticDirectionUsed: false,
  });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("OPTION_SIDE_DIRECTION_INFERENCE_FORBIDDEN"));
});

test("missing direction source fails closed", () => {
  const out = auditH1ExactDirectionSourceReadiness({
    source: "MISSING",
    sourceId: null,
    liveRuntimeExact: false,
    deterministic: false,
    optionSideInferenceUsed: false,
    callerStaticDirectionUsed: false,
  });
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("DIRECTION_SOURCE_MISSING"));
  assert.ok(out.blockers.includes("DIRECTION_SOURCE_ID_REQUIRED"));
});
