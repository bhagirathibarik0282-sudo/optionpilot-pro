import test from "node:test";
import assert from "node:assert/strict";
import { runH1Dte0MultidayOos } from "../h1-dte0-multiday-oos-v1.js";

function day(tradeDate: string, delta: number, premiumMove = 9, gamma = 0.005) {
  return {
    tradeDate,
    calibration: {
      ok: true,
      mode: "H1_DTE0_TRANSITION_CALIBRATION_V1" as const,
      productionImpact: "NONE" as const,
      semantics: "HISTORICAL_REPLAY_RESEARCH_ONLY" as const,
      request: { symbol: "NIFTY" as const, tradeDate, fromTime: "14:18", toTime: "14:21", scope: "CORE" as const },
      replayCounts: { market: 2, options: 240, chain: 8, markers: 2, canonical: 2 },
      continuity: null,
      atmDte0PointCount: 2,
      windowCount: 1,
      windows: [{
        side: "PE" as const,
        strike: 23650,
        from: `${tradeDate}T08:48:00.000Z`,
        to: `${tradeDate}T08:51:00.000Z`,
        observed: {
          premiumLtpFrom: 27,
          premiumLtpTo: 30,
          premiumMovePct: premiumMove,
          deltaFrom: -0.45,
          deltaTo: -0.45 - delta,
          absoluteDeltaChange: delta,
          currentGamma: gamma,
          theta: -300,
          thetaPctOfPremium: 1000,
          iv: 29,
          liquidityStatus: "TIGHT",
          validationStatus: "RESEARCH_ELIGIBLE",
        },
        currentPolicy: {
          minPremiumMovePct: 2,
          minAbsoluteDeltaChange: 0.03,
          minCurrentGamma: 0.001,
          maxAbsThetaPctOfPremium: 3,
          minIv: 8,
          maxIv: 30,
          premiumPass: true,
          deltaPass: delta >= 0.03,
          gammaPass: true,
          deltaGammaPass: delta >= 0.03,
          thetaPass: false,
          ivPass: true,
          thetaIvPass: false,
        },
        researchOnly: true,
        thresholdPromoted: false,
      }],
      evidenceState: "OBSERVATIONS_AVAILABLE_NO_THRESHOLD_PROMOTION",
      safety: {
        readOnly: true,
        affectsSelector: false,
        affectsTelegram: false,
        affectsVerdict: false,
        affectsExecution: false,
        brokerCallMade: false,
        placesOrder: false,
        thresholdPromoted: false,
        dte0ThresholdInvented: false,
        failClosed: true,
      },
    },
  };
}

test("DTE0 multiday OOS fails closed with fewer than four usable days", () => {
  const result = runH1Dte0MultidayOos([day("2026-09-01", .021), day("2026-09-08", .023)]);
  assert.equal(result.ok, false);
  assert.equal(result.candidateDeltaP95, null);
  assert.deepEqual(result.blockers, ["INSUFFICIENT_DTE0_DAYS_REQUIRE_4"]);
  assert.equal(result.safety.thresholdPromoted, false);
  assert.equal(result.safety.dte0ThresholdInvented, false);
});

test("DTE0 multiday OOS time-splits calibration and unseen days without promotion", () => {
  const result = runH1Dte0MultidayOos([
    day("2026-08-18", .020),
    day("2026-08-25", .022),
    day("2026-09-01", .024),
    day("2026-09-08", .023),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.calibrationDates.length, 2);
  assert.equal(result.oosDates.length, 2);
  assert.ok((result.candidateDeltaP95 ?? 0) > 0);
  assert.equal(result.safety.affectsSelector, false);
  assert.equal(result.safety.affectsTelegram, false);
  assert.equal(result.safety.affectsExecution, false);
  assert.equal(result.safety.thresholdPromoted, false);
});
