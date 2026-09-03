import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveCapitalLiquidityDteGates } from "../h1-live-capital-liquidity-dte-gates.js";

const policy = { maxCapitalPerTrade: 50000, maxRelativeSpreadPct: 5, minBidDepthCoverageMultiple: 1, minAskDepthCoverageMultiple: 1, allowFallbackDte5To7: false };
const base = { provenance: "LIVE_RUNTIME_EXACT" as const, symbol: "NIFTY" as const, dte: 2, premiumLtp: 100, lotQuantity: 150, bid: 99, ask: 101, bidQty: 300, askQty: 300, occurredAt: "2026-09-03T10:00:00.000Z", receivedAt: "2026-09-03T10:00:01.000Z" };

test("exact weekly candidate passes capital liquidity spread and near DTE", () => {
  const r = evaluateLiveCapitalLiquidityDteGates(base, policy);
  assert.equal(r.capitalFit, true); assert.equal(r.liquidityOk, true); assert.equal(r.spreadOk, true); assert.equal(r.currentOrNearExpiryUsable, true);
});

test("non exact provenance fails closed", () => {
  const r = evaluateLiveCapitalLiquidityDteGates({ ...base, provenance: "RESEARCH_SHADOW" as any }, policy);
  assert.equal(r.capitalFit, false); assert.ok(r.reasonCodes.includes("INVALID_PROVENANCE"));
});

test("capital, liquidity and spread are independently derived", () => {
  const r = evaluateLiveCapitalLiquidityDteGates({ ...base, premiumLtp: 400, bid: 90, ask: 110, bidQty: 20, askQty: 20 }, policy);
  assert.equal(r.capitalFit, false); assert.equal(r.liquidityOk, false); assert.equal(r.spreadOk, false);
});

test("fallback DTE requires explicit policy approval", () => {
  const blocked = evaluateLiveCapitalLiquidityDteGates({ ...base, dte: 6 }, policy);
  assert.equal(blocked.fallbackDteApproved, false);
  const allowed = evaluateLiveCapitalLiquidityDteGates({ ...base, dte: 6 }, { ...policy, allowFallbackDte5To7: true });
  assert.equal(allowed.fallbackDteApproved, true);
});

test("BANKNIFTY only qualifies higher DTE 10 to 35", () => {
  const r = evaluateLiveCapitalLiquidityDteGates({ ...base, symbol: "BANKNIFTY", dte: 20 }, policy);
  assert.equal(r.higherDteUsable, true); assert.equal(r.currentOrNearExpiryUsable, false);
});
