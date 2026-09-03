import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLivePremiumDeltaGamma } from "../h1-live-premium-delta-gamma-evaluator.js";

const policy = { maxObservationGapMs: 180000, minPremiumMovePct: 2, minAbsoluteDeltaChange: 0.03, minCurrentGamma: 0.001 };
const prev = { symbol: "NIFTY", expiry: "2026-09-08", strike: 24000, side: "CE" as const, observedAt: "2026-09-03T10:00:00.000Z", ltp: 100, delta: 0.48, gamma: 0.0012, source: "LIVE_RUNTIME_EXACT" as const };

test("confirms exact live premium and delta-gamma response when caller policy passes", () => {
  const out = evaluateLivePremiumDeltaGamma(prev, { ...prev, observedAt: "2026-09-03T10:01:00.000Z", ltp: 103, delta: 0.52, gamma: 0.0014 }, policy);
  assert.equal(out.premiumResponseConfirmed, true);
  assert.equal(out.deltaGammaResponseConfirmed, true);
});

test("fails closed on contract identity mismatch", () => {
  const out = evaluateLivePremiumDeltaGamma(prev, { ...prev, strike: 24050, observedAt: "2026-09-03T10:01:00.000Z" }, policy);
  assert.equal(out.premiumResponseConfirmed, null);
  assert.ok(out.reasonCodes.includes("CONTRACT_IDENTITY_MISMATCH"));
});

test("fails closed on non-forward chronology or excessive gap", () => {
  const same = evaluateLivePremiumDeltaGamma(prev, { ...prev }, policy);
  assert.ok(same.reasonCodes.includes("NON_FORWARD_CHRONOLOGY"));
  const stale = evaluateLivePremiumDeltaGamma(prev, { ...prev, observedAt: "2026-09-03T10:10:00.000Z" }, policy);
  assert.ok(stale.reasonCodes.includes("OBSERVATION_GAP_TOO_LARGE"));
});

test("does not invent thresholds when policy is invalid", () => {
  const out = evaluateLivePremiumDeltaGamma(prev, { ...prev, observedAt: "2026-09-03T10:01:00.000Z" }, { ...policy, minPremiumMovePct: Number.NaN });
  assert.equal(out.premiumResponseConfirmed, null);
  assert.ok(out.reasonCodes.includes("INVALID_POLICY"));
});

test("returns explicit false when valid evidence is below caller policy", () => {
  const out = evaluateLivePremiumDeltaGamma(prev, { ...prev, observedAt: "2026-09-03T10:01:00.000Z", ltp: 101, delta: 0.49, gamma: 0.0005 }, policy);
  assert.equal(out.premiumResponseConfirmed, false);
  assert.equal(out.deltaGammaResponseConfirmed, false);
});
