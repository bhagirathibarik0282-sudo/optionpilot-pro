import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiquiditySpreadGate } from "../execution-liquidity-spread-gate.ts";

const base = {
  bid: 119.5,
  ask: 120.0,
  bidQty: 400,
  askQty: 400,
  orderQty: 100,
  quoteAgeMs: 500,
  policy: {
    maxQuoteAgeMs: 3000,
    maxRelativeSpreadPct: 1.5,
    minAskDepthCoverageMultiple: 2,
    minBidDepthCoverageMultiple: 2,
  },
};

test("allows fresh tight liquid quote", () => {
  const r = evaluateLiquiditySpreadGate(base);
  assert.equal(r.decision, "ALLOW");
});

test("blocks stale quote", () => {
  const r = evaluateLiquiditySpreadGate({ ...base, quoteAgeMs: 4000 });
  assert.ok(r.reasonCodes.includes("QUOTE_STALE"));
});

test("blocks crossed or invalid market", () => {
  const r = evaluateLiquiditySpreadGate({ ...base, bid: 121, ask: 120 });
  assert.ok(r.reasonCodes.includes("INVALID_BID_ASK"));
});

test("blocks wide relative spread", () => {
  const r = evaluateLiquiditySpreadGate({ ...base, bid: 115, ask: 120 });
  assert.ok(r.reasonCodes.includes("SPREAD_TOO_WIDE"));
});

test("blocks insufficient ask depth for entry", () => {
  const r = evaluateLiquiditySpreadGate({ ...base, askQty: 100 });
  assert.ok(r.reasonCodes.includes("INSUFFICIENT_ENTRY_DEPTH"));
});

test("blocks insufficient bid depth for exit", () => {
  const r = evaluateLiquiditySpreadGate({ ...base, bidQty: 100 });
  assert.ok(r.reasonCodes.includes("INSUFFICIENT_EXIT_DEPTH"));
});

test("blocks zero order quantity", () => {
  const r = evaluateLiquiditySpreadGate({ ...base, orderQty: 0 });
  assert.equal(r.decision, "BLOCK");
});

test("blocks invalid policy instead of guessing threshold", () => {
  const r = evaluateLiquiditySpreadGate({ ...base, policy: { ...base.policy, maxRelativeSpreadPct: 0 } });
  assert.ok(r.reasonCodes.includes("INVALID_LIQUIDITY_POLICY"));
});
