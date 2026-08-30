import test from "node:test";
import assert from "node:assert/strict";
import { buildProtectedBrokerOrder } from "../broker-order-builder.ts";

const base = {
  symbol: "NIFTY" as const,
  tradingsymbol: "NIFTY26SEP25000CE",
  exchange: "NFO" as const,
  quantity: 130,
  liquidityDecision: "ALLOW" as const,
  validatedAsk: 120,
  currentAsk: 120.05,
  quoteFresh: true,
  tickSize: 0.05,
  maxEntrySlippagePct: 0.5,
};

test("builds protected LIMIT intent only", () => {
  const r = buildProtectedBrokerOrder(base);
  assert.equal(r.decision, "BUILD");
  assert.equal(r.placesOrder, false);
  assert.equal(r.intent?.orderType, "LIMIT");
  assert.equal(r.intent?.transactionType, "BUY");
});

test("blocks when liquidity gate failed", () => {
  const r = buildProtectedBrokerOrder({ ...base, liquidityDecision: "BLOCK" });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("LIQUIDITY_SPREAD_GATE_NOT_PASSED"));
});

test("blocks stale quote", () => {
  const r = buildProtectedBrokerOrder({ ...base, quoteFresh: false });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("QUOTE_NOT_FRESH"));
});

test("blocks adverse quote drift beyond slippage cap", () => {
  const r = buildProtectedBrokerOrder({ ...base, currentAsk: 121, maxEntrySlippagePct: 0.5 });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("ENTRY_SLIPPAGE_CAP_EXCEEDED"));
});

test("allows a better current ask", () => {
  const r = buildProtectedBrokerOrder({ ...base, currentAsk: 119.5 });
  assert.equal(r.decision, "BUILD");
  assert.ok((r.observedSlippagePct ?? 0) < 0);
});

test("rounds buy limit upward to configured tick", () => {
  const r = buildProtectedBrokerOrder({ ...base, currentAsk: 120.021, tickSize: 0.05 });
  assert.equal(r.decision, "BUILD");
  assert.equal(r.intent?.price, 120.05);
});

test("blocks SENSEX on wrong exchange", () => {
  const r = buildProtectedBrokerOrder({ ...base, symbol: "SENSEX", exchange: "NFO" });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("SENSEX_EXCHANGE_MISMATCH"));
});

test("blocks NIFTY on wrong exchange", () => {
  const r = buildProtectedBrokerOrder({ ...base, exchange: "BFO" });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("NSE_INDEX_EXCHANGE_MISMATCH"));
});

test("invalid quantity fails closed", () => {
  const r = buildProtectedBrokerOrder({ ...base, quantity: 0 });
  assert.equal(r.decision, "BLOCK");
  assert.equal(r.failClosed, true);
  assert.equal(r.intent, null);
});

test("invalid slippage policy fails closed", () => {
  const r = buildProtectedBrokerOrder({ ...base, maxEntrySlippagePct: Number.NaN });
  assert.equal(r.decision, "BLOCK");
  assert.ok(r.reasonCodes.includes("INVALID_SLIPPAGE_POLICY"));
});
