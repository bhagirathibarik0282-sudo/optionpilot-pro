import test from "node:test";
import assert from "node:assert/strict";
import { KiteImmediateTokenRegistry } from "../kite-immediate-token-registry.js";
import { KiteImmediateRuntimeCore } from "../kite-immediate-runtime-core.js";

function packet(value: number, second: number) {
  return {
    mode: "full" as const,
    instrumentToken: 1001,
    lastPrice: value,
    oi: 100000,
    exchangeTimestamp: new Date(Date.UTC(2026, 7, 31, 6, 0, second)).toISOString(),
    lastTradeTimestamp: new Date(Date.UTC(2026, 7, 31, 6, 0, second)).toISOString(),
    isIndex: false,
  };
}

test("WebSocket packet flows through adaptive detector, T0 cluster and deterministic verdict", async () => {
  const registry = new KiteImmediateTokenRegistry([{ instrumentToken: 1001, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY26SEP24000CE", expiry: "2026-09-01", strike: 24000, optionSide: "CE" }]);
  const decisions: string[] = [];
  const runtime = new KiteImmediateRuntimeCore({
    registry,
    cluster: { windowMs: 10_000, minSupportingFamilies: 1, minEvents: 1 },
    trendFor: () => ({ side: "CE", valid: true }),
    onDecision: (result) => { decisions.push(result.verdict); },
  });
  const values = [100, 100.2, 100.1, 100.3, 100.2, 100.4, 100.3, 100.5, 115];
  let last;
  for (let i = 0; i < values.length; i++) {
    last = await runtime.ingestPacket(packet(values[i], i), new Date(Date.UTC(2026, 7, 31, 6, 0, i, 100)).toISOString());
  }
  assert.equal(last?.freshEventsAdded, 1);
  assert.equal(last?.decision?.verdict, "CE_FAVOURED");
  assert.deepEqual(decisions, ["CE_FAVOURED"]);
});

test("unregistered token is ignored without producing a decision", async () => {
  const registry = new KiteImmediateTokenRegistry([{ instrumentToken: 1001, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY26SEP24000CE", expiry: "2026-09-01", strike: 24000, optionSide: "CE" }]);
  const runtime = new KiteImmediateRuntimeCore({ registry, cluster: { windowMs: 10_000, minSupportingFamilies: 1, minEvents: 1 }, trendFor: () => ({ side: "NONE", valid: false }) });
  const result = await runtime.ingestPacket({ ...packet(100, 0), instrumentToken: 9999 }, "2026-08-31T06:00:00.100Z");
  assert.equal(result.ignoredReason, "UNREGISTERED_INSTRUMENT_TOKEN");
  assert.equal(result.decision, null);
});
