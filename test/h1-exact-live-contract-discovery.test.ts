import test from "node:test";
import assert from "node:assert/strict";
import { discoverH1ExactLiveContractUniverse } from "../h1-exact-live-contract-discovery.js";

const rows = [
  { instrument_token: 1, tradingsymbol: "NIFTY26SEP24000CE", name: "NIFTY", expiry: "2026-09-10", strike: 24000, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 2, tradingsymbol: "NIFTY26SEP24000PE", name: "NIFTY", expiry: "2026-09-10", strike: 24000, instrument_type: "PE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 3, tradingsymbol: "NIFTY26SEP24100CE", name: "NIFTY", expiry: "2026-09-10", strike: 24100, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 4, tradingsymbol: "NIFTY26SEP24100PE", name: "NIFTY", expiry: "2026-09-10", strike: 24100, instrument_type: "PE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 5, tradingsymbol: "NIFTY26SEP24000CE", name: "NIFTY", expiry: "2026-09-17", strike: 24000, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 6, tradingsymbol: "NIFTY26SEP24000PE", name: "NIFTY", expiry: "2026-09-17", strike: 24000, instrument_type: "PE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 7, tradingsymbol: "NIFTY26AUG24000CE", name: "NIFTY", expiry: "2026-08-27", strike: 24000, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 8, tradingsymbol: "NIFTY26AUG24000PE", name: "NIFTY", expiry: "2026-08-27", strike: 24000, instrument_type: "PE", segment: "NFO-OPT", exchange: "NFO" },
] as any;

test("discovers only non-expired exact expiries and strike ranges without choosing ATM", () => {
  const out = discoverH1ExactLiveContractUniverse(rows, { symbols: ["NIFTY"], asOfDate: "2026-09-04" });
  assert.equal(out.ready, true);
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.rows.map((x) => x.expiry), ["2026-09-10", "2026-09-17"]);
  assert.equal(out.rows[0].minStrike, 24000);
  assert.equal(out.rows[0].maxStrike, 24100);
  assert.equal(out.choosesAtm, false);
  assert.equal(out.activatesShadow, false);
});

test("fails closed when exact CE/PE pairing is incomplete", () => {
  const bad = rows.filter((x: any) => x.instrument_token !== 2);
  const out = discoverH1ExactLiveContractUniverse(bad, { symbols: ["NIFTY"], asOfDate: "2026-09-04" });
  assert.equal(out.ready, true);
  const first = out.rows.find((x) => x.expiry === "2026-09-10")!;
  assert.equal(first.ceCount, 2);
  assert.equal(first.peCount, 1);
});

test("missing symbol universe or invalid date fails closed", () => {
  assert.equal(discoverH1ExactLiveContractUniverse(rows, { symbols: [], asOfDate: "2026-09-04" }).ready, false);
  assert.equal(discoverH1ExactLiveContractUniverse(rows, { symbols: ["NIFTY"], asOfDate: "04-09-2026" }).ready, false);
});
