import test from "node:test";
import assert from "node:assert/strict";
import { deriveHistoricalCandidateQuality } from "../h1-candidate-quality.js";

const tf = (direction: "UP" | "DOWN") => ({ direction } as any);
const fusion = (state: string) => ({ state } as any);

test("full alignment does not bypass overextension", () => {
  const result = deriveHistoricalCandidateQuality({
    scalp: tf("UP"), intraday: tf("UP"), swing: tf("UP"),
    fusion: fusion("SUPPORTIVE"), evidenceCompletenessPct: 95,
    liquidityAcceptable: true, overextended: true,
  });
  assert.equal(result.alignment, "FULL");
  assert.equal(result.grade, "REJECT");
});

test("conflicting horizons reject historical candidate quality", () => {
  const result = deriveHistoricalCandidateQuality({
    scalp: tf("UP"), intraday: tf("DOWN"), swing: tf("UP"),
    fusion: fusion("SUPPORTIVE"), evidenceCompletenessPct: 90,
    liquidityAcceptable: true,
  });
  assert.equal(result.alignment, "CONFLICT");
  assert.equal(result.grade, "REJECT");
});

test("A+ requires full alignment plus supportive fusion quality", () => {
  const result = deriveHistoricalCandidateQuality({
    scalp: tf("DOWN"), intraday: tf("DOWN"), swing: tf("DOWN"),
    fusion: fusion("SUPPORTIVE"), evidenceCompletenessPct: 90,
    liquidityAcceptable: true,
  });
  assert.equal(result.grade, "A_PLUS");
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
});
