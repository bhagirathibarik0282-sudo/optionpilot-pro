import test from "node:test";
import assert from "node:assert/strict";
import { buildH1DirectionResponseResearch } from "../h1-direction-response-research-v1.js";
import type { H1ReplayHttpResult } from "../h1-replay-http.js";

function replay(): H1ReplayHttpResult {
  return {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request: {
      symbol: "NIFTY",
      tradeDate: "2026-09-15",
      fromTime: "09:15",
      toTime: "09:21",
      scope: "FULL",
    },
    market: [
      { minute_bucket: "2026-09-15T03:45:00.000Z", spot_ltp: 100 },
      { minute_bucket: "2026-09-15T03:48:00.000Z", spot_ltp: 101 },
      { minute_bucket: "2026-09-15T03:51:00.000Z", spot_ltp: 100 },
    ],
    options: [
      { minute_bucket: "2026-09-15T03:45:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 10 },
      { minute_bucket: "2026-09-15T03:48:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 11 },
      { minute_bucket: "2026-09-15T03:51:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 10 },
      { minute_bucket: "2026-09-15T03:45:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 10 },
      { minute_bucket: "2026-09-15T03:48:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 9 },
      { minute_bucket: "2026-09-15T03:51:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 10 },
    ],
  };
}

test("summarizes same-contract direction response without selecting a threshold", () => {
  const out = buildH1DirectionResponseResearch([{ tradeDate: "2026-09-15", replay: replay() }]);
  assert.equal(out.version, "H1_DIRECTION_RESPONSE_RESEARCH_V1");
  assert.equal(out.dateSummaries.length, 1);
  assert.equal(out.dateSummaries[0].marketPairCount, 2);
  assert.equal(out.combinedComparableCount, 4);
  assert.equal(out.combinedAgreementRate, 1);
  assert.equal(out.intervalWeighted.intervalCount, 2);
  assert.equal(out.intervalWeighted.bothSidesPresentIntervalCount, 2);
  assert.equal(out.intervalWeighted.meanSideBalancedAgreementShare, 1);
  assert.equal(out.intervalWeighted.strictMajorityIntervalRate, 1);
  assert.equal(out.thresholdOos.selectedCandidate, null);
  assert.equal(out.thresholdOos.temporalCandidateMatrixEvaluated, false);
  assert.equal(out.evidenceState, "OBSERVATIONS_AVAILABLE_NO_POLICY_PROMOTION");
  assert.ok(out.blockers.includes("DIRECTION_POLICY_THRESHOLD_NOT_SELECTED"));
  assert.ok(out.blockers.includes("DIRECTION_POLICY_TEMPORAL_HOLDOUT_NOT_EVALUATED"));
  assert.equal(out.safety.thresholdSelected, false);
  assert.equal(out.safety.thresholdPromoted, false);
  assert.equal(out.safety.policySelectionRubricDefined, true);
  assert.equal(out.safety.grantsPromotionAuthority, false);
  assert.equal(out.safety.affectsSelector, false);
  assert.equal(out.safety.affectsTelegram, false);
  assert.equal(out.safety.affectsExecution, false);
});

test("fails closed descriptively when replay observations are absent", () => {
  const out = buildH1DirectionResponseResearch([{
    tradeDate: "2026-09-15",
    replay: {
      ok: false,
      mode: "READ_ONLY_H1_3M_REPLAY",
      productionImpact: "NONE",
      request: null,
      reason: "NO_DATA",
    },
  }]);
  assert.equal(out.combinedComparableCount, 0);
  assert.equal(out.combinedAgreementRate, null);
  assert.equal(out.intervalWeighted.intervalCount, 0);
  assert.equal(out.intervalWeighted.meanSideBalancedAgreementShare, null);
  assert.equal(out.intervalWeighted.strictMajorityIntervalRate, null);
  assert.equal(out.evidenceState, "INSUFFICIENT_REPLAY_OBSERVATIONS");
  assert.equal(out.safety.failClosed, true);
});

test("interval weighting prevents many contracts in one market move from inflating independent evidence", () => {
  const t0 = "2026-09-15T03:45:00.000Z";
  const t1 = "2026-09-15T03:48:00.000Z";
  const t2 = "2026-09-15T03:51:00.000Z";
  const options: Record<string, unknown>[] = [
    { minute_bucket: t0, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 10 },
    { minute_bucket: t1, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 11 },
    { minute_bucket: t2, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 10.5 },
    { minute_bucket: t0, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 10 },
    { minute_bucket: t1, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 9 },
    { minute_bucket: t2, expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 9.5 },
  ];
  for (const strike of [101, 102, 103, 104]) {
    options.push(
      { minute_bucket: t0, expiry: "2026-09-15T00:00:00.000Z", strike, option_type: "CE", ltp: 10 },
      { minute_bucket: t1, expiry: "2026-09-15T00:00:00.000Z", strike, option_type: "CE", ltp: 11 },
      { minute_bucket: t0, expiry: "2026-09-15T00:00:00.000Z", strike, option_type: "PE", ltp: 10 },
      { minute_bucket: t1, expiry: "2026-09-15T00:00:00.000Z", strike, option_type: "PE", ltp: 9 },
    );
  }

  const uneven: H1ReplayHttpResult = {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request: {
      symbol: "NIFTY",
      tradeDate: "2026-09-15",
      fromTime: "09:15",
      toTime: "09:21",
      scope: "FULL",
    },
    market: [
      { minute_bucket: t0, spot_ltp: 100 },
      { minute_bucket: t1, spot_ltp: 101 },
      { minute_bucket: t2, spot_ltp: 102 },
    ],
    options,
  };

  const out = buildH1DirectionResponseResearch([{ tradeDate: "2026-09-15", replay: uneven }]);
  assert.equal(out.combinedComparableCount, 12);
  assert.equal(out.combinedAgreementRate, 10 / 12);
  assert.equal(out.intervalWeighted.intervalCount, 2);
  assert.equal(out.intervalWeighted.bothSidesPresentIntervalCount, 2);
  assert.equal(out.intervalWeighted.meanSideBalancedAgreementShare, 0.5);
  assert.equal(out.intervalWeighted.strictMajorityIntervalRate, 0.5);
  assert.equal(out.safety.policySelectionRubricDefined, true);
  assert.equal(out.blockers.includes("DIRECTION_POLICY_SELECTION_RUBRIC_NOT_DEFINED"), false);
  assert.equal(out.selectionRubricEvaluation.evaluated, false);
  assert.equal(out.selectionRubricEvaluation.researchPreferredLabel, null);
});


test("ignores exact-3m pairs that are off the canonical replay grid", () => {
  const out = buildH1DirectionResponseResearch([{
    tradeDate: "2026-09-15",
    replay: {
      ok: true,
      mode: "READ_ONLY_H1_3M_REPLAY",
      productionImpact: "NONE",
      request: {
        symbol: "NIFTY",
        tradeDate: "2026-09-15",
        fromTime: "09:15",
        toTime: "09:21",
        scope: "FULL",
      },
      market: [
        { minute_bucket: "2026-09-15T03:45:00.000Z", spot_ltp: 100 },
        { minute_bucket: "2026-09-15T03:46:00.000Z", spot_ltp: 101 },
        { minute_bucket: "2026-09-15T03:49:00.000Z", spot_ltp: 102 },
      ],
      options: [
        { minute_bucket: "2026-09-15T03:46:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 10 },
        { minute_bucket: "2026-09-15T03:49:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "CE", ltp: 11 },
        { minute_bucket: "2026-09-15T03:46:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 10 },
        { minute_bucket: "2026-09-15T03:49:00.000Z", expiry: "2026-09-15T00:00:00.000Z", strike: 100, option_type: "PE", ltp: 9 },
      ],
    },
  }]);
  assert.equal(out.dateSummaries[0].marketPairCount, 0);
  assert.equal(out.intervalWeighted.intervalCount, 0);
});


function oneIntervalReplay(tradeDate: string, movePct: number): H1ReplayHttpResult {
  const t0 = `${tradeDate}T03:45:00.000Z`;
  const t1 = `${tradeDate}T03:48:00.000Z`;
  const spot0 = 100;
  const spot1 = spot0 * (1 + movePct / 100);
  return {
    ok: true,
    mode: "READ_ONLY_H1_3M_REPLAY",
    productionImpact: "NONE",
    request: {
      symbol: "NIFTY",
      tradeDate,
      fromTime: "09:15",
      toTime: "09:18",
      scope: "FULL",
    },
    continuity: {
      cadenceMinutes: 3,
      expectedBuckets: 2,
      observedMarkerBuckets: 2,
      missingBuckets: [],
      firstObserved: t0,
      lastObserved: t1,
      coveragePct: 100,
      complete: true,
      truthCounts: { TRUE: 2 },
      canonicalArchiveBuckets: 2,
      canonicalCoveragePct: 100,
      allParameterArchiveSemantics: "FULL_RUNTIME_INDEX_METRICS_JSONB",
    },
    market: [
      { minute_bucket: t0, spot_ltp: spot0 },
      { minute_bucket: t1, spot_ltp: spot1 },
    ],
    options: [
      { minute_bucket: t0, expiry: tradeDate, strike: 100, option_type: "CE", ltp: 10 },
      { minute_bucket: t1, expiry: tradeDate, strike: 100, option_type: "CE", ltp: 11 },
      { minute_bucket: t0, expiry: tradeDate, strike: 100, option_type: "PE", ltp: 10 },
      { minute_bucket: t1, expiry: tradeDate, strike: 100, option_type: "PE", ltp: 9 },
    ],
  };
}

test("builds calibration-derived threshold candidates and evaluates them on later OOS dates without selecting one", () => {
  const days = [
    ["2026-09-01", 0.01],
    ["2026-09-02", 0.02],
    ["2026-09-03", 0.03],
    ["2026-09-04", 0.04],
    ["2026-09-07", 0.025],
    ["2026-09-08", 0.035],
    ["2026-09-09", 0.05],
  ] as const;
  const out = buildH1DirectionResponseResearch(
    days.map(([tradeDate, movePct]) => ({ tradeDate, replay: oneIntervalReplay(tradeDate, movePct) })),
  );
  const matrix = out.thresholdOos;
  assert.equal(matrix.version, "H1_DIRECTION_THRESHOLD_OOS_MATRIX_V1");
  assert.deepEqual(matrix.calibrationDates, ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
  assert.deepEqual(matrix.oosDates, ["2026-09-07", "2026-09-08", "2026-09-09"]);
  assert.equal(matrix.calibrationIntervalCount, 4);
  assert.equal(matrix.oosIntervalCount, 3);
  assert.deepEqual(matrix.candidates.map((x) => x.label), ["P50", "P75", "P90", "P95"]);
  assert.ok(Math.abs(matrix.candidates[0].thresholdPct - 0.025) < 1e-9);
  assert.equal(matrix.candidates[0].oos.intervalCount, 3);
  assert.equal(matrix.candidates[1].oos.intervalCount, 2);
  assert.equal(matrix.candidates[2].oos.intervalCount, 1);
  assert.equal(matrix.candidates[3].oos.intervalCount, 1);
  assert.equal(matrix.temporalCandidateMatrixEvaluated, true);
  assert.equal(out.safety.temporalHoldoutEvaluated, true);
  assert.equal(out.blockers.includes("DIRECTION_POLICY_TEMPORAL_HOLDOUT_NOT_EVALUATED"), false);
  assert.ok(out.blockers.includes("DIRECTION_POLICY_THRESHOLD_NOT_SELECTED"));
  assert.equal(out.blockers.includes("DIRECTION_POLICY_SELECTION_RUBRIC_NOT_DEFINED"), false);
  assert.equal(out.safety.policySelectionRubricDefined, true);
  assert.equal(out.selectionRubric.version, "H1_DIRECTION_SELECTION_RUBRIC_V1");
  assert.equal(out.selectionRubric.usesOosForSelection, false);
  assert.equal(out.selectionRubric.thresholdAuthority, "NONE");
  assert.equal(out.selectionRubricEvaluation.evaluated, true);
  assert.equal(out.selectionRubricEvaluation.primaryPreferredLabel, "P50");
  assert.equal(out.selectionRubricEvaluation.secondaryPreferredLabel, "P50");
  assert.equal(out.selectionRubricEvaluation.consensus, true);
  assert.equal(out.selectionRubricEvaluation.researchPreferredLabel, "P50");
  assert.equal(matrix.evidenceQuality.allIncludedDatesComplete, true);
  assert.deepEqual(matrix.evidenceQuality.calibrationIncompleteDates, []);
  assert.deepEqual(matrix.evidenceQuality.oosIncompleteDates, []);
  assert.equal(matrix.evidenceQuality.arbitraryCoverageCutoffApplied, false);
  assert.equal(matrix.selectedCandidate, null);
  assert.equal(matrix.safety.thresholdSelected, false);
  assert.equal(matrix.safety.thresholdPromoted, false);
  assert.equal(matrix.safety.affectsSelector, false);
  assert.equal(matrix.safety.affectsTelegram, false);
  assert.equal(matrix.safety.affectsExecution, false);
});


test("blocks promotion when an included OOS matrix date has incomplete replay continuity without inventing a coverage cutoff", () => {
  const incomplete = oneIntervalReplay("2026-09-01", 0.02);
  assert.ok(incomplete.continuity);
  incomplete.continuity.complete = false;
  incomplete.continuity.missingBuckets = ["2026-09-01T03:48:00.000Z"];
  incomplete.continuity.coveragePct = 50;

  const out = buildH1DirectionResponseResearch([
    { tradeDate: "2026-09-01", replay: incomplete },
    { tradeDate: "2026-09-02", replay: oneIntervalReplay("2026-09-02", 0.03) },
  ]);

  assert.deepEqual(out.thresholdOos.evidenceQuality.calibrationIncompleteDates, ["2026-09-01"]);
  assert.deepEqual(out.thresholdOos.evidenceQuality.oosIncompleteDates, []);
  assert.equal(out.thresholdOos.evidenceQuality.allIncludedDatesComplete, false);
  assert.equal(out.thresholdOos.evidenceQuality.arbitraryCoverageCutoffApplied, false);
  assert.ok(out.thresholdOos.blockers.includes("DIRECTION_THRESHOLD_OOS_INCLUDES_INCOMPLETE_REPLAY_DATES"));
  assert.ok(out.blockers.includes("DIRECTION_POLICY_OOS_REPLAY_QUALITY_INCOMPLETE"));
  assert.equal(out.safety.temporalHoldoutEvaluated, false);
  assert.ok(out.blockers.includes("DIRECTION_POLICY_TEMPORAL_HOLDOUT_NOT_EVALUATED"));
  assert.equal(out.thresholdOos.selectedCandidate, null);
  assert.equal(out.thresholdOos.safety.thresholdPromoted, false);
  assert.equal(out.selectionRubricEvaluation.evaluated, false);
  assert.equal(out.selectionRubricEvaluation.researchPreferredLabel, null);
  assert.ok(out.selectionRubricEvaluation.blockers.includes("DIRECTION_SELECTION_RUBRIC_REPLAY_QUALITY_INCOMPLETE"));
});
