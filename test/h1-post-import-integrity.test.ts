import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePostImportIntegrity } from "../h1-post-import-integrity.js";

const good = {
  requestedTradingDays: 60, importedTradingDays: 60, symbolsExpected: 7, symbolsObserved: 7,
  duplicateLogicalKeys: 0, cePeMismatchBuckets: 0, expiryDateShiftRows: 0, outsideSessionRows: 0,
  futureLeakRows: 0, runningBlockRows: 0, researchEligiblePartialRows: 0, researchEligibleStaleRows: 0,
  researchEligibleInvalidRows: 0, traceabilityFailures: 0, verifiedOutcomeCount: 40,
  calibrationEligibleOutcomeCount: 35, incompleteOutcomeCount: 5, regimeMatchedAnalogCount: 40,
  alignedSevenIndexDays: 60, requiredAlignedSevenIndexDays: 60,
};

test("clean 60D structure can become STRUCTURE_READY but does not claim model calibration", () => {
  const r = evaluatePostImportIntegrity(good);
  assert.equal(r.integrityStatus, "PASS");
  assert.equal(r.calibrationReadiness, "STRUCTURE_READY");
  assert.match(r.summary, /does not itself validate or calibrate/i);
  assert.equal(r.affectsVerdict, false);
});

test("single future leak hard-fails post-import integrity", () => {
  const r = evaluatePostImportIntegrity({ ...good, futureLeakRows: 1 });
  assert.equal(r.integrityStatus, "FAIL");
  assert.ok(r.hardBlockers.includes("FUTURE_DATA_LEAK"));
  assert.equal(r.calibrationReadiness, "NOT_READY");
});

test("clean structure with small sample remains NOT_READY", () => {
  const r = evaluatePostImportIntegrity({ ...good, calibrationEligibleOutcomeCount: 10, regimeMatchedAnalogCount: 12 });
  assert.equal(r.integrityStatus, "PASS");
  assert.equal(r.calibrationReadiness, "NOT_READY");
  assert.ok(r.warnings.includes("CALIBRATION_SAMPLE_TOO_SMALL"));
});
