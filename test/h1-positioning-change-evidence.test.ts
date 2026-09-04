import test from "node:test";
import assert from "node:assert/strict";
import { buildH1PositioningChangeEvidence, type H1PositioningSnapshot } from "../h1-positioning-change-evidence.js";

const previous: H1PositioningSnapshot = {
  symbol: "NIFTY",
  expiry: "2026-09-08",
  observedAt: "2026-09-04T09:30:00.000Z",
  fullChainOiPcr: 0.82,
  band7OiPcr: 0.91,
  volumePcr: 0.88,
  callWallStrike: 24000,
  callWallStrength: 100,
  putWallStrike: 23800,
  putWallStrength: 100,
};

const current: H1PositioningSnapshot = {
  ...previous,
  observedAt: "2026-09-04T09:33:00.000Z",
  fullChainOiPcr: 0.86,
  band7OiPcr: 0.98,
  volumePcr: 0.90,
  callWallStrike: 24050,
  callWallStrength: 90,
  putWallStrike: 23850,
  putWallStrength: 115,
};

const policy = { maxObservationGapMs: 180_000 };

test("derives PCR deltas, wall migration and build/shed context without authority", () => {
  const result = buildH1PositioningChangeEvidence(previous, current, policy);
  assert.equal(result.ready, true);
  assert.ok(Math.abs((result.fullChainOiPcrDelta ?? 0) - 0.04) < 1e-9);
  assert.ok(Math.abs((result.band7OiPcrDelta ?? 0) - 0.07) < 1e-9);
  assert.equal(result.callWallMigration, 50);
  assert.equal(result.putWallMigration, 50);
  assert.equal(result.callWallStrengthChangePct, -10);
  assert.equal(result.putWallStrengthChangePct, 15);
  assert.equal(result.callWallState, "SHEDDING");
  assert.equal(result.putWallState, "BUILDING");
  assert.equal(result.productionImpact, "NONE");
  assert.equal(result.readOnly, true);
  assert.equal(result.forwardsDownstream, false);
  assert.equal(result.affectsVerdict, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.affectsTelegram, false);
  assert.equal(result.grantsPromotionAuthority, false);
  assert.equal(result.failClosed, true);
});

test("fails closed on symbol/expiry mismatch", () => {
  const result = buildH1PositioningChangeEvidence(previous, { ...current, expiry: "2026-09-15" }, policy);
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, ["POSITIONING_IDENTITY_MISMATCH"]);
});

test("fails closed on stale observation gap", () => {
  const result = buildH1PositioningChangeEvidence(previous, { ...current, observedAt: "2026-09-04T09:34:00.001Z" }, policy);
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, ["OBSERVATION_GAP_TOO_LARGE"]);
});

test("fails closed on non-forward chronology", () => {
  const result = buildH1PositioningChangeEvidence(previous, { ...current, observedAt: previous.observedAt }, policy);
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, ["NON_FORWARD_CHRONOLOGY"]);
});

test("does not accept zero/invalid wall strengths", () => {
  const result = buildH1PositioningChangeEvidence({ ...previous, callWallStrength: 0 }, current, policy);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("INVALID_PREVIOUS_POSITIONING_SNAPSHOT"));
});
