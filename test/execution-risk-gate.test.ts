import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExecutionCapitalGate } from "../execution-risk-gate.ts";

test("allows a trade at the configured capital limit", () => {
  const result = evaluateExecutionCapitalGate({
    symbol: "NIFTY",
    plannedCapital: 10000,
    policy: { maxCapitalPerTrade: 10000 },
  });
  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.reasonCodes, ["CAPITAL_GATE_PASSED"]);
});

test("blocks a trade above the configured capital limit", () => {
  const result = evaluateExecutionCapitalGate({
    symbol: "NIFTY",
    plannedCapital: 10001,
    policy: { maxCapitalPerTrade: 10000 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("CAPITAL_PER_TRADE_LIMIT_EXCEEDED"));
});

test("fails closed when planned capital is invalid", () => {
  const result = evaluateExecutionCapitalGate({
    symbol: "NIFTY",
    plannedCapital: Number.NaN,
    policy: { maxCapitalPerTrade: 10000 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("INVALID_PLANNED_CAPITAL"));
  assert.equal(result.failClosed, true);
});

test("fails closed when capital policy is invalid", () => {
  const result = evaluateExecutionCapitalGate({
    symbol: "NIFTY",
    plannedCapital: 5000,
    policy: { maxCapitalPerTrade: 0 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("INVALID_MAX_CAPITAL_PER_TRADE"));
});

test("blocks missing/blank symbol rather than silently allowing", () => {
  const result = evaluateExecutionCapitalGate({
    symbol: "   ",
    plannedCapital: 5000,
    policy: { maxCapitalPerTrade: 10000 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("INVALID_SYMBOL"));
});
