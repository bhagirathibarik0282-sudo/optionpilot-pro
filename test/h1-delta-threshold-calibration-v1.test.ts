import test from "node:test";
import assert from "node:assert/strict";
import { calibrateH1DeltaThreshold } from "../h1-delta-threshold-calibration-v1.js";

test("calibrates only exact 3-minute same-contract delta changes", () => {
  const base={symbol:"NIFTY",expiry:"2026-09-08",strike:24000,optionType:"CE" as const,ltp:100,gamma:.002};
  const r=calibrateH1DeltaThreshold([
    {...base,minuteBucket:"2026-09-07T03:45:00.000Z",delta:.40},
    {...base,minuteBucket:"2026-09-07T03:48:00.000Z",delta:.41},
    {...base,minuteBucket:"2026-09-07T03:51:00.000Z",delta:.45},
    {...base,minuteBucket:"2026-09-07T03:55:00.000Z",delta:.90},
  ]);
  assert.equal(r.sampleCount,2);
  assert.equal(r.absoluteDeltaChange.max,0.040000000000000036);
  assert.equal(r.absoluteDeltaChange.passRateAt003,.5);
  assert.equal(r.productionImpact,"NONE");
  assert.equal(r.semantics,"HISTORICAL_RESEARCH_ONLY");
});
