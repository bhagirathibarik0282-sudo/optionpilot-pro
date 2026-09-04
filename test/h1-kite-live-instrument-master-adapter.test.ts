import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchH1KiteLiveInstrumentMaster,
  parseKiteInstrumentMasterCsv,
} from "../h1-kite-live-instrument-master-adapter.js";

const csv = [
  "instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange",
  "256265,1001,NIFTY 50,NIFTY 50,0,,0,0.05,1,EQ,INDICES,NSE",
  "1001,2001,NIFTY26SEPFUT,NIFTY,0,2026-09-24,0,0.05,65,FUT,NFO-FUT,NFO",
  "2001,3001,NIFTY26SEP24000CE,NIFTY,0,2026-09-24,24000,0.05,65,CE,NFO-OPT,NFO",
  "2002,3002,NIFTY26SEP24000PE,NIFTY,0,2026-09-24,24000,0.05,65,PE,NFO-OPT,NFO",
  "264969,1002,INDIA VIX,INDIA VIX,0,,0,0.05,1,EQ,INDICES,NSE",
].join("\n");

test("parses exact Kite instrument-master CSV metadata", () => {
  const rows = parseKiteInstrumentMasterCsv(csv);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[2], {
    instrument_token: 2001,
    tradingsymbol: "NIFTY26SEP24000CE",
    name: "NIFTY",
    expiry: "2026-09-24",
    strike: 24000,
    instrument_type: "CE",
    segment: "NFO-OPT",
    exchange: "NFO",
  });
});

test("fetches only the authenticated Kite metadata endpoint and never exposes credentials", async () => {
  let seenUrl = "";
  let seenAuth = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenAuth = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(csv, { status: 200, headers: { "content-type": "text/csv" } });
  };
  const out = await fetchH1KiteLiveInstrumentMaster({ apiKey: "api", accessToken: "secret", fetchImpl });
  assert.equal(out.ready, true);
  assert.equal(out.rows.length, 5);
  assert.equal(out.credentialsExposed, false);
  assert.equal(out.source, "KITE_REST_INSTRUMENT_MASTER_METADATA_ONLY");
  assert.equal(out.immediateMarketDataSource, "KITE_WEBSOCKET_ONLY");
  assert.equal(seenUrl, "https://api.kite.trade/instruments");
  assert.equal(seenAuth, "token api:secret");
  assert.equal(JSON.stringify(out).includes("secret"), false);
});

test("missing credentials fail closed without calling fetch", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error("must not run");
  };
  const out = await fetchH1KiteLiveInstrumentMaster({ apiKey: "", accessToken: "", fetchImpl });
  assert.equal(out.ready, false);
  assert.deepEqual(out.rows, []);
  assert.equal(calls, 0);
});

test("HTTP, malformed CSV and invalid content type fail closed with no partial rows", async () => {
  const http = await fetchH1KiteLiveInstrumentMaster({
    apiKey: "api", accessToken: "token",
    fetchImpl: async () => new Response("forbidden", { status: 403 }) as any,
  });
  assert.equal(http.ready, false);
  assert.deepEqual(http.rows, []);
  assert.deepEqual(http.blockers, ["KITE_INSTRUMENT_MASTER_HTTP_403"]);

  const malformed = await fetchH1KiteLiveInstrumentMaster({
    apiKey: "api", accessToken: "token",
    fetchImpl: async () => new Response("instrument_token,tradingsymbol\nabc,NIFTY", { status: 200, headers: { "content-type": "text/csv" } }) as any,
  });
  assert.equal(malformed.ready, false);
  assert.deepEqual(malformed.rows, []);

  const wrongType = await fetchH1KiteLiveInstrumentMaster({
    apiKey: "api", accessToken: "token",
    fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }) as any,
  });
  assert.equal(wrongType.ready, false);
  assert.deepEqual(wrongType.blockers, ["KITE_INSTRUMENT_MASTER_CONTENT_TYPE_INVALID"]);
});
