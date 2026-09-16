import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";
import {
  observeH1GoldChaseFacts,
  type H1GoldChasePremiumPoint,
} from "../h1-gold-chase-observation-v1.js";

const T = "2026-09-16T06:30:05.000Z";
const T_MS = Date.parse(T);
const FAMILIES: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE",
  "FUTURES_CONFIRMATION",
  "OPTION_PREMIUMS",
  "OI_POSITIONING",
  "MULTI_DTE",
  "VOLATILITY",
  "HEAVYWEIGHTS",
  "SECTOR_BREADTH",
  "RESPONSE_LADDER",
  "LIQUIDITY_EXECUTABILITY",
];

function root(asOfMs = T_MS) {
  const components: CanonicalMarketComponent[] = FAMILIES.map((family, index) => ({
    family,
    status: "VERIFIED",
    exchangeTimestampMs: asOfMs - 5_000,
    receivedAtMs: asOfMs - 4_000,
    processedAtMs: asOfMs - 3_000,
    ingestSeq: index + 1,
    provenance: family === "MARKET_STRUCTURE" ? "KITE_WS" : "LOCAL_DERIVED",
    source: `verified:${family}`,
    payload: { family },
  }));
  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: `NIFTY-${asOfMs}`,
    symbol: "NIFTY",
    asOfMs,
    minuteClosed: false,
    connectionId: "kite-chase-observation-test",
    instrumentMasterVersion: "kite-instruments-2026-09-16",
    components,
    freshnessBudgetsMs: Object.fromEntries(FAMILIES.map((family) => [family, 30_000])),
    ingestTelemetry: { queueDepth: 0, queueLagMs: 1, droppedPacketCount: 0, backpressureActive: false },
  });
}

function point(observedAt: string, ltp: number, overrides: Partial<H1GoldChasePremiumPoint> = {}): H1GoldChasePremiumPoint {
  return {
    source: "LIVE_RUNTIME_EXACT",
    symbol: "NIFTY",
    expiry: "2026-09-17",
    strike: 23300,
    optionType: "CE",
    ltp,
    observedAt,
    receivedAt: observedAt,
    ...overrides,
  };
}

function input(points: H1GoldChasePremiumPoint[]) {
  return {
    symbol: "NIFTY" as const,
    side: "CE" as const,
    observedAt: T,
    canonicalSnapshot: root(),
    contract: { expiry: "2026-09-17", strike: 23300, optionType: "CE" as const, dte: 1 },
    premiumPoints: points,
  };
}

test("exact same-contract T0 path becomes observable facts without a chase verdict", () => {
  const out = observeH1GoldChaseFacts(input([
    point("2026-09-16T05:30:05.000Z", 100),
    point("2026-09-16T06:00:05.000Z", 130),
    point(T, 150),
  ]));
  assert.equal(out.state, "OBSERVABLE");
  assert.equal(out.readyForForwardCalibration, true);
  assert.equal(out.features.pointCount, 3);
  assert.equal(out.features.firstPremium, 100);
  assert.equal(out.features.currentPremium, 150);
  assert.equal(out.features.sessionHighPremium, 150);
  assert.equal(out.features.sessionLowPremium, 100);
  assert.equal(out.features.currentVsFirstPct, 50);
  assert.equal(out.features.currentVsSessionHighPct, 0);
  assert.equal(out.chaseVerdict, null);
  assert.equal(out.goldFamilySignal, null);
  assert.equal(out.thresholdPolicy, null);
  assert.equal(out.registersGoldFamily, false);
  assert.equal(out.usesFutureOutcome, false);
  assert.equal(out.productionImpact, "NONE");
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
});

test("large premium extension is still only a fact, never an automatic chase classification", () => {
  const out = observeH1GoldChaseFacts(input([
    point("2026-09-16T05:30:05.000Z", 50),
    point(T, 200),
  ]));
  assert.equal(out.state, "OBSERVABLE");
  assert.equal(out.features.currentVsFirstPct, 300);
  assert.equal(out.chaseVerdict, null);
  assert.equal(out.thresholdPolicy, null);
  assert.equal(out.registersGoldFamily, false);
});

test("wrong contract identity fails closed", () => {
  const out = observeH1GoldChaseFacts(input([
    point("2026-09-16T06:00:05.000Z", 100),
    point(T, 120, { strike: 23400 }),
  ]));
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("PREMIUM_POINT_CONTRACT_IDENTITY_MISMATCH"));
});

test("future premium evidence is rejected", () => {
  const out = observeH1GoldChaseFacts(input([
    point(T, 120),
    point("2026-09-16T06:31:05.000Z", 130),
  ]));
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("FUTURE_PREMIUM_POINT"));
  assert.ok(out.blockers.includes("EXACT_T0_PREMIUM_POINT_REQUIRED"));
});

test("duplicate observation timestamp fails closed", () => {
  const out = observeH1GoldChaseFacts(input([
    point(T, 120),
    point(T, 121),
  ]));
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("DUPLICATE_PREMIUM_POINT_TIMESTAMP"));
});

test("missing exact T0 premium point fails closed", () => {
  const out = observeH1GoldChaseFacts(input([
    point("2026-09-16T06:29:05.000Z", 120),
  ]));
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("EXACT_T0_PREMIUM_POINT_REQUIRED"));
});

test("canonical timestamp mismatch fails closed", () => {
  const payload = input([point(T, 120)]);
  payload.canonicalSnapshot = root(T_MS - 1_000);
  const out = observeH1GoldChaseFacts(payload);
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("CANONICAL_DECISION_TIMESTAMP_MISMATCH"));
});

test("cross-session history cannot be mixed into chase observation", () => {
  const out = observeH1GoldChaseFacts(input([
    point("2026-09-15T06:30:05.000Z", 80),
    point(T, 120),
  ]));
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("CROSS_SESSION_PREMIUM_POINT"));
});

test("received-before-observed chronology is rejected", () => {
  const out = observeH1GoldChaseFacts(input([
    point(T, 120, { receivedAt: "2026-09-16T06:30:04.000Z" }),
  ]));
  assert.equal(out.state, "MISSING");
  assert.ok(out.blockers.includes("PREMIUM_POINT_RECEIVED_BEFORE_OBSERVED"));
});
