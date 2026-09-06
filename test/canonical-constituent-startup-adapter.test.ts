import assert from "node:assert/strict";
import test from "node:test";
import { prepareCanonicalConstituentStartup } from "../canonical-constituent-startup-adapter.js";

const master = [
  { instrument_token: 101, tradingsymbol: "HDFCBANK", segment: "NSE", exchange: "NSE" },
  { instrument_token: 102, tradingsymbol: "RELIANCE", segment: "NSE", exchange: "NSE" },
  { instrument_token: 201, tradingsymbol: "ICICIBANK", segment: "NSE", exchange: "NSE" },
  { instrument_token: 202, tradingsymbol: "SBIN", segment: "NSE", exchange: "NSE" },
];

function config(rows: unknown[]): string {
  return JSON.stringify(rows);
}

test("resolves only explicit owner-approved requests against exact Kite master", () => {
  const out = prepareCanonicalConstituentStartup(master, config([
    { parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 12 },
    { parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "RELIANCE", sector: "ENERGY", weight: 10 },
    { parentSymbol: "SENSEX", role: "HEAVYWEIGHT", tradingsymbol: "ICICIBANK", sector: "BANK", weight: 8 },
    { parentSymbol: "SENSEX", role: "SECTOR_CONSTITUENT", tradingsymbol: "SBIN", sector: "BANK", weight: 4 },
  ]));
  assert.equal(out.configured, true);
  assert.equal(out.ready, true);
  assert.equal(out.requestCount, 4);
  assert.deepEqual(out.registry.map((entry) => entry.instrumentToken), [101,102,201,202]);
  assert.equal(out.source, "OWNER_APPROVED_JSON_PLUS_KITE_INSTRUMENT_MASTER");
  assert.equal(out.infersMembership, false);
  assert.equal(out.affectsDirection, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.failClosed, true);
});

test("missing config stays unconfigured and never guesses constituents", () => {
  const out = prepareCanonicalConstituentStartup(master, "");
  assert.equal(out.configured, false);
  assert.equal(out.ready, false);
  assert.deepEqual(out.registry, []);
  assert.deepEqual(out.blockers, ["CANONICAL_CONSTITUENT_REQUESTS_NOT_CONFIGURED"]);
});

test("invalid JSON and missing exact master contract fail closed", () => {
  const invalid = prepareCanonicalConstituentStartup(master, "{bad");
  assert.equal(invalid.ready, false);
  assert.deepEqual(invalid.registry, []);
  assert.ok(invalid.blockers.includes("CANONICAL_CONSTITUENT_REQUESTS_JSON_INVALID"));

  const missing = prepareCanonicalConstituentStartup(master, config([
    { parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "UNKNOWN", sector: "BANK", weight: 1 },
    { parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "RELIANCE", sector: "ENERGY", weight: 10 },
  ]));
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.registry, []);
  assert.match(missing.blockers.join("|"), /CANONICAL_CONSTITUENT_NOT_UNIQUE:UNKNOWN:0/);
});

test("each configured symbol requires separate heavyweight and sector coverage", () => {
  const out = prepareCanonicalConstituentStartup(master, config([
    { parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 12 },
  ]));
  assert.equal(out.ready, false);
  assert.deepEqual(out.registry, []);
  assert.ok(out.blockers.includes("CANONICAL_SECTOR_BREADTH_REQUIRED:NIFTY"));
});

test("ambiguous master identity and duplicate ownership fail closed", () => {
  const ambiguous = [...master, { instrument_token: 999, tradingsymbol: "HDFCBANK", segment: "NSE", exchange: "NSE" }];
  const out = prepareCanonicalConstituentStartup(ambiguous, config([
    { parentSymbol: "NIFTY", role: "HEAVYWEIGHT", tradingsymbol: "HDFCBANK", sector: "BANK", weight: 12 },
    { parentSymbol: "NIFTY", role: "SECTOR_CONSTITUENT", tradingsymbol: "RELIANCE", sector: "ENERGY", weight: 10 },
  ]));
  assert.equal(out.ready, false);
  assert.deepEqual(out.registry, []);
  assert.match(out.blockers.join("|"), /CANONICAL_CONSTITUENT_NOT_UNIQUE:HDFCBANK:2/);
});
