import test from "node:test";
import assert from "node:assert/strict";
import { adaptRecorderSession } from "../option-recorder-source-adapter.js";

function snap(id: string, spot: number, ce: number, pe: number) {
  return {
    snapshotId: id,
    backendTimestamp: "2026-08-28T10:00:00.000Z",
    snapshotStatus: "LIVE",
    NIFTY: {
      spot,
      vwap: 24700,
      pdh: 24800,
      pdl: 24500,
      atmStrike: 24700,
      ceLtp: ce,
      peLtp: pe,
      exchangeTimestamp: "2026-08-28T09:59:50.000Z",
      snapshotId: id,
      ceStrikesNear: [{ strike: 24700, ltp: ce, iv: 12, delta: 0.5, theta: -8, vega: 10, oi: 10000 }],
      peStrikesNear: [{ strike: 24700, ltp: pe, iv: 13, delta: -0.5, theta: -8, vega: 10, oi: 12000 }],
    },
  };
}

test("adapts existing recorder history into NIFTY payload", () => {
  const payloads = adaptRecorderSession({ snapshots: [snap("a", 24690, 90, 110), snap("b", 24710, 100, 100), snap("c", 24730, 115, 90)] } as any);
  assert.equal(payloads.length, 1);
  const p = payloads[0];
  assert.equal(p.market.symbol, "NIFTY");
  assert.equal(p.market.snapshotId, "c");
  assert.equal(p.options.length, 2);
  assert.equal(p.verdicts.find((v) => v.mode === "SCALP")?.direction, "CE");
  assert.equal(p.verdicts.find((v) => v.mode === "TRADER")?.state, "TRADEABLE");
  assert.equal(p.verdicts.find((v) => v.mode === "SWING")?.quality, "UNAVAILABLE");
});

test("filters stale recorder snapshots", () => {
  const stale = snap("x", 24700, 100, 100) as any;
  stale.snapshotStatus = "STALE";
  const payloads = adaptRecorderSession({ snapshots: [stale] } as any);
  assert.equal(payloads.length, 0);
});
