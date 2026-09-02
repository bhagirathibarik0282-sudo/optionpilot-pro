import test from "node:test";
import assert from "node:assert/strict";
import { resolveOptionBuyingRiskAuthority } from "../option-buying-risk-authority.js";

test("uses remaining dynamic day risk instead of a fixed per-trade rupee cap", () => {
  const result = resolveOptionBuyingRiskAuthority({
    dynamicDailyLoss: 1800,
    realisedLossToday: 400,
    openRisk: 250,
    estimatedExistingCosts: 50,
  });

  assert.equal(result.valid, true);
  assert.equal(result.remainingDayRisk, 1100);
  assert.equal(result.maxLossForNewTrade, 1100);
  assert.deepEqual(result.reasonCodes, ["DYNAMIC_REMAINING_DAY_RISK_AUTHORITY"]);
});

test("fails closed when dynamic risk authority is invalid", () => {
  const result = resolveOptionBuyingRiskAuthority({
    dynamicDailyLoss: 0,
    realisedLossToday: 0,
    openRisk: 0,
    estimatedExistingCosts: 0,
  });

  assert.equal(result.valid, false);
  assert.equal(result.maxLossForNewTrade, 0);
  assert.equal(result.failClosed, true);
});

test("blocks new risk when the dynamic daily allowance is exhausted", () => {
  const result = resolveOptionBuyingRiskAuthority({
    dynamicDailyLoss: 1000,
    realisedLossToday: 700,
    openRisk: 250,
    estimatedExistingCosts: 50,
  });

  assert.equal(result.valid, true);
  assert.equal(result.maxLossForNewTrade, 0);
  assert.deepEqual(result.reasonCodes, ["NO_REMAINING_DAY_RISK"]);
});
