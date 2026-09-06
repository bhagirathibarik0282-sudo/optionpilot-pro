import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalConstituentTokenRegistry } from "../canonical-constituent-token-registry.ts";

const rows = [
  { instrument_token: 101, tradingsymbol: "RELIANCE", name: "RELIANCE INDUSTRIES", segment: "NSE" },
  { instrument_token: 102, tradingsymbol: "HDFCBANK", name: "HDFC BANK", segment: "NSE" },
  { instrument_token: 103, tradingsymbol: "ICICIBANK", name: "ICICI BANK", segment: "NSE" },
];

test("resolves explicit heavyweight and sector constituent only from instrument master", () => {
  const out = buildCanonicalConstituentTokenRegistry(rows, [
    { parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "RELIANCE", weight: 9.5 },
    { parentSymbol: "BANKNIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "HDFCBANK", sector: "PRIVATE_BANK" },
  ]);
  assert.deepEqual(out, [
    { instrumentToken: 101, parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "RELIANCE", sector: null, weight: 9.5, source: "KITE_INSTRUMENT_MASTER" },
    { instrumentToken: 102, parentSymbol: "BANKNIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "HDFCBANK", sector: "PRIVATE_BANK", weight: null, source: "KITE_INSTRUMENT_MASTER" },
  ]);
});

test("fails closed when requested constituent is absent or ambiguous", () => {
  assert.throws(
    () => buildCanonicalConstituentTokenRegistry(rows, [{ parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "TCS" }]),
    /CANONICAL_CONSTITUENT_NOT_UNIQUE:TCS:0/,
  );
  const ambiguous = [...rows, { instrument_token: 999, tradingsymbol: "RELIANCE", name: "DUP", segment: "NSE" }];
  assert.throws(
    () => buildCanonicalConstituentTokenRegistry(ambiguous, [{ parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "RELIANCE" }]),
    /CANONICAL_CONSTITUENT_NOT_UNIQUE:RELIANCE:2/,
  );
});

test("allows one exact token to serve multiple canonical index memberships and roles", () => {
  const out = buildCanonicalConstituentTokenRegistry(rows, [
    { parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", weight: 11 },
    { parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 11 },
    { parentSymbol: "BANKNIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", weight: 28 },
    { parentSymbol: "BANKNIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 28 },
  ]);
  assert.equal(out.length, 4);
  assert.deepEqual([...new Set(out.map((entry) => entry.instrumentToken))], [102]);
  assert.deepEqual(out.map((entry) => `${entry.parentSymbol}:${entry.role}`), [
    "NIFTY:HEAVYWEIGHT",
    "NIFTY:SECTOR_CONSTITUENT",
    "BANKNIFTY:HEAVYWEIGHT",
    "BANKNIFTY:SECTOR_CONSTITUENT",
  ]);
});

test("never infers sector and rejects exact duplicate membership", () => {
  assert.throws(
    () => buildCanonicalConstituentTokenRegistry(rows, [{ parentSymbol: "BANKNIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "ICICIBANK" }]),
    /CANONICAL_SECTOR_REQUIRED:ICICIBANK/,
  );
  assert.throws(
    () => buildCanonicalConstituentTokenRegistry(rows, [
      { parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "RELIANCE" },
      { parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "RELIANCE" },
    ]),
    /CANONICAL_CONSTITUENT_DUPLICATE_REQUEST:NIFTY\|HEAVYWEIGHT\|RELIANCE\|/,
  );
});

test("rejects invented or invalid weights", () => {
  assert.throws(
    () => buildCanonicalConstituentTokenRegistry(rows, [{ parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "RELIANCE", weight: 0 }]),
    /CANONICAL_CONSTITUENT_WEIGHT_INVALID:RELIANCE/,
  );
  assert.throws(
    () => buildCanonicalConstituentTokenRegistry(rows, [{ parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "RELIANCE", weight: 101 }]),
    /CANONICAL_CONSTITUENT_WEIGHT_INVALID:RELIANCE/,
  );
});
