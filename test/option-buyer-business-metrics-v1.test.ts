import test from "node:test";
import assert from "node:assert/strict";
import {
  computeSellerStressProxy,
  computePremiumEfficiency,
  computePremiumPairSeparation,
  computeGreeksAdjustedPremiumResidual,
  computeRequiredMoveScenarios,
  computeConvexityEfficiency,
  computeRemainingOpportunity,
} from "../option-buyer-business-metrics-v1.ts";

test("seller stress is shadow-only and refuses weak evidence", () => {
  const weak = computeSellerStressProxy({ oiBuildShedPressure: 80, wallRetreatPressure: 70 });
  assert.equal(weak.ready, false);
  const ok = computeSellerStressProxy({
    oiBuildShedPressure: 70,
    wallRetreatPressure: 80,
    premiumResidualPressure: 75,
    futuresPressure: 65,
  });
  assert.equal(ok.ready, true);
  assert.equal(ok.state, "DEFENCE_WEAKENING");
  assert.equal(ok.affectsCandidateAuthority, false);
  assert.equal(ok.affectsStars, false);
  assert.equal(ok.affectsTelegram, false);
  assert.equal(ok.affectsExecution, false);
});

test("premium economics calculations remain deterministic", () => {
  const eff = computePremiumEfficiency({ actualPremiumMoveAbs: 18, expectedPremiumMoveAbs: 9 });
  assert.equal(eff.ratio, 2);
  const pair = computePremiumPairSeparation({ candidateChangePct: 22, oppositeChangePct: -14 });
  assert.equal(pair.state, "DIRECTIONAL_EXPANSION");
  assert.equal(pair.separationPct, 36);
  const residual = computeGreeksAdjustedPremiumResidual({
    actualPremiumChange: 18,
    delta: 0.5,
    gamma: 0.01,
    spotChange: 20,
    thetaChange: -1,
    vega: 2,
    ivChange: 0.5,
  });
  assert.equal(residual.ready, true);
  assert.equal(residual.expectedPremiumChange, 12);
  assert.equal(residual.residual, 6);
});

test("required move is scenario-based rather than one false-precision number", () => {
  const out = computeRequiredMoveScenarios({
    delta: 0.5,
    gamma: 0.01,
    currentPremium: 100,
    targetCostRecovery: 8,
    thetaChange: -1,
    vega: 2,
    ivChanges: { down: -0.5, flat: 0, up: 0.5 },
  });
  assert.equal(out.ready, true);
  assert.ok(out.scenarios!.ivDown! > out.scenarios!.ivFlat!);
  assert.ok(out.scenarios!.ivFlat! > out.scenarios!.ivUp!);
});

test("convexity and remaining opportunity fail closed and stay shadow-only", () => {
  const convex = computeConvexityEfficiency({ expectedGammaBenefit: 10, thetaBurnAbs: 2, spreadCost: 1, slippageCost: 1 });
  assert.equal(convex.ratio, 2.5);
  const opp = computeRemainingOpportunity({ expectedMoveUsedPct: 20, atrUsedPct: 30, premiumExtensionPct: 25 });
  assert.equal(opp.ready, true);
  assert.equal(opp.stage, "EARLY");
  assert.equal(opp.affectsVerdict, false);
  assert.equal(opp.createsOrders, false);
});
