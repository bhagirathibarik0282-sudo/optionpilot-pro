import test from "node:test";
import assert from "node:assert/strict";
import { aggregateH1LiveExactSnapshot } from "../h1-live-exact-snapshot-aggregator.ts";
import { buildBusinessExactEconomics } from "../business-exact-economics-v1.ts";

function bundle(observedAt: string, ltp: number, bid: number, ask: number, bidQty: number, askQty: number) {
  return aggregateH1LiveExactSnapshot(
    {
      source: "LIVE_RUNTIME_EXACT",
      symbol: "NIFTY",
      expiryDate: "2026-09-08",
      strike: 24100,
      side: "CE",
      dte: 1,
      observedAt,
      ltp,
      delta: 0.55,
      gamma: 0.012,
      theta: -2.5,
      iv: 14.2,
    },
    {
      source: "LIVE_RUNTIME_EXACT",
      symbol: "NIFTY",
      expiryDate: "2026-09-08",
      strike: 24100,
      side: "CE",
      dte: 1,
      observedAt,
      receivedAt: observedAt,
      bid,
      ask,
      bidQty,
      askQty,
      lotQuantity: 75,
    },
    observedAt,
    5_000,
    2_000,
  );
}

test("computes raw exact option-buying economics without ranking authority", () => {
  const previous = bundle("2026-09-07T09:30:00.000+05:30", 100, 99, 101, 300, 150);
  const current = bundle("2026-09-07T09:31:00.000+05:30", 110, 109, 111, 450, 150);
  const out = buildBusinessExactEconomics(previous, current);
  assert.equal(out.ready, true);
  assert.equal(out.premiumMovePct, 10);
  assert.ok((out.depthImbalance ?? 0) > 0);
  assert.ok((out.micropricePressure ?? 0) > 0);
  assert.equal(out.affectsCandidateAuthority, false);
  assert.equal(out.affectsStars, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.createsOrders, false);
});

test("fails closed on contract mismatch", () => {
  const previous = bundle("2026-09-07T09:30:00.000+05:30", 100, 99, 101, 300, 150);
  const current = bundle("2026-09-07T09:31:00.000+05:30", 110, 109, 111, 450, 150);
  current.identity!.strike = 24150;
  const out = buildBusinessExactEconomics(previous, current);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("CONTRACT_IDENTITY_MISMATCH"));
});
