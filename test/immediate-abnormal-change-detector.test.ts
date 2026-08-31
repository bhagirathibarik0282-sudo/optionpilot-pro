import test from "node:test";
import assert from "node:assert/strict";
import { ImmediateAbnormalChangeDetector, type ImmediateMetricSample } from "../immediate-abnormal-change-detector.js";

function sample(id: string, value: number, effectWhenRising: "FAVOURS_CE" | "FAVOURS_PE" | "VOLATILITY_ONLY" | "NEUTRAL" = "FAVOURS_CE"): ImmediateMetricSample {
  return {
    id,
    family: "PCR",
    occurredAt: `2026-08-31T10:00:${id.padStart(2, "0")}.000Z`,
    value,
    source: "TEST",
    effectWhenRising,
    effectWhenFalling: effectWhenRising === "FAVOURS_CE" ? "FAVOURS_PE" : "NEUTRAL",
    factLabel: "PCR",
  };
}

test("does not fire before adaptive baseline exists", () => {
  const d = new ImmediateAbnormalChangeDetector({ minSamples: 4, robustZThreshold: 3, minRelativeMove: 0 });
  for (let i = 1; i <= 4; i++) {
    const r = d.observe(sample(String(i), 1 + i * 0.01), "CE");
    assert.equal(r.abnormal, false);
  }
});

test("fires on statistically abnormal immediate expansion and aligns to CE trend", () => {
  const d = new ImmediateAbnormalChangeDetector({ minSamples: 4, robustZThreshold: 3, minRelativeMove: 0 });
  [1.00, 1.01, 1.02, 1.03, 1.04].forEach((v, i) => d.observe(sample(String(i + 1), v), "CE"));
  const r = d.observe(sample("6", 1.30), "CE");
  assert.equal(r.abnormal, true);
  assert.equal(r.event?.alignment, "FAVOURS_TREND");
  assert.equal(r.direction, "RISING");
});

test("same rise conflicts with PE locked trend", () => {
  const d = new ImmediateAbnormalChangeDetector({ minSamples: 4, robustZThreshold: 3, minRelativeMove: 0 });
  [1.00, 1.01, 1.02, 1.03, 1.04].forEach((v, i) => d.observe(sample(String(i + 1), v), "PE"));
  const r = d.observe(sample("6", 1.30), "PE");
  assert.equal(r.event?.alignment, "CONFLICTS_TREND");
});

test("VIX/IV style effect remains volatility-only", () => {
  const d = new ImmediateAbnormalChangeDetector({ minSamples: 4, robustZThreshold: 3, minRelativeMove: 0 });
  [10, 10.1, 10.2, 10.3, 10.4].forEach((v, i) => d.observe(sample(String(i + 1), v, "VOLATILITY_ONLY"), "CE"));
  const r = d.observe(sample("6", 14, "VOLATILITY_ONLY"), "CE");
  assert.equal(r.event?.alignment, "VOLATILITY_ONLY");
});

test("rejects malformed metric samples", () => {
  const d = new ImmediateAbnormalChangeDetector();
  assert.throws(() => d.observe({ ...sample("1", 1), value: Number.NaN }, "CE"), /INVALID_IMMEDIATE_METRIC_SAMPLE/);
});
