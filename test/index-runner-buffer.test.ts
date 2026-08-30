import assert from "node:assert/strict";
import test from "node:test";
import { calculateIndexRunnerBuffer } from "../index-runner-buffer.js";

const base = {
  currentPremium: 120,
  premiumAtr: 6,
  realisedVolatilityPct: 18,
  relativeSpreadPct: 0.8,
  dte: 2,
  iv: 16,
  recentWhipsawRate: 0.25,
  structuralBuffer: 5,
  maxAllowedBuffer: 14,
  quantumFeatures: [0.8, 0.7, 0.75, 0.82],
};

test("NIFTY buffer is valid and capped", () => {
  const r = calculateIndexRunnerBuffer({ ...base, index: "NIFTY" });
  assert.equal(r.valid, true);
  assert.ok((r.bufferPoints ?? 0) >= base.structuralBuffer);
  assert.ok((r.bufferPoints ?? Infinity) <= base.maxAllowedBuffer);
});

test("SENSEX uses a distinct profile from NIFTY", () => {
  const n = calculateIndexRunnerBuffer({ ...base, index: "NIFTY" });
  const s = calculateIndexRunnerBuffer({ ...base, index: "SENSEX" });
  assert.equal(n.valid, true);
  assert.equal(s.valid, true);
  assert.notEqual(n.bufferPoints, s.bufferPoints);
});

test("BANKNIFTY higher DTE contributes independently", () => {
  const low = calculateIndexRunnerBuffer({ ...base, index: "BANKNIFTY", dte: 10 });
  const high = calculateIndexRunnerBuffer({ ...base, index: "BANKNIFTY", dte: 30 });
  assert.ok((high.dteBuffer ?? 0) > (low.dteBuffer ?? 0));
});

test("higher whipsaw rate widens only within hard cap", () => {
  const a = calculateIndexRunnerBuffer({ ...base, index: "NIFTY", recentWhipsawRate: 0.1 });
  const b = calculateIndexRunnerBuffer({ ...base, index: "NIFTY", recentWhipsawRate: 0.9 });
  assert.ok((b.bufferPoints ?? 0) >= (a.bufferPoints ?? 0));
  assert.ok((b.bufferPoints ?? Infinity) <= base.maxAllowedBuffer);
});

test("invalid market state fails closed", () => {
  const r = calculateIndexRunnerBuffer({ ...base, index: "NIFTY", premiumAtr: 0 });
  assert.equal(r.valid, false);
  assert.equal(r.bufferPoints, null);
});

test("structural buffer cannot exceed hard max", () => {
  const r = calculateIndexRunnerBuffer({ ...base, index: "SENSEX", structuralBuffer: 15, maxAllowedBuffer: 14 });
  assert.equal(r.valid, false);
  assert.ok(r.reasonCodes.includes("INVALID_BUFFER_LIMITS"));
});

test("quantum uncertainty never breaches deterministic max", () => {
  const r = calculateIndexRunnerBuffer({ ...base, index: "SENSEX", quantumFeatures: [1, 0.01, 0.01, 0.01] });
  assert.equal(r.valid, true);
  assert.ok((r.bufferPoints ?? Infinity) <= base.maxAllowedBuffer);
});

test("missing quantum vector fails closed", () => {
  const r = calculateIndexRunnerBuffer({ ...base, index: "BANKNIFTY", quantumFeatures: [1] });
  assert.equal(r.valid, false);
});
