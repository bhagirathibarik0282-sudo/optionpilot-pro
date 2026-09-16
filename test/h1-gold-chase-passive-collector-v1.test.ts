import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";
import type { BusinessForwardAnchor, ForwardOutcomePoint } from "../business-forward-journal-v1.js";
import { collectH1GoldChasePassiveEvidence } from "../h1-gold-chase-passive-collector-v1.js";
import type { H1GoldChaseObservationInput, H1GoldChasePremiumPoint } from "../h1-gold-chase-observation-v1.js";

const T = "2026-09-16T06:30:05.000Z";
const T_MS = Date.parse(T);
const SNAPSHOT_ID = `NIFTY-${T_MS}`;
const CANDIDATE_KEY = "NIFTY|2026-09-17|23300|CE";
const FAMILIES: CanonicalMarketFamily[] = [
  "MARKET_STRUCTURE", "FUTURES_CONFIRMATION", "OPTION_PREMIUMS", "OI_POSITIONING", "MULTI_DTE",
  "VOLATILITY", "HEAVYWEIGHTS", "SECTOR_BREADTH", "RESPONSE_LADDER", "LIQUIDITY_EXECUTABILITY",
];

function root() {
  const components: CanonicalMarketComponent[] = FAMILIES.map((family, index) => ({
    family,
    status: "VERIFIED",
    exchangeTimestampMs: T_MS - 5_000,
    receivedAtMs: T_MS - 4_000,
    processedAtMs: T_MS - 3_000,
    ingestSeq: index + 1,
    provenance: family === "MARKET_STRUCTURE" ? "KITE_WS" : "LOCAL_DERIVED",
    source: `verified:${family}`,
    payload: { family },
  }));
  return buildCanonicalOneRoofMarketSnapshot({
    snapshotId: SNAPSHOT_ID,
    symbol: "NIFTY",
    asOfMs: T_MS,
    minuteClosed: false,
    connectionId: "kite-passive-chase-test",
    instrumentMasterVersion: "kite-instruments-2026-09-16",
    components,
    freshnessBudgetsMs: Object.fromEntries(FAMILIES.map((family) => [family, 30_000])),
    ingestTelemetry: { queueDepth: 0, queueLagMs: 1, droppedPacketCount: 0, backpressureActive: false },
  });
}

function premiumPoint(observedAt: string, ltp: number): H1GoldChasePremiumPoint {
  return {
    source: "LIVE_RUNTIME_EXACT",
    symbol: "NIFTY",
    expiry: "2026-09-17",
    strike: 23300,
    optionType: "CE",
    ltp,
    observedAt,
    receivedAt: observedAt,
  };
}

function observation(): H1GoldChaseObservationInput {
  return {
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: root(),
    contract: { expiry: "2026-09-17", strike: 23300, optionType: "CE", dte: 1 },
    premiumPoints: [
      premiumPoint("2026-09-16T05:30:05.000Z", 100),
      premiumPoint("2026-09-16T06:00:05.000Z", 130),
      premiumPoint(T, 150),
    ],
  };
}

function anchor(overrides: Partial<BusinessForwardAnchor> = {}): BusinessForwardAnchor {
  return {
    decisionId: "decision-passive-chase-1",
    snapshotId: SNAPSHOT_ID,
    observedAtMs: T_MS,
    selectedCandidateKey: CANDIDATE_KEY,
    eligibleCandidates: [{
      candidateKey: CANDIDATE_KEY,
      symbol: "NIFTY",
      optionSide: "CE",
      strike: 23300,
      expiryDate: "2026-09-17",
      dte: 1,
      premiumLtp: 150,
    }],
    marketState: "TRENDING_UP",
    sellerStressState: "CALL_WRITER_STRESS",
    opportunityStage: "ACCEPTANCE",
    ...overrides,
  };
}

function outcome(window: ForwardOutcomePoint["window"], minutes: number, premium: number): ForwardOutcomePoint {
  return {
    window,
    observedAtMs: T_MS + minutes * 60_000,
    premiumByCandidateKey: { [CANDIDATE_KEY]: premium },
  };
}

function fullPath(): ForwardOutcomePoint[] {
  return [
    outcome("T_PLUS_3M", 3, 165),
    outcome("T_PLUS_6M", 6, 180),
    outcome("T_PLUS_15M", 15, 135),
    outcome("T_PLUS_30M", 30, 210),
  ];
}

