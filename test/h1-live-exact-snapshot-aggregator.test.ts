import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateH1LiveExactSnapshot,
  type H1ExactDepthObservation,
  type H1ExactPriceGreekObservation,
} from "../h1-live-exact-snapshot-aggregator.js";

const pg: H1ExactPriceGreekObservation = {
  source: "LIVE_RUNTIME_EXACT",
  symbol: "NIFTY",
  expiryDate: "2026-09-08",
  strike: 24000,
  side: "CE",
  dte: 5,
  observedAt: "2026-09-03T10:00:00.000Z",
  ltp: 120,
  delta: 0.52,
  gamma: 0.004,
  theta: -8.2,
  iv: 14.5,
};

const depth: H1ExactDepthObservation = {
  source: "LIVE_RUNTIME_EXACT",
  symbol: "NIFTY",
  expiryDate: "2026-09-08",
  strike: 24000,
  side: "CE",
  dte: 5,
  observedAt: "2026-09-03T10:00:00.500Z",
  receivedAt: "2026-09-03T10:00:00.700Z",
  bid: 119.5,
  ask: 120.5,
  bidQty: 300,
  askQty: 250,
  lotQuantity: 75,
};

test("ready only for same-contract fresh exact observations", () => {
  const out = aggregateH1LiveExactSnapshot(pg, depth, "2026-09-03T10:00:01.000Z");
  assert.equal(out.ready, true);
  assert.deepEqual(out.blockers, []);
  assert.equal(out.identity?.strike, 24000);
});

test("fails closed when either observation is missing", () => {
  assert.equal(aggregateH1LiveExactSnapshot(pg, null, "2026-09-03T10:00:01.000Z").ready, false);
  assert.equal(aggregateH1LiveExactSnapshot(null, depth, "2026-09-03T10:00:01.000Z").ready, false);
});

test("rejects cross-contract mixing", () => {
  const out = aggregateH1LiveExactSnapshot(pg, { ...depth, strike: 24050 }, "2026-09-03T10:00:01.000Z");
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("CONTRACT_IDENTITY_MISMATCH"));
});

test("rejects stale and excessive cross-source skew", () => {
  const stale = aggregateH1LiveExactSnapshot(pg, depth, "2026-09-03T10:00:10.000Z", 5_000, 2_000);
  assert.equal(stale.ready, false);
  assert.ok(stale.blockers.includes("STALE_EVIDENCE"));

  const skew = aggregateH1LiveExactSnapshot(pg, { ...depth, observedAt: "2026-09-03T10:00:03.500Z", receivedAt: "2026-09-03T10:00:03.700Z" }, "2026-09-03T10:00:04.000Z", 5_000, 2_000);
  assert.equal(skew.ready, false);
  assert.ok(skew.blockers.includes("CROSS_SOURCE_TIME_SKEW_TOO_LARGE"));
});

test("rejects future evidence and invalid receive chronology", () => {
  const future = aggregateH1LiveExactSnapshot(pg, { ...depth, receivedAt: "2026-09-03T10:00:02.000Z" }, "2026-09-03T10:00:01.000Z");
  assert.equal(future.ready, false);
  assert.ok(future.blockers.includes("FUTURE_EVIDENCE"));

  const chronology = aggregateH1LiveExactSnapshot(pg, { ...depth, receivedAt: "2026-09-03T09:59:59.000Z" }, "2026-09-03T10:00:01.000Z");
  assert.equal(chronology.ready, false);
  assert.ok(chronology.blockers.includes("INVALID_DEPTH_RECEIVE_CHRONOLOGY"));
});

test("rejects normalized invalid calendar dates", () => {
  const out = aggregateH1LiveExactSnapshot({ ...pg, expiryDate: "2026-02-31" }, { ...depth, expiryDate: "2026-02-31" }, "2026-09-03T10:00:01.000Z");
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("INVALID_PRICE_GREEK_OBSERVATION"));
  assert.ok(out.blockers.includes("INVALID_DEPTH_OBSERVATION"));
});

test("rejects non-exact provenance through runtime validation", () => {
  const fakePg = { ...pg, source: "RESEARCH_SHADOW_ONLY" } as unknown as H1ExactPriceGreekObservation;
  const out = aggregateH1LiveExactSnapshot(fakePg, depth, "2026-09-03T10:00:01.000Z");
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("INVALID_PRICE_GREEK_OBSERVATION"));
});
