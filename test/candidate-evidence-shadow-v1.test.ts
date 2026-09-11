import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateEvidenceShadow } from "../candidate-evidence-shadow-v1.js";

const verified = (stance: "CE" | "PE" | "NEUTRAL" | "UNAVAILABLE", strength = 1) => ({ stance, strength, verified: true });

test("produces CE watch only when at least three verified independent families align", () => {
  const result = buildCandidateEvidenceShadow({
    symbol: "NIFTY",
    priceFutures: verified("CE", 1),
    premiumPpd: verified("CE", 1),
    positioning: verified("CE", 0.8),
    breadthLeadLag: verified("NEUTRAL"),
    multiDte: verified("UNAVAILABLE"),
  });
  assert.equal(result.state, "CE_WATCH");
  assert.equal(result.candidate, "CE");
  assert.equal(result.affectsSelector, false);
  assert.equal(result.affectsExecution, false);
  assert.equal(result.createsOrders, false);
});

test("keeps conflicting evidence mixed instead of forcing a candidate", () => {
  const result = buildCandidateEvidenceShadow({
    symbol: "SENSEX",
    priceFutures: verified("CE", 1),
    premiumPpd: verified("PE", 1),
    positioning: verified("CE", 0.5),
    breadthLeadLag: verified("PE", 0.5),
    multiDte: verified("NEUTRAL"),
  });
  assert.equal(result.state, "MIXED");
  assert.equal(result.candidate, "NONE");
});

test("unavailable or zero-quality family contributes no directional points", () => {
  const result = buildCandidateEvidenceShadow({
    symbol: "SENSEX",
    priceFutures: verified("CE", 1),
    premiumPpd: verified("CE", 1),
    positioning: { stance: "UNAVAILABLE", verified: true, strength: 1, detail: "wall zero/unusable" },
    breadthLeadLag: { stance: "PE", verified: false, strength: 1 },
    multiDte: verified("NEUTRAL"),
  });
  assert.equal(result.ceScore, 40);
  assert.equal(result.peScore, 0);
  assert.equal(result.verifiedFamilyCount, 3);
  assert.equal(result.state, "CE_WATCH");
});

test("does not become ready with fewer than three verified families", () => {
  const result = buildCandidateEvidenceShadow({
    symbol: "NIFTY",
    priceFutures: verified("PE", 1),
    premiumPpd: verified("PE", 1),
    positioning: { stance: "UNAVAILABLE", verified: false },
    breadthLeadLag: { stance: "UNAVAILABLE", verified: false },
    multiDte: { stance: "UNAVAILABLE", verified: false },
  });
  assert.equal(result.state, "NOT_READY");
  assert.equal(result.candidate, "NONE");
});
