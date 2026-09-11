import test from "node:test";
import assert from "node:assert/strict";
import { buildExactWatchFeed } from "../telegram-z-watch-exact-feed-v1.ts";
import type { H1ExactSnapshotBundle } from "../h1-live-exact-snapshot-aggregator.ts";

function snap(side: "CE"|"PE", observedAt: string, ltp: number, bid: number, ask: number): H1ExactSnapshotBundle {
  return {
    version: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1",
    ready: true,
    identity: { symbol: "NIFTY", expiryDate: "2026-09-15", strike: 24000, side, dte: 4 },
    observedAt,
    priceGreek: { source: "LIVE_RUNTIME_EXACT", symbol: "NIFTY", expiryDate: "2026-09-15", strike: 24000, side, dte: 4, observedAt, ltp, delta: side === "CE" ? 0.5 : -0.5, gamma: 0.001, theta: -5, iv: 12 },
    depth: { source: "LIVE_RUNTIME_EXACT", symbol: "NIFTY", expiryDate: "2026-09-15", strike: 24000, side, dte: 4, observedAt, receivedAt: observedAt, bid, ask, bidQty: 100, askQty: 100, lotQuantity: 65 },
    blockers: [], failClosed: true, semantics: "SAME_CONTRACT_LIVE_RUNTIME_EXACT_ONLY",
  };
}

test("builds exact CE/PE 3m premium and spread without inventing futures or OI", () => {
  const r = buildExactWatchFeed({
    symbol: "NIFTY",
    cePrevious: snap("CE", "2026-09-11T04:00:00.000Z", 100, 99, 101),
    ceCurrent: snap("CE", "2026-09-11T04:03:00.000Z", 110, 109, 111),
    pePrevious: snap("PE", "2026-09-11T04:00:00.000Z", 120, 119, 121),
    peCurrent: snap("PE", "2026-09-11T04:03:00.000Z", 108, 107, 109),
  });
  assert.equal(r.ce.ready, true);
  assert.equal(r.pe.ready, true);
  assert.equal(r.ce.premium3mPct, 10);
  assert.equal(r.pe.premium3mPct, -10);
  assert.equal(r.future3m, null);
  assert.equal(r.ceOi3m, null);
  assert.equal(r.peOi3m, null);
});

test("fails closed when pair is not approximately 3 minutes", () => {
  const r = buildExactWatchFeed({
    symbol: "NIFTY",
    cePrevious: snap("CE", "2026-09-11T04:00:00.000Z", 100, 99, 101),
    ceCurrent: snap("CE", "2026-09-11T04:06:00.000Z", 110, 109, 111),
    pePrevious: null,
    peCurrent: null,
  });
  assert.equal(r.ce.ready, false);
  assert.equal(r.ce.premium3mPct, null);
  assert.ok(r.ce.blockers.includes("NOT_A_3M_EXACT_PAIR"));
});

test("fails closed on contract identity mismatch", () => {
  const prev = snap("CE", "2026-09-11T04:00:00.000Z", 100, 99, 101);
  const curr = snap("CE", "2026-09-11T04:03:00.000Z", 110, 109, 111);
  curr.identity = { ...curr.identity!, strike: 24050 };
  const r = buildExactWatchFeed({ symbol: "NIFTY", cePrevious: prev, ceCurrent: curr, pePrevious: null, peCurrent: null });
  assert.equal(r.ce.ready, false);
  assert.ok(r.ce.blockers.includes("CONTRACT_IDENTITY_MISMATCH"));
});
