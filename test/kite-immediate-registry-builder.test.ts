import test from "node:test";
import assert from "node:assert/strict";
import { buildKiteImmediateTokenRegistryFromMaster } from "../kite-immediate-registry-builder.js";

const rows = [
  { instrument_token: 1, tradingsymbol: "NIFTY 50", name: "NIFTY 50", segment: "INDICES", instrument_type: "EQ" },
  { instrument_token: 2, tradingsymbol: "NIFTY26SEPFUT", name: "NIFTY", segment: "NFO-FUT", instrument_type: "FUT", expiry: "2026-09-29" },
  { instrument_token: 3, tradingsymbol: "NIFTY26SEP24000CE", name: "", segment: "NFO-OPT", instrument_type: "CE", expiry: "2026-09-01", strike: 24000 },
  { instrument_token: 4, tradingsymbol: "NIFTY26SEP24000PE", name: "", segment: "NFO-OPT", instrument_type: "PE", expiry: "2026-09-01", strike: 24000 },
  { instrument_token: 5, tradingsymbol: "INDIA VIX", name: "INDIA VIX", segment: "INDICES", instrument_type: "EQ" },
];

test("builds exact token registry from instrument-master metadata", () => {
  const registry = buildKiteImmediateTokenRegistryFromMaster(rows, {
    symbols: ["NIFTY"],
    expiryBySymbol: { NIFTY: "2026-09-01" },
    strikesBySymbol: { NIFTY: [24000] },
  });
  assert.deepEqual(registry.tokens(), [1, 2, 3, 4, 5]);
  assert.equal(registry.get(3)?.optionSide, "CE");
  assert.equal(registry.get(4)?.optionSide, "PE");
  assert.equal(registry.get(5)?.role, "INDIA_VIX");
});

test("fails closed when requested option identity is missing", () => {
  assert.throws(() => buildKiteImmediateTokenRegistryFromMaster(rows, {
    symbols: ["NIFTY"],
    expiryBySymbol: { NIFTY: "2026-09-01" },
    strikesBySymbol: { NIFTY: [24050] },
  }), /KITE_OPTION_NOT_UNIQUE/);
});

test("does not confuse BANKNIFTY with NIFTY", () => {
  const mixed = rows.concat([
    { instrument_token: 10, tradingsymbol: "BANKNIFTY", name: "NIFTY BANK", segment: "INDICES", instrument_type: "EQ" },
  ]);
  const registry = buildKiteImmediateTokenRegistryFromMaster(mixed, {
    symbols: ["NIFTY"],
    expiryBySymbol: { NIFTY: "2026-09-01" },
    strikesBySymbol: { NIFTY: [24000] },
  });
  assert.equal(registry.get(1)?.role, "SPOT");
  assert.equal(registry.get(10), null);
});
