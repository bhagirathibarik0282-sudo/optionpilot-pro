import test from "node:test";
import assert from "node:assert/strict";
import { classifyBehaviourRisk, type BehaviourRiskEvidence } from "../behaviour-risk-engine.ts";

const base: BehaviourRiskEvidence = {
  dataFresh: true,
  contractValid: true,
  lateEntryExtended: false,
  earlyExitCondition: false,
  stopExtensionCondition: false,
  revengeFlipCondition: false,
  missedMoveFomoCondition: false,
  averagingLoserCondition: false,
  earlyProfitBookingCondition: false,
  thesisWeakening: false,
  noFlipYet: false,
};

test("no objective condition produces no behaviour risk", () => {
  const r = classifyBehaviourRisk(base);
  assert.deepEqual(r.risks, []);
  assert.equal(r.infersMentalState, false);
});

test("late extension produces DO_NOT_CHASE", () => {
  const r = classifyBehaviourRisk({ ...base, lateEntryExtended: true });
  assert.ok(r.risks.includes("DO_NOT_CHASE"));
});

test("thesis weakening and no-flip can coexist", () => {
  const r = classifyBehaviourRisk({ ...base, thesisWeakening: true, noFlipYet: true });
  assert.ok(r.risks.includes("THESIS_WEAKENING"));
  assert.ok(r.risks.includes("NO_FLIP_YET"));
});

test("revenge flip condition is objective and does not infer mental state", () => {
  const r = classifyBehaviourRisk({ ...base, revengeFlipCondition: true });
  assert.ok(r.risks.includes("REVENGE_FLIP_RISK"));
  assert.equal(r.infersMentalState, false);
});

test("stale or invalid contract fails closed", () => {
  assert.deepEqual(classifyBehaviourRisk({ ...base, dataFresh: false }).risks, ["DATA_UNAVAILABLE"]);
  assert.deepEqual(classifyBehaviourRisk({ ...base, contractValid: false }).risks, ["DATA_UNAVAILABLE"]);
});

test("missing evidence fails closed", () => {
  const r = classifyBehaviourRisk({ ...base, earlyExitCondition: null });
  assert.deepEqual(r.risks, ["DATA_UNAVAILABLE"]);
});

test("all explicit objective risks may be surfaced together", () => {
  const r = classifyBehaviourRisk({
    ...base,
    lateEntryExtended: true,
    earlyExitCondition: true,
    stopExtensionCondition: true,
    averagingLoserCondition: true,
    earlyProfitBookingCondition: true,
  });
  assert.ok(r.risks.includes("DO_NOT_CHASE"));
  assert.ok(r.risks.includes("EARLY_EXIT_RISK"));
  assert.ok(r.risks.includes("STOP_EXTENSION_RISK"));
  assert.ok(r.risks.includes("AVERAGING_LOSER_RISK"));
  assert.ok(r.risks.includes("EARLY_PROFIT_BOOKING_RISK"));
  assert.equal(r.affectsTelegram, false);
  assert.equal(r.affectsVerdict, false);
  assert.equal(r.affectsExecution, false);
});
