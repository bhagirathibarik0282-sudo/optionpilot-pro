import test from "node:test";
import assert from "node:assert/strict";
import { auditKiteImmediateRuntimeBlockers } from "../kite-immediate-runtime-blocker-audit.js";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import { mapDecodedKitePacketToImmediate } from "../kite-decoded-tick-immediate-mapper.js";

test("blocker audit fails closed until credentials session runtime and registry are ready", () => {
  const result = auditKiteImmediateRuntimeBlockers({
    apiKeyPresent: false,
    sessionActive: false,
    accessTokenPresent: false,
    websocketRuntimeAvailable: true,
    registryTokenCount: 0,
    coveredSymbols: [],
  });
  assert.equal(result.safeToStartWebSocket, false);
  assert.deepEqual(result.blockers, [
    "KITE_API_KEY_MISSING",
    "KITE_SESSION_INACTIVE",
    "KITE_ACCESS_TOKEN_MISSING",
    "INSTRUMENT_REGISTRY_EMPTY",
    "REQUIRED_SYMBOL_COVERAGE_MISSING",
  ]);
});

test("registry validates option identity and maps exact token", () => {
  const registry = new KiteImmediateTokenRegistry([
    { instrumentToken: 101, symbol: "NIFTY", role: "SPOT", instrumentLabel: "NIFTY 50" },
    { instrumentToken: 102, symbol: "NIFTY", role: "FUTURE", instrumentLabel: "NIFTY FUT" },
    { instrumentToken: 103, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY26SEP24000CE", expiry: "2026-09-01", strike: 24000, optionSide: "CE" },
    { instrumentToken: 104, symbol: "NIFTY", role: "INDIA_VIX", instrumentLabel: "INDIA VIX" },
  ]);
  assert.equal(registry.get(103)?.optionSide, "CE");
  assert.deepEqual(registry.tokens(), [101, 102, 103, 104]);
});

test("decoded option tick becomes CE premium update and preserves OI observation", () => {
  const registry = new KiteImmediateTokenRegistry([
    { instrumentToken: 103, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY26SEP24000CE", expiry: "2026-09-01", strike: 24000, optionSide: "CE" },
  ]);
  const mapped = mapDecodedKitePacketToImmediate({
    mode: "full",
    instrumentToken: 103,
    lastPrice: 121.5,
    oi: 250000,
    exchangeTimestamp: "2026-08-31T06:21:00.000Z",
    lastTradeTimestamp: "2026-08-31T06:21:00.000Z",
    isIndex: false,
  }, registry, "2026-08-31T06:21:00.200Z", "CE");
  assert.equal(mapped.feedTick?.transportSource, "KITE_WEBSOCKET");
  assert.equal(mapped.feedTick?.freshnessVerified, true);
  assert.equal(mapped.feedTick?.updates[0].family, "CE_PREMIUM");
  assert.equal(mapped.feedTick?.updates[0].value, 121.5);
  assert.equal(mapped.optionOi?.oi, 250000);
  assert.equal(mapped.optionOi?.strike, 24000);
});

test("futures OI remains neutral by itself", () => {
  const registry = new KiteImmediateTokenRegistry([
    { instrumentToken: 202, symbol: "BANKNIFTY", role: "FUTURE", instrumentLabel: "BANKNIFTY FUT" },
  ]);
  const mapped = mapDecodedKitePacketToImmediate({
    mode: "full",
    instrumentToken: 202,
    lastPrice: 57500,
    oi: 2000000,
    exchangeTimestamp: "2026-08-31T06:21:00.000Z",
    isIndex: false,
  }, registry, "2026-08-31T06:21:00.100Z", "CE");
  const oi = mapped.feedTick?.updates.find((x) => x.family === "FUTURES_OI");
  assert.equal(oi?.effectWhenRising, "NEUTRAL");
  assert.equal(oi?.effectWhenFalling, "NEUTRAL");
});

test("missing exchange/provider timestamp never gets freshness verified", () => {
  const registry = new KiteImmediateTokenRegistry([
    { instrumentToken: 301, symbol: "SENSEX", role: "SPOT", instrumentLabel: "SENSEX" },
  ]);
  const mapped = mapDecodedKitePacketToImmediate({ mode: "ltp", instrumentToken: 301, lastPrice: 80000, isIndex: false }, registry, "2026-08-31T06:21:00.100Z", "NONE");
  assert.equal(mapped.feedTick?.freshnessVerified, false);
  assert.equal(mapped.feedTick?.occurredAt, "2026-08-31T06:21:00.100Z");
});
