import test from "node:test";
import assert from "node:assert/strict";
import { buildContractBoundHistoryPoint, buildContractPairIdentity } from "../telegram-contract-history-bridge-v1.ts";

function option(side: "CE" | "PE", values: Partial<Record<string, unknown>> = {}) {
  return {
    instrumentToken: side === "CE" ? 101 : 102,
    tradingSymbol: `NIFTY26SEP23350${side}`,
    expiryDate: "2026-09-15",
    strike: 23350,
    optionType: side,
    lastPrice: side === "CE" ? 60 : 55,
    oi: side === "CE" ? 1_000 : 1_200,
    iv: side === "CE" ? 12 : 13,
    ...values,
  };
}

function snapshot(ce = option("CE", { lastPrice: 50, oi: 900, iv: 11 }), pe = option("PE", { lastPrice: 50, oi: 1_000, iv: 12 })) {
  return {
    expiries: [{ ceStrikes: [ce], peStrikes: [pe] }],
    futuresContracts: [{ tradingsymbol: "NIFTY26SEPFUT", expiry: "2026-09-29", ltp: 23370 }],
  };
}

test("derives premium, OI, IV and futures history only from the exact same contracts", () => {
  const point = buildContractBoundHistoryPoint({
    symbol: "NIFTY",
    previousSnapshot: snapshot(),
    currentCe: option("CE"),
    currentPe: option("PE"),
    currentFuture: { tradingsymbol: "NIFTY26SEPFUT", expiry: "2026-09-29", ltp: 23390 },
  });

  assert.equal(point.pair.ready, true);
  assert.equal(point.pair.label, "NIFTY 2026-09-15 23350 CE/PE");
  assert.equal(point.futureChange, 20);
  assert.equal(point.cePremiumChangePct, 20);
  assert.equal(point.pePremiumChangePct, 10);
  assert.ok(Math.abs(Number(point.ceOiChangePct) - 11.1111111111) < 1e-8);
  assert.equal(point.peOiChangePct, 20);
  assert.equal(point.ceIvChange, 1);
  assert.equal(point.peIvChange, 1);
  assert.equal(point.failClosed, true);
});

test("contract roll fails closed instead of falling back to strike or ATM", () => {
  const point = buildContractBoundHistoryPoint({
    symbol: "NIFTY",
    previousSnapshot: snapshot(option("CE", { instrumentToken: 201 }), option("PE", { instrumentToken: 202 })),
    currentCe: option("CE"),
    currentPe: option("PE"),
    currentFuture: { tradingsymbol: "NIFTY26OCTFUT", expiry: "2026-10-27", ltp: 23400 },
  });

  assert.equal(point.cePremiumChangePct, null);
  assert.equal(point.pePremiumChangePct, null);
  assert.equal(point.futureChange, null);
  assert.ok(point.blockers.includes("PREVIOUS_CE_EXACT_CONTRACT_UNAVAILABLE"));
  assert.ok(point.blockers.includes("PREVIOUS_PE_EXACT_CONTRACT_UNAVAILABLE"));
  assert.ok(point.blockers.includes("PREVIOUS_FUTURE_EXACT_CONTRACT_UNAVAILABLE"));
});

test("CE and PE from different strikes cannot be described as one pair", () => {
  const pair = buildContractPairIdentity("NIFTY", option("CE"), option("PE", { strike: 23400 }));
  assert.equal(pair.ready, false);
  assert.equal(pair.label, null);
  assert.ok(pair.blockers.includes("CURRENT_CE_PE_PAIR_MISMATCH"));
});
