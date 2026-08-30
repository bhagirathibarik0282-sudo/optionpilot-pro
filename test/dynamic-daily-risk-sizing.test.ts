import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDynamicDailyRiskSizing } from "../dynamic-daily-risk-sizing";

const policy = { warningLoss: 1050, hardDailyLoss: 1180 };

function base() {
  return {
    realisedLossToday: 0,
    openRisk: 0,
    estimatedExistingCosts: 0,
    entryPremium: 120,
    stopPremium: 116,
    lotSize: 50,
    estimatedRoundTripCostPerLot: 40,
    policy,
  };
}

test("allows two lots when both fit remaining daily risk", () => {
  const r = evaluateDynamicDailyRiskSizing(base());
  assert.equal(r.decision, "TWO_LOTS");
  assert.equal(r.selectedLots, 2);
  assert.equal(r.twoLotProjectedRisk, 480);
});

test("reduces to one lot when two lots exceed remaining risk", () => {
  const r = evaluateDynamicDailyRiskSizing({ ...base(), realisedLossToday: 800 });
  assert.equal(r.decision, "ONE_LOT");
  assert.equal(r.selectedLots, 1);
});

test("warning zone never permits two new lots", () => {
  const r = evaluateDynamicDailyRiskSizing({ ...base(), realisedLossToday: 1050 });
  assert.notEqual(r.decision, "TWO_LOTS");
  assert.equal(r.warningZone, true);
});

test("hard daily stop blocks all new trades", () => {
  const r = evaluateDynamicDailyRiskSizing({ ...base(), realisedLossToday: 1180 });
  assert.equal(r.decision, "NO_TRADE");
  assert.equal(r.hardStopTriggered, true);
});

test("existing open risk and costs consume daily budget", () => {
  const r = evaluateDynamicDailyRiskSizing({ ...base(), realisedLossToday: 700, openRisk: 200, estimatedExistingCosts: 80 });
  assert.equal(r.remainingDayRisk, 200);
  assert.equal(r.decision, "NO_TRADE");
});

test("charges are included in projected trade risk", () => {
  const r = evaluateDynamicDailyRiskSizing({ ...base(), estimatedRoundTripCostPerLot: 100 });
  assert.equal(r.oneLotProjectedRisk, 300);
  assert.equal(r.twoLotProjectedRisk, 600);
});

test("invalid long-option stop fails closed", () => {
  const r = evaluateDynamicDailyRiskSizing({ ...base(), stopPremium: 121 });
  assert.equal(r.decision, "NO_TRADE");
  assert.ok(r.reasonCodes.includes("INVALID_ENTRY_STOP"));
});

test("invalid risk policy fails closed", () => {
  const r = evaluateDynamicDailyRiskSizing({ ...base(), policy: { warningLoss: 1180, hardDailyLoss: 1050 } });
  assert.equal(r.decision, "NO_TRADE");
  assert.ok(r.reasonCodes.includes("INVALID_RISK_POLICY"));
});
