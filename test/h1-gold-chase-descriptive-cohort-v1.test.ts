import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeH1GoldChaseDescriptiveCohorts,
} from "../h1-gold-chase-descriptive-cohort-v1.js";
import type { H1GoldChaseCalibrationSample } from "../h1-gold-chase-calibration-dataset-v1.js";

function sample(
  decisionId: string,
  overrides: Partial<H1GoldChaseCalibrationSample> = {},
): H1GoldChaseCalibrationSample {
  const t0 = 1789530605000 + Number(decisionId.replace(/\D/g, "") || "0") * 60_000;
  return {
    version: "H1_GOLD_CHASE_CALIBRATION_DATASET_V1",
    state: "COMPLETE_SAMPLE",
    readyForDataset: true,
    snapshotId: `NIFTY-${t0}`,
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
      firstObservedAt: "2026-09-16T05:30:05.000Z",
      currentObservedAt: "2026-09-16T06:30:05.000Z",
      minutesSinceMarketOpen: 165,
      observationSpanMinutes: 60,
      firstPremium: 100,
      currentPremium: 150,
      sessionHighPremium: 160,
      sessionHighObservedAt: "2026-09-16T06:20:05.000Z",
      sessionLowPremium: 90,
      sessionLowObservedAt: "2026-09-16T05:35:05.000Z",
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

test("empty input stays EMPTY and defines no chase policy", () => {
  const out = analyzeH1GoldChaseDescriptiveCohorts([]);
  assert.equal(out.state, "EMPTY");
  assert.equal(out.thresholdPolicy, null);
  assert.equal(out.classificationPolicyDefined, false);
  assert.equal(out.sampleSufficiencyPolicyDefined, false);
  assert.equal(out.heldOutPolicyDefined, false);
});

test("same exact context forms one descriptive cohort with median/quartile facts only", () => {
  const a = sample("D1");
  const b = sample("D2", {
    t0Features: {
      ...sample("D2").t0Features!,
      currentVsFirstPct: 30,
      currentVsSessionHighPct: -12.5,
      sessionRangePct: 60,
      minutesSinceMarketOpen: 180,
    },
    outcomes: sample("D2").outcomes.map((row) => ({ ...row, returnPct: row.returnPct + 10 })),
    mfePct: 50,
    maePct: 0,
    terminal30mReturnPct: 50,
  });
  const out = analyzeH1GoldChaseDescriptiveCohorts([a, b]);
  assert.equal(out.state, "READY");
  assert.equal(out.cohorts.length, 1);
  assert.equal(out.cohorts[0].sampleCount, 2);
  assert.equal(out.cohorts[0].dte, 1);
  assert.equal(out.cohorts[0].marketState, "TRENDING_UP");
  assert.equal(out.cohorts[0].opportunityStage, "ACCEPTANCE");
  assert.equal(out.cohorts[0].metrics.t0CurrentVsFirstPct.median, 40);
  assert.equal(out.cohorts[0].metrics.t30ReturnPct.median, 45);
  assert.equal(out.overall?.mfePct.median, 45);
  assert.equal(out.chaseLabel, null);
  assert.equal(out.outcomeLabel, null);
  assert.equal(out.affectsGoldEligibility, false);
  assert.equal(out.affectsSelector, false);
  assert.equal(out.affectsTelegram, false);
  assert.equal(out.affectsExecution, false);
  assert.equal(out.grantsPromotionAuthority, false);
  assert.equal(out.createsOrders, false);
});

test("exact DTE and T0 regime differences create separate cohorts without invented buckets", () => {
  const dte0 = sample("D3", { dte: 0, t0MarketState: "OSCILLATING_OR_RANGE" });
  const dte1 = sample("D4", { dte: 1, t0MarketState: "TRENDING_UP" });
  const out = analyzeH1GoldChaseDescriptiveCohorts([dte0, dte1]);
  assert.equal(out.state, "READY");
  assert.equal(out.cohorts.length, 2);
  assert.deepEqual(out.cohorts.map((row) => row.dte).sort(), [0, 1]);
  assert.equal(out.groupingPolicy, "EXACT_SYMBOL_SIDE_DTE_MARKET_STATE_OPPORTUNITY_STAGE_SELLER_STRESS_NO_BUCKET_THRESHOLDS");
});

test("duplicate immutable identity blocks the whole analysis instead of double-weighting one event", () => {
  const a = sample("D5");
  const duplicate = { ...a, t0Features: { ...a.t0Features! } };
  const out = analyzeH1GoldChaseDescriptiveCohorts([a, duplicate]);
  assert.equal(out.state, "BLOCKED");
  assert.ok(out.blockers.some((blocker) => blocker.includes("DUPLICATE_IMMUTABLE_IDENTITY")));
  assert.equal(out.cohorts.length, 0);
});

test("mixed invalid/valid samples block rather than silently dropping bad rows", () => {
  const valid = sample("D6");
  const invalid = sample("D7", { state: "COLLECTING", readyForDataset: false, missingWindows: ["T_PLUS_30M"] });
  const out = analyzeH1GoldChaseDescriptiveCohorts([valid, invalid]);
  assert.equal(out.state, "BLOCKED");
  assert.equal(out.inputCount, 2);
  assert.equal(out.acceptedSampleCount, 1);
  assert.equal(out.rejectedSampleCount, 1);
  assert.ok(out.blockers.some((blocker) => blocker.includes("NOT_COMPLETE")));
  assert.equal(out.cohorts.length, 0);
});

test("missing T0 context is explicit UNSPECIFIED, never inferred", () => {
  const out = analyzeH1GoldChaseDescriptiveCohorts([sample("D8", {
    t0MarketState: null,
    t0OpportunityStage: null,
    t0SellerStressState: null,
  })]);
  assert.equal(out.state, "READY");
  assert.equal(out.cohorts[0].marketState, "UNSPECIFIED");
  assert.equal(out.cohorts[0].opportunityStage, "UNSPECIFIED");
  assert.equal(out.cohorts[0].sellerStressState, "UNSPECIFIED");
});
