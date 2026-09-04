import test from "node:test";
import assert from "node:assert/strict";
import { buildH1CanonicalRegistryFromKiteMaster } from "../h1-kite-master-canonical-registry-bridge.js";

const rows = [
  { instrument_token: 256265, tradingsymbol: "NIFTY 50", name: "NIFTY 50", segment: "INDICES", exchange: "NSE" },
  { instrument_token: 1001, tradingsymbol: "NIFTY26SEPFUT", name: "NIFTY", expiry: "2026-09-24", instrument_type: "FUT", segment: "NFO-FUT", exchange: "NFO" },
  { instrument_token: 2001, tradingsymbol: "NIFTY26SEP24000CE", name: "NIFTY", expiry: "2026-09-24", strike: 24000, instrument_type: "CE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 2002, tradingsymbol: "NIFTY26SEP24000PE", name: "NIFTY", expiry: "2026-09-24", strike: 24000, instrument_type: "PE", segment: "NFO-OPT", exchange: "NFO" },
  { instrument_token: 264969, tradingsymbol: "INDIA VIX", name: "INDIA VIX", segment: "INDICES", exchange: "NSE" },
];

const request = {
  symbols: ["NIFTY"] as const,
  expiryBySymbol: { NIFTY: "2026-09-24" },
  strikesBySymbol: { NIFTY: [24000] },
};

test("builds canonical registry from exact Kite master rows without token inference", () => {
  const result = buildH1CanonicalRegistryFromKiteMaster(rows, request as any);
  assert.equal(result.ready, true);
  assert.equal(result.source, "KITE_INSTRUMENT_MASTER_EXACT");
  assert.equal(result.inferredTokens, false);
  assert.equal(result.productionImpact, "NONE");
  assert.equal(result.failClosed, true);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.entries.length, 5);
  const option = result.entries.find((x) => x.instrumentToken === 2001);
  assert.equal(option?.role, "OPTION");
  assert.equal(option?.expiry, "2026-09-24");
  assert.equal(option?.strike, 24000);
  assert.equal(option?.optionSide, "CE");
});

test("fails closed with no partial registry when requested option is absent", () => {
  const missingPe = rows.filter((row) => row.instrument_token !== 2002);
  const result = buildH1CanonicalRegistryFromKiteMaster(missingPe, request as any);
  assert.equal(result.ready, false);
  assert.deepEqual(result.entries, []);
  assert.equal(result.inferredTokens, false);
  assert.match(result.blockers[0] ?? "", /KITE_OPTION_NOT_UNIQUE/);
});

test("fails closed on ambiguous exact option identity", () => {
  const duplicate = [...rows, { ...rows[2], instrument_token: 2999 }];
  const result = buildH1CanonicalRegistryFromKiteMaster(duplicate, request as any);
  assert.equal(result.ready, false);
  assert.deepEqual(result.entries, []);
  assert.match(result.blockers[0] ?? "", /KITE_OPTION_NOT_UNIQUE/);
});
