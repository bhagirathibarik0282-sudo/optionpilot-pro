import test from "node:test";
import assert from "node:assert/strict";
import { buildHawkEyeZBridgeReport, type HawkEyeImpactCalibration } from "../hawk-eye-z-bridge-v1.ts";
import type { HawkEyeLiveObservationReport, HawkEyeRawFeature } from "../hawk-eye-live-observation-adapter-v1.ts";
import type { HawkEyeBaselineSample, HawkEyeBaselineStoreResult } from "../hawk-eye-baseline-store-v1.ts";

const T = 2_000_000;

function feature(family: HawkEyeRawFeature["family"], name: string, raw: number): HawkEyeRawFeature {
  return {
    family,
    entity: name.split("_")[0],
    feature: name,
    metric: "RETURN_PCT",
    windowMinutes: 3,
    raw,
    observedAtMs: T,
    sourceCurrentAtMs: T,
    sourceAnchorAtMs: T - 180_000,
  };
}

function source(features: HawkEyeRawFeature[]): HawkEyeLiveObservationReport {
  return {
    version: "HAWK_EYE_LIVE_OBSERVATION_ADAPTER_V1",
    mode: "SHADOW_OBSERVATION_ONLY",
    affectsSelector: false,
    affectsExecution: false,
    createsOrders: false,
    asOfMs: T,
    features,
    diagnostics: [],
  };
}

const ready = async (_sample: HawkEyeBaselineSample): Promise<HawkEyeBaselineStoreResult> => ({
  baseline: { mean: 0, sd: 1, sampleCount: 60 },
  sampleCount: 60,
  persisted: true,
  reason: "READY",
  historyLimit: 240,
});

test("bridges aligned calibrated families into NIFTY buyer rating without selector impact", async () => {
  const features = [
    feature("SISTERS", "FINNIFTY_RETURN_3M", 3),
    feature("HEAVYWEIGHTS", "HDFCBANK_RETURN_3M", 2.8),
    feature("SECTORS", "NIFTY_FIN_SERVICE_RETURN_3M", 2.7),
  ];
  const calibrations: HawkEyeImpactCalibration[] = features.map((x) => ({
    family: x.family,
    feature: x.feature,
    impact: { NIFTY: 1 },
  }));

  const report = await buildHawkEyeZBridgeReport(source(features), calibrations, { loadBaseline: ready });
  assert.equal(report.mode, "SHADOW_CALIBRATION_ONLY");
  assert.equal(report.affectsSelector, false);
  assert.equal(report.affectsExecution, false);
  assert.equal(report.createsOrders, false);
  assert.equal(report.targets.NIFTY.rating.state, "BULLISH_INTERNAL_PRESSURE");
  assert.ok(report.targets.NIFTY.rating.buyerStars >= 4.5);
  assert.equal(report.targets.NIFTY.calibratedFeatureCount, 3);
  assert.equal(report.targets.BANKNIFTY.calibratedFeatureCount, 0);
  assert.equal(report.targets.BANKNIFTY.rating.state, "BASELINE_NOT_READY");
});

test("target-specific calibrated impacts produce target-specific direction", async () => {
  const f = feature("HEAVYWEIGHTS", "HDFCBANK_RETURN_3M", 3);
  const report = await buildHawkEyeZBridgeReport(source([f]), [{
    family: f.family,
    feature: f.feature,
    impact: { NIFTY: 1, BANKNIFTY: 0.5, SENSEX: -1 },
  }], { loadBaseline: ready });

  assert.equal(report.targets.NIFTY.rating.state, "BULLISH_INTERNAL_PRESSURE");
  assert.equal(report.targets.BANKNIFTY.rating.state, "BULLISH_INTERNAL_PRESSURE");
  assert.equal(report.targets.SENSEX.rating.state, "BEARISH_INTERNAL_PRESSURE");
  assert.ok((report.targets.NIFTY.rating.directionalZ ?? 0) > (report.targets.BANKNIFTY.rating.directionalZ ?? 0));
});

test("uncalibrated feature can build history but cannot influence any rating", async () => {
  const f = feature("SECTORS", "NIFTY_IT_RETURN_3M", 4);
  const report = await buildHawkEyeZBridgeReport(source([f]), [], { loadBaseline: ready });

  for (const target of ["NIFTY", "BANKNIFTY", "SENSEX"] as const) {
    assert.equal(report.targets[target].baselineReadyCount, 1);
    assert.equal(report.targets[target].calibratedFeatureCount, 0);
    assert.equal(report.targets[target].rating.state, "BASELINE_NOT_READY");
    assert.equal(report.targets[target].rating.buyerStars, 0);
    assert.equal(report.targets[target].rating.sellerStars, 0);
  }
});

test("baseline loader failure fails closed instead of using synthetic baseline", async () => {
  const f = feature("SISTERS", "FINNIFTY_RETURN_3M", 3);
  const report = await buildHawkEyeZBridgeReport(source([f]), [{
    family: f.family,
    feature: f.feature,
    impact: { NIFTY: 1 },
  }], {
    loadBaseline: async () => { throw new Error("db down"); },
  });

  assert.equal(report.targets.NIFTY.rating.state, "BASELINE_NOT_READY");
  assert.equal(report.targets.NIFTY.baselineReadyCount, 0);
  assert.equal(report.targets.NIFTY.baselineReasons.DB_READ_FAILED, 1);
});

test("baseline samples are target isolated and preserve exact market feature timestamp", async () => {
  const seen: HawkEyeBaselineSample[] = [];
  const f = feature("HEAVYWEIGHTS", "RELIANCE_RETURN_3M", 1.25);
  await buildHawkEyeZBridgeReport(source([f]), [], {
    loadBaseline: async (sample) => {
      seen.push(sample);
      return ready(sample);
    },
  });

  assert.deepEqual(seen.map((x) => x.target), ["NIFTY", "BANKNIFTY", "SENSEX"]);
  assert.ok(seen.every((x) => x.observedAtMs === T));
  assert.ok(seen.every((x) => x.raw === 1.25));
});

test("feature processing is bounded before any future runtime wiring", async () => {
  const features = Array.from({ length: 181 }, (_, i) => feature("SECTORS", `SECTOR_${i}_RETURN_3M`, i / 100));
  let calls = 0;
  const report = await buildHawkEyeZBridgeReport(source(features), [], {
    loadBaseline: async (sample) => {
      calls++;
      return ready(sample);
    },
  });

  assert.equal(report.inputFeatureCount, 181);
  assert.equal(report.processedFeatureCount, 180);
  assert.equal(report.truncated, true);
  assert.equal(calls, 180 * 3);
});
