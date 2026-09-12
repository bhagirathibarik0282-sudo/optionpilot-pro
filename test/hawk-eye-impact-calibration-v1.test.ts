import test from "node:test";
import assert from "node:assert/strict";
import {
  calibrateHawkEyeImpactsV1,
  type HawkEyeHistoricalFeaturePoint,
  type HawkEyeTargetPricePoint,
} from "../hawk-eye-impact-calibration-v1.ts";

const BASE = 10_000_000;
const STEP_MS = 10 * 60_000;
const HORIZON_MS = 3 * 60_000;

function featureRows(count = 80, includeNulls = false): HawkEyeHistoricalFeaturePoint[] {
  const rows: HawkEyeHistoricalFeaturePoint[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      family: "HEAVYWEIGHTS",
      feature: "HDFCBANK_RETURN_3M",
      observedAtMs: BASE + (i * STEP_MS),
      raw: i - (count / 2),
    });
    if (includeNulls) {
      rows.push({
        family: "HEAVYWEIGHTS",
        feature: "HDFCBANK_RETURN_3M",
        observedAtMs: BASE + (i * STEP_MS) + 1,
        raw: null,
      });
    }
  }
  return rows;
}

function targetRows(
  target: "NIFTY" | "BANKNIFTY" | "SENSEX",
  count = 80,
  relation: (i: number, x: number) => number = (_i, x) => x,
): HawkEyeTargetPricePoint[] {
  const rows: HawkEyeTargetPricePoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = BASE + (i * STEP_MS);
    const x = i - (count / 2);
    const start = 10_000;
    const forwardReturnPct = relation(i, x) * 0.05;
    rows.push({ target, observedAtMs: t, price: start });
    rows.push({ target, observedAtMs: t + HORIZON_MS, price: start * (1 + (forwardReturnPct / 100)) });
  }
  return rows;
}

const strict3m = {
  horizonsMinutes: [3],
  maxStartLagMs: 0,
  maxFutureLagMs: 0,
};

test("chronological train/validation/test accepts stable positive and negative empirical impacts", () => {
  const features = featureRows();
  const targets = [
    ...targetRows("NIFTY", 80, (_i, x) => x),
    ...targetRows("SENSEX", 80, (_i, x) => -x),
  ];
  const report = calibrateHawkEyeImpactsV1(features, targets, strict3m);

  assert.equal(report.mode, "HISTORICAL_RESEARCH_ONLY");
  assert.equal(report.noLookahead, true);
  assert.equal(report.usesRandomSplit, false);
  assert.equal(report.nonOverlappingOutcomes, true);
  assert.equal(report.causalClaim, false);
  assert.equal(report.affectsSelector, false);
  assert.equal(report.affectsExecution, false);
  assert.equal(report.affectsTelegram, false);
  assert.equal(report.createsOrders, false);

  assert.equal(report.calibrations.length, 1);
  const calibration = report.calibrations[0];
  assert.equal(calibration.family, "HEAVYWEIGHTS");
  assert.equal(calibration.feature, "HDFCBANK_RETURN_3M");
  assert.ok((calibration.impact.NIFTY ?? 0) > 0.99);
  assert.ok((calibration.impact.SENSEX ?? 0) < -0.99);
  assert.equal(calibration.impact.BANKNIFTY, undefined);

  const nifty = report.evaluations.find((row) => row.target === "NIFTY" && row.selectedByValidation);
  assert.equal(nifty?.acceptedOutOfSample, true);
  assert.equal(nifty?.reason, "ACCEPTED");
  assert.equal(nifty?.trainSampleCount, 40);
  assert.equal(nifty?.validationSampleCount, 20);
  assert.equal(nifty?.testSampleCount, 20);
});

test("validation may select a horizon but opposite test sign rejects it out of sample", () => {
  const features = featureRows();
  const targets = targetRows("NIFTY", 80, (i, x) => i < 60 ? x : -x);
  const report = calibrateHawkEyeImpactsV1(features, targets, strict3m);

  const selected = report.evaluations.find((row) => row.target === "NIFTY" && row.selectedByValidation);
  assert.equal(selected?.trainValidationStable, true);
  assert.equal(selected?.selectedByValidation, true);
  assert.equal(selected?.acceptedOutOfSample, false);
  assert.equal(selected?.reason, "TEST_SIGN_OR_STRENGTH_FAILED");
  assert.equal(report.calibrations.length, 0);
});

test("same-time or past target prices cannot masquerade as future outcome", () => {
  const features = featureRows();
  const targets: HawkEyeTargetPricePoint[] = featureRows().map((row) => ({
    target: "NIFTY",
    observedAtMs: row.observedAtMs,
    price: 10_000,
  }));
  const report = calibrateHawkEyeImpactsV1(features, targets, strict3m);

  const eval3m = report.evaluations.find((row) => row.target === "NIFTY");
  assert.equal(eval3m?.alignedSampleCount, 0);
  assert.equal(eval3m?.reason, "INSUFFICIENT_ALIGNED_SAMPLES");
  assert.equal(report.calibrations.length, 0);
});

test("missing feature values are ignored, never converted to zero", () => {
  const features = featureRows(80, true);
  const targets = targetRows("NIFTY");
  const report = calibrateHawkEyeImpactsV1(features, targets, strict3m);

  assert.equal(report.featurePointCount, 80);
  const selected = report.evaluations.find((row) => row.target === "NIFTY" && row.selectedByValidation);
  assert.equal(selected?.alignedSampleCount, 80);
  assert.equal(selected?.acceptedOutOfSample, true);
});

