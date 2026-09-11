import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateEvidenceFromLiveMeasurement } from "../candidate-evidence-live-adapter-v1.js";

test("clear CE alignment becomes CE_WATCH", () => {
  const r = buildCandidateEvidenceFromLiveMeasurement({
    symbol: "NIFTY",
    priceDirection: "UP", futuresDirection: "UP", priceFuturesVerified: true,
    ppdSide: "CE", ppdValuePp: 5, premiumVerified: true,
    positioningSide: "CE", positioningVerified: true,
    breadthUp: 4, breadthDown: 1, breadthVerified: true,
    primaryDirection: "UP", peerDirection: "UP", multiDteVerified: true,
  });
  assert.equal(r.state, "CE_WATCH");
  assert.equal(r.candidate, "CE");
  assert.equal(r.affectsSelector, false);
  assert.equal(r.affectsExecution, false);
  assert.equal(r.createsOrders, false);
});

test("conflicting families stay MIXED", () => {
  const r = buildCandidateEvidenceFromLiveMeasurement({
    symbol: "SENSEX",
    priceDirection: "UP", futuresDirection: "UP", priceFuturesVerified: true,
    ppdSide: "PE", ppdValuePp: 5, premiumVerified: true,
    positioningSide: "PE", positioningVerified: true,
    breadthUp: 4, breadthDown: 1, breadthVerified: true,
    primaryDirection: "DOWN", peerDirection: "DOWN", multiDteVerified: true,
  });
  assert.equal(r.state, "MIXED");
  assert.equal(r.candidate, "NONE");
});

test("unverified inputs remain NOT_READY and contribute zero", () => {
  const r = buildCandidateEvidenceFromLiveMeasurement({ symbol: "BANKNIFTY" });
  assert.equal(r.state, "NOT_READY");
  assert.equal(r.verifiedFamilyCount, 0);
  assert.equal(r.ceScore, 0);
  assert.equal(r.peScore, 0);
});

test("zero/neutral positioning is not forced directional", () => {
  const r = buildCandidateEvidenceFromLiveMeasurement({
    symbol: "SENSEX",
    priceDirection: "UP", futuresDirection: "UP", priceFuturesVerified: true,
    ppdSide: "CE", ppdValuePp: 5, premiumVerified: true,
    positioningSide: "NEUTRAL", positioningVerified: true,
    breadthUp: 3, breadthDown: 2, breadthVerified: true,
    primaryDirection: "UP", peerDirection: "UP", multiDteVerified: true,
  });
  const positioning = r.families.find((x) => x.family === "POSITIONING");
  assert.equal(positioning?.points, 0);
  assert.equal(positioning?.stance, "NEUTRAL");
});
