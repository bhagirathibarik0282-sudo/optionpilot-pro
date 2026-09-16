import assert from "node:assert/strict";
import test from "node:test";
import {
  buildH1GoldChaseTemporalHoldout,
} from "../h1-gold-chase-temporal-holdout-v1.js";
import type { H1GoldChaseCalibrationSample } from "../h1-gold-chase-calibration-dataset-v1.js";

function istMs(tradingDate: string, hhmm = "10:00"): number {
  return Date.parse(`${tradingDate}T${hhmm}:00+05:30`);
}

function sample(
  decisionId: string,
  tradingDate: string,
  overrides: Partial<H1GoldChaseCalibrationSample> = {},
): H1GoldChaseCalibrationSample {
  const t0 = istMs(tradingDate);
  return {
    version: "H1_GOLD_CHASE_CALIBRATION_DATASET_V1",
    state: "COMPLETE_SAMPLE",
    readyForDataset: true,
    snapshotId: `NIFTY-${tradingDate}-${decisionId}`,
    decisionId,
    candidateKey: `NIFTY|2026-09-17|23300|CE|${decisionId}`,
    symbol: "NIFTY",
    side: "CE",
    expiry: "2026-09-17",
    strike: 23300,
    dte: 1,
    t0ObservedAtMs: t0,
    t0Premium: 150,
    t0Features: {
      pointCount: 3,
      firstObservedAt: new Date(t0 - 60 * 60_000).toISOString(),
      currentObservedAt: new Date(t0).toISOString(),
      minutesSinceMarketOpen: 45,
      observationSpanMinutes: 60,
      firstPremium: 100,
      currentPremium: 150,
      sessionHighPremium: 160,
      sessionHighObservedAt: new Date(t0 - 10 * 60_000).toISOString(),
      sessionLowPremium: 90,
      sessionLowObservedAt: new Date(t0 - 55 * 60_000).toISOString(),
      currentVsFirstPct: 50,
      currentVsSessionHighPct: -6.25,
      sessionRangePct: 77.7778,
    },
    t0MarketState: "TRENDING_UP",
    t0SellerStressState: "CALL_WRITER_STRESS",
    t0OpportunityStage: "ACCEPTANCE",
    outcomes: [
      { window: "T_PLUS_3M", targetMinutes: 3, observedAtMs: t0 + 180_000, actualLagMinutes: 3, premium: 165, returnPct: 10 },
      { window: "T_PLUS_6M", targetMinutes: 6, observedAtMs: t0 + 360_000, actualLagMinutes: 6, premium: 180, returnPct: 20 },
      { window: "T_PLUS_15M", targetMinutes: 15, observedAtMs: t0 + 900_000, actualLagMinutes: 15, premium: 135, returnPct: -10 },
      { window: "T_PLUS_30M", targetMinutes: 30, observedAtMs: t0 + 1_800_000, actualLagMinutes: 30, premium: 210, returnPct: 40 },
    ],
    completedWindows: ["T_PLUS_3M", "T_PLUS_6M", "T_PLUS_15M", "T_PLUS_30M"],
    missingWindows: [],
    mfePct: 40,
    maePct: -10,
    terminal30mReturnPct: 40,
    blockers: [],
    chaseLabel: null,
    outcomeLabel: null,
    thresholdPolicy: null,
    classificationPolicyDefined: false,
    sampleSufficiencyPolicyDefined: false,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    usesPostT0Outcome: true,
    failClosed: true,
    businessUse: "FORWARD_CHASE_CALIBRATION_DATASET_ONLY_NOT_GOLD_AUTHORITY",
    semantics: "EXACT_T0_CHASE_FACTS_PAIRED_WITH_FROZEN_SELECTED_CANDIDATE_FORWARD_PREMIUMS_NO_LABEL_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY",
    ...overrides,
  };
}

