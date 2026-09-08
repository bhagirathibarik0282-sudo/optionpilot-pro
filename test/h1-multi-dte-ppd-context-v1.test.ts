import test from "node:test";
import assert from "node:assert/strict";
import { calculatePremiumPairDivergence, type PpdQuote } from "../h1-premium-pair-divergence-v1.js";
import { buildMultiDtePpdContext } from "../h1-multi-dte-ppd-context-v1.js";

function q(timestamp: string, expiry: string, side: "CE" | "PE", price: number): PpdQuote {
  return {
    timestamp,
    indexSymbol: "NIFTY",
    expiry,
    strike: 23850,
    side,
    price,
    priceSource: "LTP_REPLAY",
  };
}

function ppd(expiry: string, ceFrom: number, ceTo: number, peFrom: number, peTo: number) {
  return calculatePremiumPairDivergence({
    ceFrom: q("2026-09-07T03:45:00.000Z", expiry, "CE", ceFrom),
    ceTo: q("2026-09-07T03:51:00.000Z", expiry, "CE", ceTo),
    peFrom: q("2026-09-07T03:45:00.000Z", expiry, "PE", peFrom),
    peTo: q("2026-09-07T03:51:00.000Z", expiry, "PE", peTo),
  });
}

test("multi-DTE context reports aligned PE control without inventing a common threshold", () => {
  const result = buildMultiDtePpdContext([
    { dte: 1, result: ppd("2026-09-08", 87.55, 74.70, 58.15, 68.55) },
    { dte: 8, result: ppd("2026-09-15", 150, 143, 132, 141) },
    { dte: 22, result: ppd("2026-09-29", 300, 292, 270, 279) },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.alignment, "ALL_PE");
  assert.equal(result.primaryControllingSide, "PE");
  assert.equal(result.crossDteConflict, false);
  assert.equal(result.interpretation.sameFormulaAcrossDte, true);
  assert.equal(result.interpretation.sameThresholdAcrossDte, false);
  assert.equal(result.interpretation.thresholdPromoted, false);
  assert.equal(result.safety.affectsSelector, false);
  assert.equal(result.safety.affectsExecution, false);
});

test("multi-DTE context exposes conflict instead of averaging it away", () => {
  const result = buildMultiDtePpdContext([
    { dte: 0, result: ppd("2026-09-08", 46.4, 60.4, 47.4, 35.45) },
    { dte: 7, result: ppd("2026-09-15", 100, 94, 90, 99) },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.alignment, "MIXED");
  assert.equal(result.crossDteConflict, true);
  assert.equal(result.opposingExpiries.length, 1);
});

test("one valid expiry is marked insufficient for multi-DTE inference", () => {
  const result = buildMultiDtePpdContext([
    { dte: 1, result: ppd("2026-09-08", 87.55, 74.70, 58.15, 68.55) },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.alignment, "INSUFFICIENT");
});
