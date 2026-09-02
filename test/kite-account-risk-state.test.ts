import assert from "node:assert/strict";
import test from "node:test";
import { buildKiteAccountRiskState } from "../kite-account-risk-state.js";

test("fails closed when open risk is unavailable", () => {
  const r = buildKiteAccountRiskState({ positions: [{ realised: -250 }], activeTradeOpenRisk: null, dynamicDailyLoss: 1000, estimatedExistingCosts: 50 });
  assert.equal(r.valid, false);
  assert.ok(r.reasonCodes.includes("OPEN_RISK_UNAVAILABLE"));
});

test("fails closed when realised pnl is absent from a position", () => {
  const r = buildKiteAccountRiskState({ positions: [{}], activeTradeOpenRisk: 100, dynamicDailyLoss: 1000, estimatedExistingCosts: 50 });
  assert.equal(r.valid, false);
  assert.ok(r.reasonCodes.includes("POSITION_REALISED_PNL_UNAVAILABLE"));
});

test("sums only realised losses as positive risk used", () => {
  const r = buildKiteAccountRiskState({ positions: [{ realised: -250 }, { realized: 100 }], activeTradeOpenRisk: 200, dynamicDailyLoss: 1200, estimatedExistingCosts: 75 });
  assert.equal(r.valid, true);
  assert.equal(r.realisedLossToday, 250);
  assert.equal(r.openRisk, 200);
  assert.equal(r.dynamicDailyLoss, 1200);
  assert.equal(r.estimatedExistingCosts, 75);
});
