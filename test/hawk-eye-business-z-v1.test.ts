import test from "node:test";
import assert from "node:assert/strict";
import { buildHawkEyeBusinessZReport, type HawkEyeObservation } from "../hawk-eye-business-z-v1.ts";

const baseline = { mean: 0, sd: 1, sampleCount: 60 };

function obs(partial: Partial<HawkEyeObservation> & Pick<HawkEyeObservation, "family" | "feature" | "raw">): HawkEyeObservation {
  return {
    baseline,
    impact: { NIFTY: 1, BANKNIFTY: 1, SENSEX: 1 },
    ...partial,
  };
}

test("Hawk Eye fails closed when persistent-quality baseline is not ready", () => {
  const report = buildHawkEyeBusinessZReport([
    obs({ family: "SISTERS", feature: "FINNIFTY_3M", raw: 3, baseline: { mean: 0, sd: 1, sampleCount: 10 } }),
  ]);
  assert.equal(report.mode, "SHADOW_CALIBRATION_ONLY");
  assert.equal(report.affectsSelector, false);
  assert.equal(report.createsOrders, false);
  assert.equal(report.ratings.NIFTY.state, "BASELINE_NOT_READY");
  assert.equal(report.ratings.NIFTY.buyerStars, 0);
});

test("aligned sister heavyweight and sector pressure creates high buyer rating", () => {
  const report = buildHawkEyeBusinessZReport([
    obs({ family: "SISTERS", feature: "FINNIFTY_3M", raw: 3 }),
    obs({ family: "HEAVYWEIGHTS", feature: "HDFCBANK_3M", raw: 2.8 }),
    obs({ family: "SECTORS", feature: "FIN_SERVICE_BREADTH_3M", raw: 2.7 }),
  ]);
  assert.equal(report.ratings.NIFTY.state, "BULLISH_INTERNAL_PRESSURE");
  assert.equal(report.ratings.NIFTY.readyFamilies, 3);
  assert.equal(report.ratings.NIFTY.confidencePct, 100);
  assert.ok(report.ratings.NIFTY.buyerStars >= 4.5);
  assert.equal(report.ratings.NIFTY.sellerStars, 0);
});

test("opposing family evidence reduces confidence instead of emitting conflict state", () => {
  const report = buildHawkEyeBusinessZReport([
    obs({ family: "SISTERS", feature: "FINNIFTY_3M", raw: 3 }),
    obs({ family: "HEAVYWEIGHTS", feature: "RELIANCE_3M", raw: 2.5 }),
    obs({ family: "SECTORS", feature: "IT_BREADTH_3M", raw: -3 }),
  ]);
  assert.equal(report.ratings.NIFTY.state, "BULLISH_INTERNAL_PRESSURE");
  assert.ok(report.ratings.NIFTY.confidencePct < 100);
  assert.ok(report.ratings.NIFTY.buyerStars < 4.5);
  assert.ok(!report.ratings.NIFTY.state.includes("CONFLICT"));
});

test("target-specific impact coefficients produce different index effects", () => {
  const report = buildHawkEyeBusinessZReport([
    obs({
      family: "HEAVYWEIGHTS",
      feature: "HDFCBANK_3M",
      raw: 3,
      impact: { NIFTY: 0.55, BANKNIFTY: 1, SENSEX: 0.60 },
    }),
  ]);
  assert.ok((report.ratings.BANKNIFTY.directionalZ ?? 0) > (report.ratings.NIFTY.directionalZ ?? 0));
  assert.ok((report.ratings.BANKNIFTY.directionalZ ?? 0) > (report.ratings.SENSEX.directionalZ ?? 0));
});

test("many correlated rows inside one family do not inflate score by row count", () => {
  const one = buildHawkEyeBusinessZReport([
    obs({ family: "HEAVYWEIGHTS", feature: "A", raw: 2 }),
  ]);
  const many = buildHawkEyeBusinessZReport([
    obs({ family: "HEAVYWEIGHTS", feature: "A", raw: 2 }),
    obs({ family: "HEAVYWEIGHTS", feature: "B", raw: 2 }),
    obs({ family: "HEAVYWEIGHTS", feature: "C", raw: 2 }),
    obs({ family: "HEAVYWEIGHTS", feature: "D", raw: 2 }),
  ]);
  assert.equal(one.families.find((x) => x.family === "HEAVYWEIGHTS")?.targetScore.NIFTY,
    many.families.find((x) => x.family === "HEAVYWEIGHTS")?.targetScore.NIFTY);
});

test("extreme outliers are capped before impact fusion", () => {
  const report = buildHawkEyeBusinessZReport([
    obs({ family: "SISTERS", feature: "OUTLIER", raw: 100 }),
  ]);
  const feature = report.features[0];
  assert.equal(feature.z, 4);
  assert.equal(feature.targetContribution.NIFTY, 4);
});
