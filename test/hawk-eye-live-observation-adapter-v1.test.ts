import test from "node:test";
import assert from "node:assert/strict";
import { buildHawkEyeLiveObservationReport } from "../hawk-eye-live-observation-adapter-v1.ts";

const T = 1_800_000;
const m = (n: number) => n * 60_000;

test("builds 3m 6m 15m return features from historical-only points", () => {
  const report = buildHawkEyeLiveObservationReport([
    {
      family: "SISTERS",
      entity: "FINNIFTY",
      points: [
        { observedAtMs: T - m(15), price: 100, volume: 1000 },
        { observedAtMs: T - m(6), price: 102, volume: 1600 },
        { observedAtMs: T - m(3), price: 103, volume: 1900 },
        { observedAtMs: T, price: 104, volume: 2200 },
      ],
    },
  ], T);
  const returns = report.features.filter((x) => x.metric === "RETURN_PCT");
  assert.deepEqual(returns.map((x) => x.windowMinutes), [3, 6, 15]);
  assert.ok(Math.abs((returns.find((x) => x.windowMinutes === 15)?.raw ?? 0) - 4) < 1e-9);
  assert.equal(report.mode, "SHADOW_OBSERVATION_ONLY");
  assert.equal(report.affectsSelector, false);
  assert.equal(report.createsOrders, false);
});

test("future points are ignored and cannot leak into current features", () => {
  const report = buildHawkEyeLiveObservationReport([
    {
      family: "HEAVYWEIGHTS",
      entity: "HDFCBANK",
      points: [
        { observedAtMs: T - m(3), price: 100 },
        { observedAtMs: T, price: 101 },
        { observedAtMs: T + m(1), price: 999 },
      ],
    },
  ], T);
  const feature = report.features.find((x) => x.feature === "HDFCBANK_RETURN_3M");
  assert.ok(feature);
  assert.ok(Math.abs((feature?.raw ?? 0) - 1) < 1e-9);
  assert.equal(feature?.sourceCurrentAtMs, T);
});

test("window is anchored to latest market timestamp rather than request time", () => {
  const latest = T - m(1);
  const report = buildHawkEyeLiveObservationReport([
    {
      family: "SISTERS",
      entity: "FINNIFTY",
      points: [
        { observedAtMs: latest - m(3), price: 100 },
        { observedAtMs: latest, price: 103 },
      ],
    },
  ], T, { maxLatestAgeMs: m(2) });
  const feature = report.features.find((x) => x.feature === "FINNIFTY_RETURN_3M");
  assert.ok(feature);
  assert.ok(Math.abs((feature?.raw ?? 0) - 3) < 1e-9);
  assert.equal(feature?.observedAtMs, latest);
  assert.equal(feature?.sourceAnchorAtMs, latest - m(3));
});

test("stale latest observation fails closed", () => {
  const report = buildHawkEyeLiveObservationReport([
    {
      family: "SECTORS",
      entity: "NIFTY IT",
      points: [
        { observedAtMs: T - m(10), price: 100 },
        { observedAtMs: T - m(8), price: 101 },
      ],
    },
  ], T, { maxLatestAgeMs: m(2) });
  assert.equal(report.features.length, 0);
  assert.equal(report.diagnostics[0].reason, "STALE_LATEST");
});

test("missing anchors do not become synthetic zero returns", () => {
  const report = buildHawkEyeLiveObservationReport([
    {
      family: "SISTERS",
      entity: "NIFTY AUTO",
      points: [
        { observedAtMs: T - m(1), price: 100 },
        { observedAtMs: T, price: 101 },
      ],
    },
  ], T);
  assert.equal(report.features.length, 0);
  assert.equal(report.diagnostics[0].reason, "NO_WINDOW_ANCHOR");
  assert.deepEqual(report.diagnostics[0].skippedWindows, [3, 6, 15]);
});

test("null price is invalid rather than coerced to zero", () => {
  const report = buildHawkEyeLiveObservationReport([
    {
      family: "HEAVYWEIGHTS",
      entity: "RELIANCE",
      points: [
        { observedAtMs: T - m(3), price: null },
        { observedAtMs: T, price: 100 },
      ],
    },
  ], T);
  assert.equal(report.features.length, 0);
});

test("volume reset is omitted instead of interpreted as negative participation", () => {
  const report = buildHawkEyeLiveObservationReport([
    {
      family: "HEAVYWEIGHTS",
      entity: "ICICIBANK",
      points: [
        { observedAtMs: T - m(3), price: 100, volume: 5000 },
        { observedAtMs: T, price: 101, volume: 100 },
      ],
    },
  ], T);
  assert.ok(report.features.some((x) => x.metric === "RETURN_PCT"));
  assert.equal(report.features.some((x) => x.metric === "VOLUME_RATE"), false);
});

test("adapter is configuration-driven and accepts arbitrary entity names", () => {
  const report = buildHawkEyeLiveObservationReport([
    {
      family: "SECTORS",
      entity: "future-new-sector",
      points: [
        { observedAtMs: T - m(3), price: 100 },
        { observedAtMs: T, price: 102 },
      ],
    },
  ], T);
  assert.equal(report.features[0].entity, "FUTURE-NEW-SECTOR");
  assert.equal(report.features[0].feature, "FUTURE-NEW-SECTOR_RETURN_3M");
});
