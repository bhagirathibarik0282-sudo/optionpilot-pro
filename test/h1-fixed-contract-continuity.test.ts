import test from "node:test";
import assert from "node:assert/strict";
import {
  selectH1TrackedLegs,
  type H1ExpiryInput,
  type H1PremiumInput,
} from "../h1-recorder-adapter.js";

function leg(strike: number, optionType: "CE" | "PE"): H1PremiumInput {
  return {
    strike,
    optionType,
    isAtm: strike === 24_000,
    expiryDate: "2026-10-08",
    expiryBucket: "Current",
    bid: 99,
    ask: 101,
    lastPrice: 100,
    iv: 12,
    oi: 1_000,
    volume: 500,
    quoteTimestamp: "2026-10-04T04:00:00.000Z",
    dayHigh: 120,
    dayLow: 80,
    pdh: 115,
    pdl: 85,
    vega: 4,
    theta: -5,
    delta: optionType === "CE" ? 0.5 : -0.5,
    gamma: 0.001,
  };
}

function expiry(): H1ExpiryInput {
  const strikes = Array.from({ length: 21 }, (_, i) => 23_500 + i * 50);
  return {
    expiry: "Current",
    expiryDate: new Date("2026-10-08T00:00:00+05:30"),
    ceStrikes: strikes.map((strike) => leg(strike, "CE")),
    peStrikes: strikes.map((strike) => leg(strike, "PE")),
  };
}

test("retains exact candidate and wall contracts after they drift outside ATM ±7", () => {
  const candidateKey = "NIFTY|2026-10-08|23500|CE";
  const wallKey = "NIFTY|2026-10-08|24450|PE";
  const rows = selectH1TrackedLegs(
    expiry(),
    "NIFTY",
    "2026-10-08",
    24_000,
    new Set([candidateKey]),
    new Set([wallKey]),
  );

  const keys = rows.map((row) => `NIFTY|2026-10-08|${row.strike}|${row.optionType}`);
  assert.equal(keys.includes(candidateKey), true);
  assert.equal(keys.includes(wallKey), true);
  assert.equal(keys.includes("NIFTY|2026-10-08|24500|CE"), false);
  assert.equal(new Set(keys).size, keys.length);
});

test("keeps ordinary rolling ATM ±7 coverage when no exact contract is tracked", () => {
  const rows = selectH1TrackedLegs(expiry(), "NIFTY", "2026-10-08", 24_000);
  assert.equal(rows.length, 30);
  assert.equal(rows.every((row) => row.strike >= 23_650 && row.strike <= 24_350), true);
});