test("T0 only starts passive collection with zero production authority", () => {
  const out = collectH1GoldChasePassiveEvidence({ observationInput: observation(), anchor: anchor() });
  assert.equal(out.state, "COLLECTING");
  assert.deepEqual(out.acceptedWindows, []);
  assert.deepEqual(out.missingWindows, ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"]);
  assert.equal(out.completeSampleReady, false);
  assert.equal(out.schedulesSampling, false);
  assert.equal(out.infersWindowFromClock, false);
  assert.equal(out.autoFillsMissingWindows, false);
  assert.equal(out.persistsData, false);
  assert.equal(out.thresholdPolicy, null);
  assert.equal(out.chaseLabel, null);
  assert.equal(out.affectsGoldEligibility, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
  assert.equal(out.registersGoldFamily, false);
});

test("explicit windows advance one by one; missing windows are never auto-filled", () => {
  const out = collectH1GoldChasePassiveEvidence({
    observationInput: observation(),
    anchor: anchor(),
    explicitOutcomes: [outcome("T_PLUS_3M", 3, 165), outcome("T_PLUS_6M", 6, 180)],
  });
  assert.equal(out.state, "COLLECTING");
  assert.deepEqual(out.acceptedWindows, ["T_PLUS_3M", "T_PLUS_6M"]);
  assert.deepEqual(out.missingWindows, ["T_PLUS_15M", "T_PLUS_30M"]);
  assert.equal(out.completeSampleReady, false);
});

test("all four explicit observations form only a structural complete sample", () => {
  const out = collectH1GoldChasePassiveEvidence({
    observationInput: observation(),
    anchor: anchor(),
    explicitOutcomes: fullPath(),
  });
  assert.equal(out.state, "COMPLETE_SAMPLE");
  assert.equal(out.completeSampleReady, true);
  assert.deepEqual(out.acceptedWindows, ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"]);
  assert.deepEqual(out.missingWindows, []);
  assert.equal(out.sample?.readyForDataset, true);
  assert.equal(out.sample?.chaseLabel, null);
  assert.equal(out.sample?.thresholdPolicy, null);
  assert.equal(out.grantsPromotionAuthority, false);
});

test("caller-labelled observation before its target fails closed", () => {
  const out = collectH1GoldChasePassiveEvidence({
    observationInput: observation(),
    anchor: anchor(),
    explicitOutcomes: [outcome("T_PLUS_3M", 2, 165)],
  });
  assert.equal(out.state, "BLOCKED");
  assert.equal(out.journal, null);
  assert.ok(out.blockers.includes("FORWARD_WINDOW_OBSERVED_BEFORE_TARGET:T_PLUS_3M"));
  assert.equal(out.completeSampleReady, false);
});

test("one quote cannot satisfy multiple windows at the same timestamp", () => {
  const sameObservedAt = T_MS + 30 * 60_000;
  const out = collectH1GoldChasePassiveEvidence({
    observationInput: observation(),
    anchor: anchor(),
    explicitOutcomes: [
      { window: "T_PLUS_3M", observedAtMs: sameObservedAt, premiumByCandidateKey: { [CANDIDATE_KEY]: 170 } },
      { window: "T_PLUS_6M", observedAtMs: sameObservedAt, premiumByCandidateKey: { [CANDIDATE_KEY]: 170 } },
    ],
  });
  assert.equal(out.state, "BLOCKED");
  assert.equal(out.journal, null);
  assert.ok(out.blockers.includes("FORWARD_CHRONOLOGY_REVERSED:T_PLUS_6M"));
});

test("duplicate explicit window is rejected rather than overwritten", () => {
  const out = collectH1GoldChasePassiveEvidence({
    observationInput: observation(),
    anchor: anchor(),
    explicitOutcomes: [
      outcome("T_PLUS_3M", 3, 165),
      outcome("T_PLUS_3M", 4, 166),
    ],
  });
  assert.equal(out.state, "BLOCKED");
  assert.equal(out.journal, null);
  assert.ok(out.blockers.includes("FORWARD_DUPLICATE_FORWARD_WINDOW"));
});

test("T0 identity mismatch blocks before future evidence can be accepted", () => {
  const out = collectH1GoldChasePassiveEvidence({
    observationInput: observation(),
    anchor: anchor({ snapshotId: "NIFTY-WRONG" }),
    explicitOutcomes: fullPath(),
  });
  assert.equal(out.state, "BLOCKED");
  assert.equal(out.journal, null);
  assert.ok(out.blockers.includes("T0_CALIBRATION_SNAPSHOT_ID_MISMATCH"));
  assert.deepEqual(out.acceptedWindows, []);
});
