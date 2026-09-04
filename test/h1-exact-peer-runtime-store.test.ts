import assert from "node:assert/strict";
import test from "node:test";
import { H1ExactPeerRuntimeStore } from "../h1-exact-peer-runtime-store.js";
import type { H1ExactSnapshotBundle } from "../h1-live-exact-snapshot-aggregator.js";

const registry = [
  { instrumentToken: 101, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W1-24000-CE", expiry: "2026-09-08", strike: 24000, optionSide: "CE" },
  { instrumentToken: 102, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W2-24000-CE", expiry: "2026-09-15", strike: 24000, optionSide: "CE" },
  { instrumentToken: 103, symbol: "NIFTY", role: "OPTION", instrumentLabel: "NIFTY-W2-24000-PE", expiry: "2026-09-15", strike: 24000, optionSide: "PE" },
] as any;

function bundle(expiryDate: string, side: "CE" | "PE", dte: number, at: string, ltp: number): H1ExactSnapshotBundle {
  const identity = { symbol: "NIFTY" as const, expiryDate, strike: 24000, side, dte };
  return {
    version: "H1_LIVE_EXACT_SNAPSHOT_AGGREGATOR_V1",
    ready: true,
    identity,
    observedAt: at,
    priceGreek: { ...identity, source: "LIVE_RUNTIME_EXACT", observedAt: at, ltp, delta: 0.5, gamma: 0.01, theta: -1, iv: 15 },
    depth: { ...identity, source: "LIVE_RUNTIME_EXACT", observedAt: at, receivedAt: at, bid: ltp - 0.1, ask: ltp + 0.1, bidQty: 300, askQty: 300, lotQuantity: 150 },
    blockers: [],
    failClosed: true,
    semantics: "SAME_CONTRACT_LIVE_RUNTIME_EXACT_ONLY",
  };
}

function store(directionByToken: Record<number, "UP" | "DOWN"> = { 101: "UP", 102: "UP", 103: "DOWN" }) {
  return new H1ExactPeerRuntimeStore({
    registryEntries: registry,
    classifierPolicy: { maxObservationGapMs: 10_000, minAbsolutePremiumMovePct: 1 },
    maxObservationAgeMs: 30_000,
    requiredPeerCount: 1,
    expectedDirectionFor: (entry) => directionByToken[entry.instrumentToken] as "UP" | "DOWN",
  });
}

test("stores exact classified observation and fails closed until a different-expiry peer exists", () => {
  const s = store();
  const out = s.ingestAndResolve(
    101,
    bundle("2026-09-08", "CE", 4, "2026-09-04T04:00:00.000Z", 100),
    bundle("2026-09-08", "CE", 4, "2026-09-04T04:00:05.000Z", 103),
    "2026-09-04T04:00:05.000Z",
  );
  assert.equal(out.ready, false);
  assert.equal(out.classifier?.directionalState, "SUPPORTS");
  assert.equal(s.getObservationCount(), 1);
  assert.ok(out.blockers.includes("RESOLVER_INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS"));
});

test("resolves only same-symbol same-side different-expiry exact observations", () => {
  const s = store();
  s.ingestAndResolve(101,
    bundle("2026-09-08", "CE", 4, "2026-09-04T04:00:00.000Z", 100),
    bundle("2026-09-08", "CE", 4, "2026-09-04T04:00:05.000Z", 103),
    "2026-09-04T04:00:05.000Z");

  const out = s.ingestAndResolve(102,
    bundle("2026-09-15", "CE", 11, "2026-09-04T04:00:06.000Z", 200),
    bundle("2026-09-15", "CE", 11, "2026-09-04T04:00:10.000Z", 206),
    "2026-09-04T04:00:10.000Z");

  assert.equal(out.ready, true);
  assert.equal(out.resolver?.peers.length, 1);
  assert.equal(out.resolver?.peers[0].expiryDate, "2026-09-08");
  assert.equal(out.resolver?.peers[0].side, "CE");
  assert.equal(out.resolver?.peers[0].directionalState, "SUPPORTS");
  assert.equal(out.affectsExecution, false);
  assert.equal(out.productionImpact, "NONE");
});

test("opposite option side never becomes a peer", () => {
  const s = store();
  s.ingestAndResolve(103,
    bundle("2026-09-15", "PE", 11, "2026-09-04T04:00:00.000Z", 100),
    bundle("2026-09-15", "PE", 11, "2026-09-04T04:00:05.000Z", 97),
    "2026-09-04T04:00:05.000Z");

  const out = s.ingestAndResolve(101,
    bundle("2026-09-08", "CE", 4, "2026-09-04T04:00:06.000Z", 100),
    bundle("2026-09-08", "CE", 4, "2026-09-04T04:00:10.000Z", 103),
    "2026-09-04T04:00:10.000Z");

  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("RESOLVER_INSUFFICIENT_EXACT_MULTI_EXPIRY_PEERS"));
});

test("missing explicit expected direction fails closed without storing observation", () => {
  const s = store({ 101: undefined as never, 102: "UP", 103: "DOWN" });
  const out = s.ingestAndResolve(101,
    bundle("2026-09-08", "CE", 4, "2026-09-04T04:00:00.000Z", 100),
    bundle("2026-09-08", "CE", 4, "2026-09-04T04:00:05.000Z", 103),
    "2026-09-04T04:00:05.000Z");
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes("CLASSIFIER_MISSING_OR_INVALID_EXPECTED_PREMIUM_DIRECTION"));
  assert.equal(s.getObservationCount(), 0);
});
