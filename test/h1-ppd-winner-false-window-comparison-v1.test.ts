import test from "node:test";
import assert from "node:assert/strict";
import { buildPpdWinnerFalseWindowComparison, type PpdBusinessWindow } from "../h1-ppd-winner-false-window-comparison-v1.js";

function w(partial: Partial<PpdBusinessWindow>): PpdBusinessWindow {
  return {
    tradeDate: "2026-09-07",
    to: "2026-09-07T03:51:00.000Z",
    windowMinutes: 6,
    dte: 1,
    expiry: "2026-09-08",
    strike: 23850,
    side: "PE",
    label: "WINNER",
    expansionStrengthPct: 17.9,
    oppositeCollapseStrengthPct: 14.7,
    netPpdSeparationPp: 32.6,
    ppdRatePpPerMinute: -5.4333333333,
    multiDteAlignment: "ALL_PE",
    crossDteConflict: false,
    outcomePct: 54.9,
    ...partial,
  };
}

test("compares winner and non-winner PPD descriptively without promoting a threshold", () => {
  const result = buildPpdWinnerFalseWindowComparison([
    w({ label: "WINNER" }),
    w({ tradeDate: "2026-09-08", label: "REVERSAL_TRAP", expansionStrengthPct: 30.2, oppositeCollapseStrengthPct: 25.2, netPpdSeparationPp: 55.4, ppdRatePpPerMinute: 18.46, multiDteAlignment: "MIXED", crossDteConflict: true, outcomePct: -17.0 }),
    w({ tradeDate: "2026-09-01", label: "FALSE", expansionStrengthPct: 4, oppositeCollapseStrengthPct: 1, netPpdSeparationPp: 5, ppdRatePpPerMinute: 0.83, multiDteAlignment: "NO_CONTROL", crossDteConflict: false, outcomePct: -8 }),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.byLabel.WINNER.count, 1);
  assert.equal(result.byLabel.REVERSAL_TRAP.count, 1);
  assert.equal(result.winnerVsNonWinner.nonWinners.count, 2);
  assert.equal(result.interpretation.thresholdPromoted, false);
  assert.equal(result.interpretation.ppdIsEvidenceNotStandaloneTrigger, true);
  assert.equal(result.safety.affectsSelector, false);
  assert.equal(result.safety.affectsExecution, false);
});

test("keeps a huge PPD reversal trap separate from winners", () => {
  const result = buildPpdWinnerFalseWindowComparison([
    w({ label: "WINNER", netPpdSeparationPp: 32.6 }),
    w({ label: "REVERSAL_TRAP", netPpdSeparationPp: 55.4, expansionStrengthPct: 30.2, oppositeCollapseStrengthPct: 25.2, crossDteConflict: true, outcomePct: -17 }),
  ]);
  assert.equal(result.byLabel.WINNER.netPpdSeparationPp.median, 32.6);
  assert.equal(result.byLabel.REVERSAL_TRAP.netPpdSeparationPp.median, 55.4);
  assert.equal(result.interpretation.thresholdPromoted, false);
});

test("invalid numeric rows are excluded fail-closed", () => {
  const bad = w({ expansionStrengthPct: Number.NaN });
  const result = buildPpdWinnerFalseWindowComparison([bad]);
  assert.equal(result.ok, false);
  assert.equal(result.validCount, 0);
  assert.equal(result.invalidCount, 1);
});