test("insufficient history fails closed without creating an impact coefficient", () => {
  const features = featureRows(40);
  const targets = targetRows("NIFTY", 40);
  const report = calibrateHawkEyeImpactsV1(features, targets, strict3m);

  const eval3m = report.evaluations.find((row) => row.target === "NIFTY");
  assert.equal(eval3m?.alignedSampleCount, 40);
  assert.equal(eval3m?.reason, "INSUFFICIENT_ALIGNED_SAMPLES");
  assert.equal(report.acceptedTargetFeatureCount, 0);
  assert.deepEqual(report.calibrations, []);
});

test("BANKNIFTY may be calibrated for context but remains candidate-ineligible", () => {
  const report = calibrateHawkEyeImpactsV1(featureRows(), targetRows("BANKNIFTY"), strict3m);

  assert.equal(report.targetPolicy.BANKNIFTY.contextOnly, true);
  assert.equal(report.targetPolicy.BANKNIFTY.candidateEligible, false);
  assert.equal(report.targetPolicy.NIFTY.candidateEligible, true);
  assert.equal(report.targetPolicy.SENSEX.candidateEligible, true);
  assert.ok((report.calibrations[0]?.impact.BANKNIFTY ?? 0) > 0.99);
});

test("non-overlap gate reduces overlapping forward-return observations", () => {
  const count = 90;
  const features: HawkEyeHistoricalFeaturePoint[] = [];
  const targets: HawkEyeTargetPricePoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = BASE + (i * 60_000);
    features.push({ family: "SISTERS", feature: "FINNIFTY_RETURN_3M", observedAtMs: t, raw: i });
    targets.push({ target: "NIFTY", observedAtMs: t, price: 10_000 + i });
  }

  const report = calibrateHawkEyeImpactsV1(features, targets, {
    horizonsMinutes: [3],
    maxStartLagMs: 0,
    maxFutureLagMs: 0,
    minTrainSamples: 3,
    minValidationSamples: 3,
    minTestSamples: 3,
    minAbsCorrelation: 0,
  });
  const eval3m = report.evaluations.find((row) => row.target === "NIFTY");
  assert.ok((eval3m?.alignedSampleCount ?? 999) <= 30);
  assert.equal(report.nonOverlappingOutcomes, true);
});


import { calibrateHawkEyeImpactsV1 as calibrate } from '../hawk-eye-impact-calibration-v1.ts';

const base = Date.UTC(2026, 8, 1, 4);
const minute = 60_000;
const feature = (i: number, step = 10) => ({ family: 'HEAVYWEIGHTS' as const, feature: 'X', observedAtMs: base + i * step * minute, raw: i });
const quote = (time: number, price: number) => ({ target: 'NIFTY' as const, observedAtMs: time, price });

test('past-only movement cannot become a forward predictive relationship', () => {
  const features = Array.from({length: 80}, (_, i) => feature(i));
  const prices = features.flatMap((f, i) => [quote(f.observedAtMs - minute, 100), quote(f.observedAtMs + 3 * minute, 100 + i)]);
  const r = calibrate(features, prices, {horizonsMinutes: [3]});
  assert.equal(r.acceptedTargetFeatureCount, 0);
  assert.equal(r.evaluations[0].alignedSampleCount, 0);
});

test('actual delayed outcome intervals cannot overlap', () => {
  const features = Array.from({length: 80}, (_, i) => feature(i, 3));
  const prices = features.map((f, i) => quote(f.observedAtMs + minute, 100 + i));
  const r = calibrate(features, prices, {horizonsMinutes: [3]});
  assert.ok(r.evaluations[0].alignedSampleCount <= 40);
});

test('test strength cannot tune an accepted impact coefficient', () => {
  const features = Array.from({length: 80}, (_, i) => feature(i));
  const prices = (shuffle: boolean) => features.flatMap((f, i) => {
    const value = shuffle && i >= 60 ? i + ((i % 2) ? -1 : 1) : i;
    return [quote(f.observedAtMs, 100), quote(f.observedAtMs + 3 * minute, 100 + value)];
  });
  const options = {horizonsMinutes: [3], maxStartLagMs: 0, maxFutureLagMs: 0};
  const a = calibrate(features, prices(false), options);
  const b = calibrate(features, prices(true), options);
  assert.equal(a.acceptedTargetFeatureCount, 1);
  assert.equal(b.acceptedTargetFeatureCount, 1);
  assert.deepEqual(a.calibrations, b.calibrations);
});

test('outcomes crossing shared split boundaries are purged even with overlapping research enabled', () => {
  const features = Array.from({length: 80}, (_, i) => feature(i, 3));
  const prices = features.map((f, i) => quote(f.observedAtMs + minute, 100 + i));
  const r = calibrate(features, prices, {horizonsMinutes: [3, 6], nonOverlappingOutcomes: false});
  const rows = r.evaluations.filter(row => row.target === 'NIFTY');
  assert.equal(rows[0].trainSampleCount, 39);
  assert.equal(rows[0].validationSampleCount, 19);
  assert.equal(rows[1].trainSampleCount, 38);
  assert.equal(rows[1].validationSampleCount, 18);
});
