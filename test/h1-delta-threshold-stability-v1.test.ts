import test from "node:test";
import assert from "node:assert/strict";
import { evaluateH1DeltaThresholdStability } from "../h1-delta-threshold-stability-v1.js";

test("fails closed when calibration P95 does not retain out of sample",()=>{
  const r=evaluateH1DeltaThresholdStability({
    calibrationP95:0.023634703289104296,
    oosP95:0.013214468793392692,
    oosPassRateAtCandidate:0.014018691588785047,
  });
  assert.equal(r.stable,false);
  assert.ok(r.blockers.includes("P95_RETENTION_TOO_LOW"));
  assert.ok(r.blockers.includes("OOS_PASS_RATE_TOO_LOW"));
  assert.equal(r.productionImpact,"NONE");
  assert.equal(r.affectsSelector,false);
  assert.equal(r.affectsExecution,false);
});
