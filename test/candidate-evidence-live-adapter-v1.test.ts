import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateEvidenceFromLiveMeasurement, resetCandidateEvidencePersistenceForTest } from "../candidate-evidence-live-adapter-v1.js";

test("clear CE alignment becomes CE_WATCH", () => {
  resetCandidateEvidencePersistenceForTest();
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
  resetCandidateEvidencePersistenceForTest();
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
  resetCandidateEvidencePersistenceForTest();
  const r = buildCandidateEvidenceFromLiveMeasurement({ symbol: "BANKNIFTY" });
  assert.equal(r.state, "NOT_READY");
  assert.equal(r.verifiedFamilyCount, 0);
  assert.equal(r.ceScore, 0);
  assert.equal(r.peScore, 0);
});

test("zero/neutral positioning is not forced directional", () => {
  resetCandidateEvidencePersistenceForTest();
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

test("soft shadow WATCH requires two consecutive qualifying cycles", () => {
  resetCandidateEvidencePersistenceForTest();
  const input = {
    symbol: "NIFTY" as const,
    priceDirection: "FLAT" as const,
    futuresDirection: "UP" as const,
    priceFuturesVerified: true,
    ppdSide: "PE" as const,
    ppdValuePp: 3,
    premiumVerified: true,
    positioningSide: "PE" as const,
    positioningVerified: true,
    breadthUp: 1,
    breadthDown: 4,
    breadthVerified: true,
    primaryDirection: null,
    peerDirection: null,
    multiDteVerified: false,
  };

  const first = buildCandidateEvidenceFromLiveMeasurement(input);
  assert.equal(first.state, "MIXED");
  assert.equal(first.candidate, "NONE");
  assert.ok(first.peScore >= 30);
  assert.ok(first.margin >= 15);

  const second = buildCandidateEvidenceFromLiveMeasurement(input);
  assert.equal(second.state, "PE_WATCH");
  assert.equal(second.candidate, "PE");
  assert.equal(second.affectsSelector, false);
  assert.equal(second.affectsExecution, false);
  assert.equal(second.createsOrders, false);
});

test("soft shadow persistence resets when the leading side flips", () => {
  resetCandidateEvidencePersistenceForTest();
  const peInput = {
    symbol: "NIFTY" as const,
    priceDirection: "FLAT" as const,
    futuresDirection: "UP" as const,
    priceFuturesVerified: true,
    ppdSide: "PE" as const,
    ppdValuePp: 3,
    premiumVerified: true,
    positioningSide: "PE" as const,
    positioningVerified: true,
    breadthUp: 1,
    breadthDown: 4,
    breadthVerified: true,
    primaryDirection: null,
    peerDirection: null,
    multiDteVerified: false,
  };
  const ceInput = {
    ...peInput,
    ppdSide: "CE" as const,
    positioningSide: "CE" as const,
    breadthUp: 4,
    breadthDown: 1,
  };

  assert.equal(buildCandidateEvidenceFromLiveMeasurement(peInput).state, "MIXED");
  assert.equal(buildCandidateEvidenceFromLiveMeasurement(ceInput).state, "MIXED");
  assert.equal(buildCandidateEvidenceFromLiveMeasurement(peInput).state, "MIXED");
});
