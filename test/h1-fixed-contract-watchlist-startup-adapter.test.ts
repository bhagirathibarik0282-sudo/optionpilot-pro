import assert from "node:assert/strict";
import test from "node:test";
import { H1_FIXED_CONTRACT_WATCHLIST_MAX_CONTRACTS, prepareH1FixedContractWatchlistStartup } from "../h1-fixed-contract-watchlist-startup-adapter.js";

const master = [
  { instrument_token: 101, tradingsymbol: "NIFTY26SEP24000CE", name: "NIFTY", expiry: "2026-09-24", strike: 24000, instrument_type: "CE", segment: "NFO-OPT" },
  { instrument_token: 102, tradingsymbol: "NIFTY26SEP24000PE", name: "NIFTY", expiry: "2026-09-24", strike: 24000, instrument_type: "PE", segment: "NFO-OPT" },
  { instrument_token: 201, tradingsymbol: "SENSEX26SEP81000CE", name: "SENSEX", expiry: "2026-09-24", strike: 81000, instrument_type: "CE", segment: "BFO-OPT" },
  { instrument_token: 301, tradingsymbol: "BANKNIFTY26SEP55000CE", name: "BANKNIFTY", expiry: "2026-09-24", strike: 55000, instrument_type: "CE", segment: "NFO-OPT" },
  { instrument_token: 302, tradingsymbol: "BANKNIFTY26SEP55000PE", name: "BANKNIFTY", expiry: "2026-09-30", strike: 55000, instrument_type: "PE", segment: "NFO-OPT" },
  { instrument_token: 303, tradingsymbol: "BANKNIFTY26SEP56000CE", name: "BANKNIFTY", expiry: "2026-09-30", strike: 56000, instrument_type: "CE", segment: "NFO-OPT" },
];

test("resolves explicit NIFTY/SENSEX DTE 0-4 and BANKNIFTY monthly contracts", () => {
  const out = prepareH1FixedContractWatchlistStartup(master, "2026-09-21", JSON.stringify([
    { symbol: "NIFTY", expiry: "2026-09-24", strike: 24000, side: "CE" },
    { symbol: "SENSEX", expiry: "2026-09-24", strike: 81000, side: "CE" },
    { symbol: "BANKNIFTY", expiry: "2026-09-30", strike: 55000, side: "PE" },
  ]));
  assert.equal(out.ready, true);
  assert.equal(out.requestCount, 3);
  assert.deepEqual(out.registry.map((entry) => entry.instrumentToken), [101, 201, 302]);
  assert.equal(out.maxContracts, 24);
  assert.equal(out.observationalOnly, true);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("missing configuration remains disabled without guessing a contract", () => {
  const out = prepareH1FixedContractWatchlistStartup(master, "2026-09-21", "");
  assert.equal(out.configured, false);
  assert.equal(out.ready, false);
  assert.deepEqual(out.registry, []);
  assert.deepEqual(out.blockers, ["H1_FIXED_CONTRACT_WATCHLIST_NOT_CONFIGURED"]);
});

test("rejects weekly BANKNIFTY, DTE outside 0-4, duplicates, and missing identities", () => {
  const weeklyBank = prepareH1FixedContractWatchlistStartup(master, "2026-09-21", JSON.stringify([
    { symbol: "BANKNIFTY", expiry: "2026-09-24", strike: 55000, side: "CE" },
  ]));
  assert.match(weeklyBank.blockers.join("|"), /BANKNIFTY_MONTHLY_REQUIRED/);

  const farNifty = prepareH1FixedContractWatchlistStartup(master, "2026-09-10", JSON.stringify([
    { symbol: "NIFTY", expiry: "2026-09-24", strike: 24000, side: "CE" },
  ]));
  assert.match(farNifty.blockers.join("|"), /DTE_OUT_OF_RANGE/);

  const duplicate = prepareH1FixedContractWatchlistStartup(master, "2026-09-21", JSON.stringify([
    { symbol: "NIFTY", expiry: "2026-09-24", strike: 24000, side: "CE" },
    { symbol: "NIFTY", expiry: "2026-09-24", strike: 24000, side: "CE" },
  ]));
  assert.match(duplicate.blockers.join("|"), /DUPLICATE/);

  const missing = prepareH1FixedContractWatchlistStartup(master, "2026-09-21", JSON.stringify([
    { symbol: "NIFTY", expiry: "2026-09-24", strike: 24500, side: "CE" },
  ]));
  assert.match(missing.blockers.join("|"), /NOT_UNIQUE.*:0/);
});

test("enforces the bounded contract cap", () => {
  const requests = Array.from({ length: H1_FIXED_CONTRACT_WATCHLIST_MAX_CONTRACTS + 1 }, (_, index) => ({
    symbol: "NIFTY", expiry: "2026-09-24", strike: 24000 + index * 50, side: "CE",
  }));
  const out = prepareH1FixedContractWatchlistStartup(master, "2026-09-21", JSON.stringify(requests));
  assert.equal(out.ready, false);
  assert.match(out.blockers.join("|"), /LIMIT_EXCEEDED:25/);
});
