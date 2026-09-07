import test from "node:test";
import assert from "node:assert/strict";
import { evaluateH1DteAwareShadowThreshold } from "../h1-dte-aware-shadow-threshold-v1.js";

test("MID_5_9 uses calibrated shadow threshold", () => {
  const out = evaluateH1DteAwareShadowThreshold({ dte: 7, absoluteDeltaChange: 0.023 });
  assert.equal(out.bucket, "MID_5_9");
  assert.equal(out.threshold, 0.022028497762746096);
  assert.equal(out.pass, true);
  assert.equal(out.affectsSelector, false);
});

test("FAR_10_PLUS uses calibrated shadow threshold", () => {
  const out = evaluateH1DteAwareShadowThreshold({ dte: 20, absoluteDeltaChange: 0.016 });
  assert.equal(out.bucket, "FAR_10_PLUS");
  assert.equal(out.threshold, 0.016496784582947822);
  assert.equal(out.pass, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
});

test("expiry and near buckets fail closed when evidence is insufficient", () => {
  const expiry = evaluateH1DteAwareShadowThreshold({ dte: 1, absoluteDeltaChange: 1 });
  const near = evaluateH1DteAwareShadowThreshold({ dte: 3, absoluteDeltaChange: 1 });
  assert.equal(expiry.pass, false);
  assert.equal(expiry.threshold, null);
  assert.equal(expiry.blocker, "INSUFFICIENT_OOS_EVIDENCE");
  assert.equal(near.pass, false);
  assert.equal(near.threshold, null);
  assert.equal(near.blocker, "INSUFFICIENT_CALIBRATION_AND_OOS_EVIDENCE");
});
