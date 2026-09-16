import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
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
import type { H1GoldChaseObservationInput, H1GoldChasePremiumPoint } from "../h1-gold-chase-observation-v1.js";
import {
  closeH1GoldChaseCalibrationPersistence,
  H1_GOLD_CHASE_CALIBRATION_TABLE_V1,
  loadH1GoldChaseCalibrationSample,
  loadRecentH1GoldChaseCalibrationSamples,
  persistH1GoldChaseCalibrationSample,
} from "../h1-gold-chase-calibration-persistence-v1.js";

const { Pool } = pg;
const T = "2026-09-16T06:30:05.000Z";
const T_MS = Date.parse(T);
const SNAPSHOT_ID = `NIFTY-${T_MS}`;
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
    connectionId: "kite-chase-persistence-test",
    instrumentMasterVersion: "kite-instruments-2026-09-16",
    components,
    freshnessBudgetsMs: Object.fromEntries(FAMILIES.map((family) => [family, 30_000])),
    ingestTelemetry: { queueDepth: 0, queueLagMs: 1, droppedPacketCount: 0, backpressureActive: false },
  });
}

function point(observedAt: string, ltp: number): H1GoldChasePremiumPoint {
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

function observation(firstPremium = 100): H1GoldChaseObservationInput {
  return {
    symbol: "NIFTY",
    side: "CE",
    observedAt: T,
    canonicalSnapshot: root(),
    contract: { expiry: "2026-09-17", strike: 23300, optionType: "CE", dte: 1 },
    premiumPoints: [
      point("2026-09-16T05:30:05.000Z", firstPremium),
      point("2026-09-16T06:00:05.000Z", 130),
      point(T, 150),
    ],
  };
}

function journal(decisionId: string): BusinessForwardJournalRecord {
  const candidateKey = `NIFTY|2026-09-17|23300|CE`;
  const made = createBusinessForwardJournal({
    decisionId,
    snapshotId: SNAPSHOT_ID,
    observedAtMs: T_MS,
    selectedCandidateKey: candidateKey,
    eligibleCandidates: [{
      candidateKey,
      symbol: "NIFTY",
      optionSide: "CE",
      strike: 23300,
      expiryDate: "2026-09-17",
      dte: 1,
      premiumLtp: 150,
    }],
  });
  assert.equal(made.ready, true);
  return made.record!;
}

function append(record: BusinessForwardJournalRecord, window: ForwardOutcomePoint["window"], minutes: number, premium: number): BusinessForwardJournalRecord {
  const candidateKey = record.anchor.selectedCandidateKey!;
  const next = appendForwardOutcome(record, {
    window,
    observedAtMs: T_MS + minutes * 60_000,
    premiumByCandidateKey: { [candidateKey]: premium },
  });
  assert.equal(next.ready, true);
  return next.record!;
}

function completeJournal(decisionId: string): BusinessForwardJournalRecord {
  let record = journal(decisionId);
  record = append(record, "T_PLUS_3M", 3, 165);
  record = append(record, "T_PLUS_6M", 6, 180);
  record = append(record, "T_PLUS_15M", 15, 135);
  record = append(record, "T_PLUS_30M", 30, 210);
  return record;
}

async function resetTable(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  assert.ok(url, "DATABASE_URL must be set by Postgres integration CI");
  await closeH1GoldChaseCalibrationPersistence();
  const db = new Pool({ connectionString: url });
  try {
    await db.query(`DROP TABLE IF EXISTS ${H1_GOLD_CHASE_CALIBRATION_TABLE_V1}`);
  } finally {
    await db.end();
  }
}

test("durable chase calibration persistence is immutable, restart-safe and authority-free", async (t) => {
  await resetTable();

  await t.test("first complete sample persists and exact retry is idempotent", async () => {
    const first = await persistH1GoldChaseCalibrationSample(observation(), completeJournal("persist-1"));
    assert.equal(first.state, "PERSISTED");
    assert.equal(first.durable, true);
    assert.ok(first.sampleKey);
    assert.equal(first.affectsGoldEligibility, false);
    assert.equal(first.affectsSelector, false);
    assert.equal(first.affectsTelegram, false);
    assert.equal(first.affectsExecution, false);
    assert.equal(first.grantsPromotionAuthority, false);
    assert.equal(first.thresholdPolicyDefined, false);
    assert.equal(first.classificationPolicyDefined, false);

    const retry = await persistH1GoldChaseCalibrationSample(observation(), completeJournal("persist-1"));
    assert.equal(retry.state, "EXACT_DUPLICATE");
    assert.equal(retry.durable, true);
    assert.equal(retry.sampleKey, first.sampleKey);
    assert.equal(retry.payloadDigest, first.payloadDigest);
  });

  await t.test("same immutable identity with divergent T0 path is a conflict and cannot overwrite", async () => {
    const first = await persistH1GoldChaseCalibrationSample(observation(100), completeJournal("persist-conflict"));
    assert.equal(first.state, "PERSISTED");
    const divergent = await persistH1GoldChaseCalibrationSample(observation(80), completeJournal("persist-conflict"));
    assert.equal(divergent.state, "CONFLICT");
    assert.equal(divergent.durable, false);
    assert.ok(divergent.blockers.includes("DIVERGENT_DUPLICATE_IMMUTABLE_IDENTITY"));

    const stored = await loadH1GoldChaseCalibrationSample(first.sampleKey!);
    assert.ok(stored);
    assert.equal(stored?.t0Features?.firstPremium, 100);
  });

  await t.test("concurrent divergent writes allow one immutable winner and reject the other", async () => {
    const record = completeJournal("persist-race");
    const [a, b] = await Promise.all([
      persistH1GoldChaseCalibrationSample(observation(90), record),
      persistH1GoldChaseCalibrationSample(observation(110), record),
    ]);
    const states = [a.state, b.state].sort();
    assert.deepEqual(states, ["CONFLICT", "PERSISTED"]);
    assert.equal(a.sampleKey, b.sampleKey);
  });

  await t.test("closed pool simulates process restart and exact sample reloads from Postgres", async () => {
    const persisted = await persistH1GoldChaseCalibrationSample(observation(), completeJournal("persist-restart"));
    assert.equal(persisted.state, "PERSISTED");
    await closeH1GoldChaseCalibrationPersistence();
    const loaded = await loadH1GoldChaseCalibrationSample(persisted.sampleKey!);
    assert.ok(loaded);
    assert.equal(loaded?.decisionId, "persist-restart");
    assert.deepEqual(loaded?.completedWindows, ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"]);
  });

  await t.test("partial forward evidence is never persisted as a complete sample", async () => {
    let partial = journal("persist-partial");
    partial = append(partial, "T_PLUS_3M", 3, 160);
    partial = append(partial, "T_PLUS_6M", 6, 170);
    const out = await persistH1GoldChaseCalibrationSample(observation(), partial);
    assert.equal(out.state, "NOT_COMPLETE");
    assert.equal(out.durable, false);
    assert.equal(out.sampleKey, null);
    assert.ok(out.blockers.includes("COMPLETE_SAMPLE_REQUIRED"));
  });

  await t.test("invalid T0 cannot be persisted even with a complete future path", async () => {
    const invalid = observation();
    invalid.premiumPoints = [point("2026-09-16T06:31:05.000Z", 400)];
    const out = await persistH1GoldChaseCalibrationSample(invalid, completeJournal("persist-invalid-t0"));
    assert.equal(out.state, "NOT_COMPLETE");
    assert.equal(out.durable, false);
  });

  await t.test("recent dataset contains only structurally valid complete samples", async () => {
    const rows = await loadRecentH1GoldChaseCalibrationSamples(100);
    assert.ok(rows.length >= 4);
    assert.ok(rows.every((row) => row.state === "COMPLETE_SAMPLE" && row.readyForDataset));
    assert.ok(rows.every((row) => row.chaseLabel === null && row.thresholdPolicy === null));
    assert.ok(rows.every((row) => row.affectsGoldEligibility === false && row.affectsTelegram === false && row.affectsExecution === false));
  });

  await closeH1GoldChaseCalibrationPersistence();
});
