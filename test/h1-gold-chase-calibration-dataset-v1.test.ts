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
  type BusinessForwardJournalRecord,
  type ForwardOutcomePoint,
} from "../business-forward-journal-v1.js";
import { buildH1GoldChaseCalibrationSample } from "../h1-gold-chase-calibration-dataset-v1.js";
import type { H1GoldChaseObservationInput, H1GoldChasePremiumPoint } from "../h1-gold-chase-observation-v1.js";

const T = "2026-09-16T06:30:05.000Z";
const T_MS = Date.parse(T);
const SNAPSHOT_ID = `NIFTY-${T_MS}`;
const CANDIDATE_KEY = "NIFTY|2026-09-17|23300|CE";
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
    snapshotId: asOfMs === T_MS ? SNAPSHOT_ID : `NIFTY-${asOfMs}`,
    symbol: "NIFTY",
    asOfMs,
    minuteClosed: false,
    connectionId: "kite-chase-calibration-test",
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

function emptyJournal(overrides: Partial<Parameters<typeof createBusinessForwardJournal>[0]> = {}): BusinessForwardJournalRecord {
  const made = createBusinessForwardJournal({
    decisionId: "decision-chase-1",
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
    ...overrides,
  });
  assert.equal(made.ready, true);
  return made.record!;
}

function append(journal: BusinessForwardJournalRecord, window: ForwardOutcomePoint["window"], minutes: number, premium = 150 + minutes): BusinessForwardJournalRecord {
  const next = appendForwardOutcome(journal, {
    window,
    observedAtMs: T_MS + minutes * 60_000,
    premiumByCandidateKey: { [CANDIDATE_KEY]: premium },
  });
  assert.equal(next.ready, true);
  return next.record!;
}

function completeJournal(): BusinessForwardJournalRecord {
  let journal = emptyJournal();
  journal = append(journal, "T_PLUS_3M", 3, 165);
  journal = append(journal, "T_PLUS_6M", 6, 180);
  journal = append(journal, "T_PLUS_15M", 15, 135);
  journal = append(journal, "T_PLUS_30M", 30, 210);
  return journal;
}

test("complete 3/6/15/30 forward path forms one structural calibration sample without a chase label", () => {
  const out = buildH1GoldChaseCalibrationSample(observation(), completeJournal());
  assert.equal(out.state, "COMPLETE_SAMPLE");
  assert.equal(out.readyForDataset, true);
  assert.equal(out.snapshotId, SNAPSHOT_ID);
  assert.equal(out.candidateKey, CANDIDATE_KEY);
  assert.deepEqual(out.completedWindows, ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"]);
  assert.deepEqual(out.missingWindows, []);
  assert.equal(out.t0Premium, 150);
  assert.equal(out.outcomes[0].returnPct, 10);
  assert.equal(out.outcomes[1].returnPct, 20);
  assert.equal(out.outcomes[2].returnPct, -10);
  assert.equal(out.outcomes[3].returnPct, 40);
  assert.equal(out.mfePct, 40);
  assert.equal(out.maePct, -10);
  assert.equal(out.terminal30mReturnPct, 40);
  assert.equal(out.chaseLabel, null);
  assert.equal(out.outcomeLabel, null);
  assert.equal(out.thresholdPolicy, null);
  assert.equal(out.classificationPolicyDefined, false);
  assert.equal(out.sampleSufficiencyPolicyDefined, false);
  assert.equal(out.affectsGoldEligibility, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
});

test("partial forward windows remain COLLECTING and cannot enter the complete dataset", () => {
  let journal = emptyJournal();
  journal = append(journal, "T_PLUS_3M", 3, 165);
  journal = append(journal, "T_PLUS_6M", 6, 170);
  const out = buildH1GoldChaseCalibrationSample(observation(), journal);
  assert.equal(out.state, "COLLECTING");
  assert.equal(out.readyForDataset, false);
  assert.deepEqual(out.completedWindows, ["T_PLUS_3M", "T_PLUS_6M"]);
  assert.deepEqual(out.missingWindows, ["T_PLUS_15M", "T_PLUS_30M"]);
  assert.equal(out.terminal30mReturnPct, null);
});

test("same snapshot and exact T0 binding are mandatory", () => {
  const wrongSnapshot = emptyJournal({ snapshotId: "NIFTY-WRONG" });
  const snapshotOut = buildH1GoldChaseCalibrationSample(observation(), wrongSnapshot);
  assert.equal(snapshotOut.state, "BLOCKED");
  assert.ok(snapshotOut.blockers.includes("CALIBRATION_SNAPSHOT_ID_MISMATCH"));

  const wrongT0 = emptyJournal({ observedAtMs: T_MS + 1_000 });
  const t0Out = buildH1GoldChaseCalibrationSample(observation(), wrongT0);
  assert.equal(t0Out.state, "BLOCKED");
  assert.ok(t0Out.blockers.includes("CALIBRATION_T0_TIMESTAMP_MISMATCH"));
});

test("selected frozen contract must exactly match the observed T0 contract", () => {
  const wrongStrike = emptyJournal({
    eligibleCandidates: [{
      candidateKey: CANDIDATE_KEY,
      symbol: "NIFTY",
      optionSide: "CE",
      strike: 23400,
      expiryDate: "2026-09-17",
      dte: 1,
      premiumLtp: 150,
    }],
  });
  const out = buildH1GoldChaseCalibrationSample(observation(), wrongStrike);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("SELECTED_STRIKE_MISMATCH"));
});

test("T0 premium mismatch blocks post-hoc candidate substitution", () => {
  const wrongPremium = emptyJournal({
    eligibleCandidates: [{
      candidateKey: CANDIDATE_KEY,
      symbol: "NIFTY",
      optionSide: "CE",
      strike: 23300,
      expiryDate: "2026-09-17",
      dte: 1,
      premiumLtp: 149.95,
    }],
  });
  const out = buildH1GoldChaseCalibrationSample(observation(), wrongPremium);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("SELECTED_T0_PREMIUM_MISMATCH"));
});

