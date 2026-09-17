import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalOneRoofMarketSnapshot,
  type CanonicalMarketComponent,
  type CanonicalMarketFamily,
} from "../canonical-one-roof-market-snapshot.js";
import {
  appendForwardOutcome,
  createBusinessForwardJournal,
  type BusinessForwardAnchor,
  type BusinessForwardJournalRecord,
  type ForwardOutcomePoint,
} from "../business-forward-journal-v1.js";
import {
  BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1,
  type BusinessForwardLiveOutcomeCollectorResult,
} from "../business-forward-live-outcome-collector-v1.js";
import { bridgeH1GoldChaseFromLiveOutcome } from "../h1-gold-chase-live-outcome-bridge-v1.js";
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
    connectionId: "kite-live-chase-bridge-test",
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

function anchor(): BusinessForwardAnchor {
  return {
    decisionId: "decision-live-chase-bridge-1",
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
  };
}

function outcome(window: ForwardOutcomePoint["window"], minutes: number, premium: number): ForwardOutcomePoint {
  return {
    window,
    observedAtMs: T_MS + minutes * 60_000,
    premiumByCandidateKey: { [CANDIDATE_KEY]: premium },
  };
}

function journal(points: ForwardOutcomePoint[]): BusinessForwardJournalRecord {
  const made = createBusinessForwardJournal(anchor());
  assert.equal(made.ready, true);
  assert.ok(made.record);
  let current = made.record;
  for (const point of points) {
    const appended = appendForwardOutcome(current, point);
    assert.equal(appended.ready, true);
    assert.ok(appended.record);
    current = appended.record;
  }
  return current;
}

function liveResult(record: BusinessForwardJournalRecord, window: ForwardOutcomePoint["window"]): BusinessForwardLiveOutcomeCollectorResult {
  const point = record.outcomes.find((x) => x.window === window);
  assert.ok(point);
  return {
    version: BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1,
    ready: true,
    window,
    expectedAtMs: T_MS + ({ T_PLUS_3M: 3, T_PLUS_6M: 6, T_PLUS_15M: 15, T_PLUS_30M: 30 }[window]) * 60_000,
    observedAtMs: point.observedAtMs,
    matchedCandidateCount: 1,
    record,
    blockers: [],
    semantics: "READ_ONLY_EXACT_LIVE_FORWARD_OUTCOME_CAPTURE",
    affectsVerdict: false,
    affectsStars: false,
    affectsCandidateAuthority: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    failClosed: true,
  };
}

test("validated exact-live T+3 result advances only to COLLECTING", () => {
  const record = journal([outcome("T_PLUS_3M", 3, 165)]);
  const out = bridgeH1GoldChaseFromLiveOutcome({ observationInput: observation(), liveOutcome: liveResult(record, "T_PLUS_3M") });
  assert.equal(out.state, "COLLECTING");
  assert.equal(out.completeSampleReady, false);
  assert.deepEqual(out.sample?.completedWindows, ["T_PLUS_3M"]);
  assert.equal(out.persistsData, false);
  assert.equal(out.schedulesSampling, false);
  assert.equal(out.infersWindowFromClock, false);
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

test("validated exact-live T+30 result over complete journal yields structural COMPLETE_SAMPLE only", () => {
  const record = journal([
    outcome("T_PLUS_3M", 3, 165),
    outcome("T_PLUS_6M", 6, 180),
    outcome("T_PLUS_15M", 15, 135),
    outcome("T_PLUS_30M", 30, 210),
  ]);
  const out = bridgeH1GoldChaseFromLiveOutcome({ observationInput: observation(), liveOutcome: liveResult(record, "T_PLUS_30M") });
  assert.equal(out.state, "COMPLETE_SAMPLE");
  assert.equal(out.completeSampleReady, true);
  assert.equal(out.sample?.readyForDataset, true);
  assert.equal(out.sample?.chaseLabel, null);
  assert.equal(out.sample?.thresholdPolicy, null);
  assert.equal(out.grantsPromotionAuthority, false);
});

test("source timestamp mismatch blocks rather than trusting ready=true", () => {
  const record = journal([outcome("T_PLUS_3M", 3, 165)]);
  const live = liveResult(record, "T_PLUS_3M");
  live.observedAtMs = (live.observedAtMs ?? 0) + 1;
  const out = bridgeH1GoldChaseFromLiveOutcome({ observationInput: observation(), liveOutcome: live });
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("LIVE_OUTCOME_TIMESTAMP_MISMATCH"));
  assert.equal(out.journal, null);
});

test("not-ready source fails closed and carries upstream blocker", () => {
  const record = journal([outcome("T_PLUS_3M", 3, 165)]);
  const live = liveResult(record, "T_PLUS_3M");
  live.ready = false;
  live.record = null;
  live.blockers = ["FORWARD_WINDOW_CAPTURE_TOO_LATE"];
  const out = bridgeH1GoldChaseFromLiveOutcome({ observationInput: observation(), liveOutcome: live });
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("READY_EXACT_LIVE_OUTCOME_REQUIRED"));
  assert.ok(out.blockers.includes("FORWARD_WINDOW_CAPTURE_TOO_LATE"));
});

test("authority/safety mutation is rejected", () => {
  const record = journal([outcome("T_PLUS_3M", 3, 165)]);
  const live = liveResult(record, "T_PLUS_3M") as BusinessForwardLiveOutcomeCollectorResult & { affectsTelegram: boolean };
  live.affectsTelegram = true;
  const out = bridgeH1GoldChaseFromLiveOutcome({ observationInput: observation(), liveOutcome: live });
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("LIVE_OUTCOME_AUTHORITY_OR_SAFETY_MISMATCH"));
});

test("T0 identity mismatch is revalidated by chase dataset builder", () => {
  const record = journal([outcome("T_PLUS_3M", 3, 165)]);
  const badObservation = observation();
  badObservation.observedAt = "2026-09-16T06:30:06.000Z";
  const out = bridgeH1GoldChaseFromLiveOutcome({ observationInput: badObservation, liveOutcome: liveResult(record, "T_PLUS_3M") });
  assert.equal(out.state, "BLOCKED");
  assert.equal(out.journal, null);
  assert.ok(out.blockers.length > 0);
});
