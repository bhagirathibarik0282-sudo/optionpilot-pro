import assert from "node:assert/strict";
import { resolveRuntimeOptionBuyingRisk } from "../option-buying-runtime-risk-bridge.js";

async function run() {
  const ok = await resolveRuntimeOptionBuyingRisk("nifty", {
    read: () => ({ dynamicDailyLoss: 1200, realisedLossToday: 200, openRisk: 250, estimatedExistingCosts: 50 }),
  });
  assert.equal(ok.allowRiskEvaluation, true);
  assert.equal(ok.maxLossForNewTrade, 700);
  assert.deepEqual(ok.reasonCodes, ["LIVE_DYNAMIC_RISK_AUTHORITY_READY"]);

  const exhausted = await resolveRuntimeOptionBuyingRisk("NIFTY", {
    read: () => ({ dynamicDailyLoss: 1000, realisedLossToday: 600, openRisk: 350, estimatedExistingCosts: 50 }),
  });
  assert.equal(exhausted.allowRiskEvaluation, false);
  assert.equal(exhausted.maxLossForNewTrade, 0);
  assert.deepEqual(exhausted.reasonCodes, ["NO_REMAINING_DAY_RISK"]);

  const missing = await resolveRuntimeOptionBuyingRisk("SENSEX", { read: () => null });
  assert.equal(missing.allowRiskEvaluation, false);
  assert.deepEqual(missing.reasonCodes, ["RISK_STATE_UNAVAILABLE"]);

  const errored = await resolveRuntimeOptionBuyingRisk("NIFTY", { read: () => { throw new Error("boom"); } });
  assert.equal(errored.allowRiskEvaluation, false);
  assert.deepEqual(errored.reasonCodes, ["RISK_STATE_PROVIDER_ERROR"]);

  const invalid = await resolveRuntimeOptionBuyingRisk(" ", { read: () => null });
  assert.equal(invalid.allowRiskEvaluation, false);
  assert.deepEqual(invalid.reasonCodes, ["INVALID_SYMBOL"]);

  console.log("option buying runtime risk bridge tests passed");
}

run();