test("missing selected candidate premium in a recorded forward window fails closed", () => {
  const journal = emptyJournal();
  const forged: BusinessForwardJournalRecord = {
    ...journal,
    outcomes: [{
      window: "T_PLUS_3M",
      observedAtMs: T_MS + 3 * 60_000,
      premiumByCandidateKey: { "OTHER": 170 },
    }],
  };
  const out = buildH1GoldChaseCalibrationSample(observation(), forged);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("SELECTED_FORWARD_PREMIUM_REQUIRED:T_PLUS_3M"));
});

test("early-labelled window is rejected rather than treated as T+3 evidence", () => {
  const journal = emptyJournal();
  const forged: BusinessForwardJournalRecord = {
    ...journal,
    outcomes: [{
      window: "T_PLUS_3M",
      observedAtMs: T_MS + 2 * 60_000,
      premiumByCandidateKey: { [CANDIDATE_KEY]: 170 },
    }],
  };
  const out = buildH1GoldChaseCalibrationSample(observation(), forged);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("FORWARD_WINDOW_OBSERVED_BEFORE_TARGET:T_PLUS_3M"));
});

test("window chronology cannot reverse even when each point is individually after its minimum target", () => {
  const journal = emptyJournal();
  const forged: BusinessForwardJournalRecord = {
    ...journal,
    outcomes: [
      { window: "T_PLUS_3M", observedAtMs: T_MS + 20 * 60_000, premiumByCandidateKey: { [CANDIDATE_KEY]: 170 } },
      { window: "T_PLUS_6M", observedAtMs: T_MS + 7 * 60_000, premiumByCandidateKey: { [CANDIDATE_KEY]: 180 } },
    ],
  };
  const out = buildH1GoldChaseCalibrationSample(observation(), forged);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("FORWARD_CHRONOLOGY_REVERSED:T_PLUS_6M"));
});

test("invalid T0 observation cannot be rescued by excellent future performance", () => {
  const bad = observation();
  bad.premiumPoints = [premiumPoint("2026-09-16T06:31:05.000Z", 300)];
  const out = buildH1GoldChaseCalibrationSample(bad, completeJournal());
  assert.equal(out.state, "BLOCKED");
  assert.equal(out.readyForDataset, false);
  assert.ok(out.blockers.includes("VALID_EXACT_T0_CHASE_OBSERVATION_REQUIRED"));
  assert.equal(out.chaseLabel, null);
  assert.equal(out.affectsGoldEligibility, false);
});
