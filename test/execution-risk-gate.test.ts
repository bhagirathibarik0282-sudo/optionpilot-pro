import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateExecutionCapitalGate,
  evaluateExecutionLossGate,
  evaluateExecutionDailyLossGate,
} from "../execution-risk-gate.ts";

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

test("allows projected loss exactly at configured max loss", () => {
  const result = evaluateExecutionLossGate({
    symbol: "NIFTY",
    projectedMaxLoss: 500,
    policy: { maxLossPerTrade: 500 },
  });
  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.reasonCodes, ["LOSS_GATE_PASSED"]);
});

test("blocks projected loss above configured max loss", () => {
  const result = evaluateExecutionLossGate({
    symbol: "SENSEX",
    projectedMaxLoss: 501,
    policy: { maxLossPerTrade: 500 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("MAX_LOSS_PER_TRADE_LIMIT_EXCEEDED"));
});

test("fails closed when projected max loss is invalid", () => {
  const result = evaluateExecutionLossGate({
    symbol: "NIFTY",
    projectedMaxLoss: Number.NaN,
    policy: { maxLossPerTrade: 500 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("INVALID_PROJECTED_MAX_LOSS"));
  assert.equal(result.failClosed, true);
});

test("fails closed when max loss policy is invalid", () => {
  const result = evaluateExecutionLossGate({
    symbol: "BANKNIFTY",
    projectedMaxLoss: 250,
    policy: { maxLossPerTrade: 0 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("INVALID_MAX_LOSS_PER_TRADE"));
});

test("loss gate blocks blank symbol", () => {
  const result = evaluateExecutionLossGate({
    symbol: " ",
    projectedMaxLoss: 250,
    policy: { maxLossPerTrade: 500 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("INVALID_SYMBOL"));
});

test("daily loss gate allows a new trade while total risk stays below cap", () => {
  const result = evaluateExecutionDailyLossGate({
    symbol: "NIFTY",
    realizedLossToday: 300,
    openRisk: 200,
    newTradeProjectedLoss: 400,
    policy: { maxDailyLoss: 1000 },
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.projectedDailyLossExposure, 900);
  assert.deepEqual(result.reasonCodes, ["DAILY_LOSS_GATE_PASSED"]);
});

test("daily loss gate blocks exactly at the daily cap", () => {
  const result = evaluateExecutionDailyLossGate({
    symbol: "SENSEX",
    realizedLossToday: 300,
    openRisk: 200,
    newTradeProjectedLoss: 500,
    policy: { maxDailyLoss: 1000 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("MAX_DAILY_LOSS_LIMIT_REACHED_OR_EXCEEDED"));
});

test("daily loss gate blocks above the daily cap", () => {
  const result = evaluateExecutionDailyLossGate({
    symbol: "BANKNIFTY",
    realizedLossToday: 700,
    openRisk: 200,
    newTradeProjectedLoss: 200,
    policy: { maxDailyLoss: 1000 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.projectedDailyLossExposure, 1100);
});

test("daily loss gate fails closed on invalid realized loss", () => {
  const result = evaluateExecutionDailyLossGate({
    symbol: "NIFTY",
    realizedLossToday: Number.NaN,
    openRisk: 0,
    newTradeProjectedLoss: 200,
    policy: { maxDailyLoss: 1000 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("INVALID_REALIZED_LOSS_TODAY"));
  assert.equal(result.failClosed, true);
});

test("daily loss gate fails closed on negative open risk", () => {
  const result = evaluateExecutionDailyLossGate({
    symbol: "NIFTY",
    realizedLossToday: 0,
    openRisk: -1,
    newTradeProjectedLoss: 200,
    policy: { maxDailyLoss: 1000 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("INVALID_OPEN_RISK"));
});

test("daily loss gate fails closed on invalid daily cap", () => {
  const result = evaluateExecutionDailyLossGate({
    symbol: "NIFTY",
    realizedLossToday: 0,
    openRisk: 0,
    newTradeProjectedLoss: 200,
    policy: { maxDailyLoss: 0 },
  });
  assert.equal(result.decision, "BLOCK");
  assert.ok(result.reasonCodes.includes("INVALID_MAX_DAILY_LOSS"));
});
