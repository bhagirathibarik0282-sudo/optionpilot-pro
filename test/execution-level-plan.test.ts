import test from "node:test";
import assert from "node:assert/strict";
import { buildExecutionLevelPlan } from "../execution-level-plan.ts";

const base = {
  symbol: "NIFTY" as const,
  entryPremium: 100,
  invalidationPremium: 90,
  entryTriggerConfirmed: true,
  structureInvalidationConfirmed: true,
  maxLossPerTrade: 1000,
  quantity: 1,
  lotSize: 50,
};

test("builds 1R, 1.5R and 2R targets from structure risk", () => {
  const r = buildExecutionLevelPlan(base);
  assert.equal(r.decision, "READY");
  assert.equal(r.riskPerUnit, 10);
  assert.equal(r.projectedLoss, 500);
  assert.equal(r.t1, 110);
  assert.equal(r.t2, 115);
  assert.equal(r.t3, 120);
});

test("blocks when entry trigger is not confirmed", () => {
  const r = buildExecutionLevelPlan({ ...base, entryTriggerConfirmed: false });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("ENTRY_TRIGGER_NOT_CONFIRMED"));
});

test("blocks when structure invalidation is not confirmed", () => {
  const r = buildExecutionLevelPlan({ ...base, structureInvalidationConfirmed: false });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("STRUCTURE_INVALIDATION_NOT_CONFIRMED"));
});

test("blocks stop loss at or above long-option entry", () => {
  const r = buildExecutionLevelPlan({ ...base, invalidationPremium: 100 });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("STOP_LOSS_MUST_BE_BELOW_ENTRY_FOR_LONG_OPTION"));
});

test("blocks projected loss above per-trade cap", () => {
  const r = buildExecutionLevelPlan({ ...base, invalidationPremium: 70, maxLossPerTrade: 1000 });
  assert.equal(r.projectedLoss, null);
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("PROJECTED_LOSS_EXCEEDS_MAX_LOSS_PER_TRADE"));
});

test("allows projected loss exactly at per-trade cap", () => {
  const r = buildExecutionLevelPlan({ ...base, invalidationPremium: 80, maxLossPerTrade: 1000 });
  assert.equal(r.decision, "READY");
  assert.equal(r.projectedLoss, 1000);
});

test("fails closed on invalid entry premium", () => {
  const r = buildExecutionLevelPlan({ ...base, entryPremium: Number.NaN });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("INVALID_ENTRY_PREMIUM"));
  assert.equal(r.failClosed, true);
});

test("fails closed on invalid stop premium", () => {
  const r = buildExecutionLevelPlan({ ...base, invalidationPremium: 0 });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("INVALID_STOP_LOSS_PREMIUM"));
});

test("fails closed on invalid quantity", () => {
  const r = buildExecutionLevelPlan({ ...base, quantity: 0 });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("INVALID_QUANTITY"));
});

test("fails closed on invalid lot size", () => {
  const r = buildExecutionLevelPlan({ ...base, lotSize: 0 });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("INVALID_LOT_SIZE"));
});