test("caller-supplied trading-date cutoff creates a chronological anti-leakage holdout", () => {
  const out = buildH1GoldChaseTemporalHoldout([
    sample("D1", "2026-09-14"),
    sample("D2", "2026-09-15"),
    sample("D3", "2026-09-16"),
    sample("D4", "2026-09-17"),
  ], "2026-09-16");

  assert.equal(out.state, "PARTITION_READY");
  assert.deepEqual(out.calibrationTradingDates, ["2026-09-14", "2026-09-15"]);
  assert.deepEqual(out.oosTradingDates, ["2026-09-16", "2026-09-17"]);
  assert.equal(out.calibrationSampleCount, 2);
  assert.equal(out.oosSampleCount, 2);
  assert.equal(out.sameTradingDateCrossPartition, false);
  assert.equal(out.chronologicalOrderVerified, true);
  assert.equal(out.calibration?.state, "READY");
  assert.equal(out.oos?.state, "READY");
  assert.equal(out.heldOutPartitionDefined, true);
  assert.equal(out.thresholdPolicy, null);
  assert.equal(out.classificationPolicyDefined, false);
  assert.equal(out.sampleSufficiencyPolicyDefined, false);
  assert.equal(out.heldOutPerformancePolicyDefined, false);
  assert.equal(out.affectsGoldEligibility, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
});

test("multiple observations from one IST trading date stay wholly on one side", () => {
  const out = buildH1GoldChaseTemporalHoldout([
    sample("D5", "2026-09-15", { t0ObservedAtMs: istMs("2026-09-15", "09:30") }),
    sample("D6", "2026-09-15", { t0ObservedAtMs: istMs("2026-09-15", "14:30") }),
    sample("D7", "2026-09-16", { t0ObservedAtMs: istMs("2026-09-16", "09:30") }),
    sample("D8", "2026-09-16", { t0ObservedAtMs: istMs("2026-09-16", "14:30") }),
  ], "2026-09-16");

  assert.equal(out.state, "PARTITION_READY");
  assert.deepEqual(out.calibrationTradingDates, ["2026-09-15"]);
  assert.deepEqual(out.oosTradingDates, ["2026-09-16"]);
  assert.equal(out.calibrationSampleCount, 2);
  assert.equal(out.oosSampleCount, 2);
  assert.equal(out.sameTradingDateCrossPartition, false);
});

test("invalid cutoff fails closed instead of guessing a split", () => {
  const out = buildH1GoldChaseTemporalHoldout([sample("D9", "2026-09-15")], "2026-02-30");
  assert.equal(out.state, "BLOCKED");
  assert.deepEqual(out.blockers, ["VALID_OOS_START_TRADING_DATE_REQUIRED"]);
  assert.equal(out.heldOutPartitionDefined, false);
});

test("a one-sided split is structurally blocked and does not imply sample sufficiency", () => {
  const out = buildH1GoldChaseTemporalHoldout([
    sample("D10", "2026-09-15"),
    sample("D11", "2026-09-16"),
  ], "2026-09-20");

  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.includes("OOS_SIDE_EMPTY"));
  assert.ok(out.blockers.includes("CHRONOLOGICAL_ORDER_NOT_VERIFIED"));
  assert.equal(out.sampleSufficiencyPolicyDefined, false);
  assert.equal(out.heldOutPartitionDefined, false);
});

test("malformed or incomplete evidence blocks the full partition instead of being silently dropped", () => {
  const malformed = sample("D12", "2026-09-15", {
    t0Features: { ...sample("D12", "2026-09-15").t0Features!, currentVsFirstPct: null },
  });
  const out = buildH1GoldChaseTemporalHoldout([
    malformed,
    sample("D13", "2026-09-16"),
  ], "2026-09-16");

  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.some((code) => code.includes("FINITE_T0_METRICS_REQUIRED")));
  assert.equal(out.calibration, null);
  assert.equal(out.oos, null);
});

test("duplicate immutable identity blocks rather than double-weighting one event", () => {
  const original = sample("D14", "2026-09-15");
  const duplicate = { ...original, t0Features: { ...original.t0Features! } };
  const out = buildH1GoldChaseTemporalHoldout([
    original,
    duplicate,
    sample("D15", "2026-09-16"),
  ], "2026-09-16");

  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.some((code) => code.includes("DUPLICATE_IMMUTABLE_IDENTITY")));
  assert.equal(out.heldOutPartitionDefined, false);
});

test("empty evidence remains EMPTY and grants no authority", () => {
  const out = buildH1GoldChaseTemporalHoldout([], "2026-09-16");
  assert.equal(out.state, "EMPTY");
  assert.equal(out.thresholdPolicy, null);
  assert.equal(out.heldOutPartitionDefined, false);
  assert.equal(out.grantsPromotionAuthority, false);
});
