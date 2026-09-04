import test from "node:test";
import assert from "node:assert/strict";
import { buildH1VolatilityContextEvidence, type H1VolatilitySnapshot } from "../h1-volatility-context-evidence.js";

const previous: H1VolatilitySnapshot = {
  symbol: "NIFTY",
  observedAt: "2026-09-04T09:30:00.000Z",
  indiaVix: 11.2,
  ivQuality: "NOT_CONFIGURED",
};

const current: H1VolatilitySnapshot = {
  symbol: "NIFTY",
  observedAt: "2026-09-04T09:33:00.000Z",
  indiaVix: 11.48,
  ivQuality: "NOT_CONFIGURED",
};

const policy = { maxObservationGapMs: 180_000 };

test("derives VIX context while keeping unconfigured IV unavailable", () => {
  const result = buildH1VolatilityContextEvidence(previous, current, policy);
  assert.equal(result.ready, true);
  assert.equal(result.vixState, "RISING");
  assert.ok(Math.abs((result.vixChange ?? 0) - 0.28) < 1e-9);
  assert.equal(result.ivAvailable, false);
  assert.equal(result.atmIv, null);
  assert.equal(result.ivStatus, "NOT_CONFIGURED");
  assert.equal(result.productionImpact, "NONE");
  assert.equal(result.readOnly, true);
  assert.equal(result.forwardsDownstream, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.grantsPromotionAuthority, false);
  assert.equal(result.failClosed, true);
});

test("exposes IV only when quality is VALID", () => {
  const result = buildH1VolatilityContextEvidence(previous, {
    ...current,
    ivQuality: "VALID",
    atmIv: 14.6,
    ivVelocityPerMinute: 0.12,
  }, policy);
  assert.equal(result.ready, true);
  assert.equal(result.ivAvailable, true);
  assert.equal(result.atmIv, 14.6);
  assert.equal(result.ivVelocityPerMinute, 0.12);
});

test("does not expose PARTIAL or INVALID IV as verified", () => {
  for (const ivQuality of ["PARTIAL", "INVALID"] as const) {
    const result = buildH1VolatilityContextEvidence(previous, { ...current, ivQuality, atmIv: 20 }, policy);
    assert.equal(result.ready, true);
    assert.equal(result.ivAvailable, false);
    assert.equal(result.atmIv, null);
  }
});

test("fails closed on symbol mismatch", () => {
  const result = buildH1VolatilityContextEvidence(previous, { ...current, symbol: "SENSEX" }, policy);
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, ["VOLATILITY_SYMBOL_MISMATCH"]);
});

test("fails closed on stale or non-forward observations", () => {
  const stale = buildH1VolatilityContextEvidence(previous, { ...current, observedAt: "2026-09-04T09:33:00.001Z" }, policy);
  assert.equal(stale.ready, false);
  assert.deepEqual(stale.blockers, ["OBSERVATION_GAP_TOO_LARGE"]);
  const nonForward = buildH1VolatilityContextEvidence(previous, { ...current, observedAt: previous.observedAt }, policy);
  assert.equal(nonForward.ready, false);
  assert.deepEqual(nonForward.blockers, ["NON_FORWARD_CHRONOLOGY"]);
});
