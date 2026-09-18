import type { H1ReplayHttpResult } from "./h1-replay-http.js";

export const H1_DIRECTION_RESPONSE_RESEARCH_VERSION = "H1_DIRECTION_RESPONSE_RESEARCH_V1" as const;

type Side = "CE" | "PE";

export interface H1DirectionResponseResearchInput {
  tradeDate: string;
  replay: H1ReplayHttpResult;
}

export interface H1DirectionResponseDateSummary {
  tradeDate: string;
  marketPairCount: number;
  comparableCount: number;
  agreementRate: number | null;
  spotMoveAbsP50: number | null;
  spotMoveAbsP75: number | null;
  spotMoveAbsP90: number | null;
  spotMoveAbsP95: number | null;
}

export interface H1DirectionResponseQuantileBucket {
  label: "LE_P50" | "P50_P75" | "P75_P90" | "P90_P95" | "GT_P95";
  minExclusive: number | null;
  maxInclusive: number | null;
  sampleCount: number;
  agreementRate: number | null;
}

export interface H1DirectionResponseIntervalWeightedDateSummary {
  tradeDate: string;
  intervalCount: number;
  bothSidesPresentIntervalCount: number;
  meanSideBalancedAgreementShare: number | null;
  strictMajorityIntervalRate: number | null;
}

export interface H1DirectionResponseIntervalWeightedSummary {
  methodology: "EQUAL_INTERVAL_WEIGHT_EQUAL_SIDE_WEIGHT_WITHIN_INTERVAL";
  intervalCount: number;
  bothSidesPresentIntervalCount: number;
  meanSideBalancedAgreementShare: number | null;
  strictMajorityIntervalRate: number | null;
  dateSummaries: H1DirectionResponseIntervalWeightedDateSummary[];
}

export interface H1DirectionThresholdCandidateWindow {
  intervalCount: number;
  retentionRate: number | null;
  meanSideBalancedAgreementShare: number | null;
  strictMajorityIntervalRate: number | null;
}

export interface H1DirectionThresholdCandidateEvaluation {
  label: "P50" | "P75" | "P90" | "P95";
  thresholdPct: number;
  calibration: H1DirectionThresholdCandidateWindow;
  oos: H1DirectionThresholdCandidateWindow;
}

export interface H1DirectionThresholdOosMatrix {
  version: "H1_DIRECTION_THRESHOLD_OOS_MATRIX_V1";
  semantics: "CALIBRATION_DERIVED_CANDIDATES_OOS_EVALUATION_NO_SELECTION";
  split: "CHRONOLOGICAL_70_30_NONEMPTY_DATES";
  calibrationDates: string[];
  oosDates: string[];
  calibrationIntervalCount: number;
  oosIntervalCount: number;
  candidates: H1DirectionThresholdCandidateEvaluation[];
  selectedCandidate: null;
  temporalCandidateMatrixEvaluated: boolean;
  evidenceQuality: {
    methodology: "REPLAY_CONTINUITY_VISIBILITY_ONLY_NO_ARBITRARY_COVERAGE_CUTOFF";
    calibrationIncompleteDates: string[];
    oosIncompleteDates: string[];
    calibrationContinuityUnknownDates: string[];
    oosContinuityUnknownDates: string[];
    allIncludedDatesComplete: boolean;
    arbitraryCoverageCutoffApplied: false;
  };
  blockers: string[];
  safety: {
    readOnly: true;
    thresholdSelected: false;
    thresholdPromoted: false;
    affectsSelector: false;
    affectsTelegram: false;
    affectsVerdict: false;
    affectsExecution: false;
    grantsPromotionAuthority: false;
    failClosed: true;
  };
}

export interface H1DirectionResponseResearchResult {
  version: typeof H1_DIRECTION_RESPONSE_RESEARCH_VERSION;
  productionImpact: "NONE";
  semantics: "DESCRIPTIVE_DIRECTION_RESPONSE_RESEARCH_ONLY_NO_THRESHOLD_SELECTION";
  dateSummaries: H1DirectionResponseDateSummary[];
  combinedComparableCount: number;
  combinedAgreementRate: number | null;
  combinedSpotMoveAbs: {
    p50: number | null;
    p75: number | null;
    p90: number | null;
    p95: number | null;
  };
  quantileBuckets: H1DirectionResponseQuantileBucket[];
  intervalWeighted: H1DirectionResponseIntervalWeightedSummary;
  thresholdOos: H1DirectionThresholdOosMatrix;
  evidenceState: "OBSERVATIONS_AVAILABLE_NO_POLICY_PROMOTION" | "INSUFFICIENT_REPLAY_OBSERVATIONS";
  blockers: string[];
  safety: {
    readOnly: true;
    thresholdSelected: false;
    thresholdPromoted: false;
    temporalHoldoutEvaluated: boolean;
    policySelectionRubricDefined: false;
    affectsSelector: false;
    affectsTelegram: false;
    affectsVerdict: false;
    affectsExecution: false;
    grantsPromotionAuthority: false;
    failClosed: true;
  };
}

function n(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isoMs(value: unknown): number | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function quantile(values: number[], p: number): number | null {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

type MarketPoint = { at: number; spot: number };
type MarketMove = { from: number; to: number; movePct: number };
type OptionPoint = { at: number; ltp: number };
type Observation = {
  from: number;
  to: number;
  side: Side;
  absSpotMovePct: number;
  agreement: boolean;
};

function expectedGridMs(replay: H1ReplayHttpResult): Set<number> | null {
  const request = replay.request;
  if (!request) return null;
  const start = Date.parse(`${request.tradeDate}T${request.fromTime}:00+05:30`);
  const end = Date.parse(`${request.tradeDate}T${request.toTime}:00+05:30`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  const out = new Set<number>();
  for (let t = start; t <= end; t += 3 * 60_000) out.add(t);
  return out;
}

function marketMoves(replay: H1ReplayHttpResult): MarketMove[] {
  const expected = expectedGridMs(replay);
  if (!expected) return [];

  const points: MarketPoint[] = (replay.market ?? [])
    .map((row) => ({ at: isoMs(row.minute_bucket), spot: n(row.spot_ltp) }))
    .filter((x): x is { at: number; spot: number } =>
      x.at != null &&
      x.spot != null &&
      x.spot > 0 &&
      expected.has(x.at),
    )
    .sort((a, b) => a.at - b.at);

  const out: MarketMove[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (current.at <= previous.at) continue;
    if (current.at - previous.at !== 180_000) continue;
    const movePct = ((current.spot - previous.spot) / previous.spot) * 100;
    if (!Number.isFinite(movePct)) continue;
    out.push({ from: previous.at, to: current.at, movePct });
  }
  return out;
}

function identity(row: Record<string, unknown>): string | null {
  const expiry = typeof row.expiry === "string" || row.expiry instanceof Date ? String(row.expiry) : null;
  const strike = n(row.strike);
  const side = String(row.option_type ?? "") as Side;
  if (!expiry || strike == null || strike <= 0 || (side !== "CE" && side !== "PE")) return null;
  return `${expiry}|${strike}|${side}`;
}

function observations(replay: H1ReplayHttpResult, moves: MarketMove[]): Observation[] {
  const byContract = new Map<string, { side: Side; points: Map<number, number> }>();

  for (const row of replay.options ?? []) {
    const key = identity(row);
    const at = isoMs(row.minute_bucket);
    const ltp = n(row.ltp);
    if (!key || at == null || ltp == null || ltp <= 0) continue;
    const side = String(row.option_type) as Side;
    const item = byContract.get(key) ?? { side, points: new Map<number, number>() };
    item.points.set(at, ltp);
    byContract.set(key, item);
  }

  const out: Observation[] = [];
  for (const { side, points } of byContract.values()) {
    for (const move of moves) {
      const previous = points.get(move.from);
      const current = points.get(move.to);
      if (previous == null || current == null || previous <= 0) continue;
      const premiumMovePct = ((current - previous) / previous) * 100;
      if (!Number.isFinite(premiumMovePct) || premiumMovePct === 0 || move.movePct === 0) continue;
      const spotDirection = move.movePct > 0 ? 1 : -1;
      const expectedPremiumDirection = side === "CE" ? spotDirection : -spotDirection;
      const observedPremiumDirection = premiumMovePct > 0 ? 1 : -1;
      out.push({
        from: move.from,
        to: move.to,
        side,
        absSpotMovePct: Math.abs(move.movePct),
        agreement: observedPremiumDirection === expectedPremiumDirection,
      });
    }
  }
  return out;
}

function agreementRate(rows: Observation[]): number | null {
  return rows.length ? rows.filter((x) => x.agreement).length / rows.length : null;
}

type IntervalScore = {
  absSpotMovePct: number;
  bothSidesPresent: boolean;
  sideBalancedAgreementShare: number;
};

function intervalScores(rows: Observation[]): IntervalScore[] {
  const grouped = new Map<string, { CE: Observation[]; PE: Observation[] }>();
  for (const row of rows) {
    const key = `${row.from}|${row.to}`;
    const item = grouped.get(key) ?? { CE: [], PE: [] };
    item[row.side].push(row);
    grouped.set(key, item);
  }

  const out: IntervalScore[] = [];
  for (const item of grouped.values()) {
    const ce = agreementRate(item.CE);
    const pe = agreementRate(item.PE);
    const available = [ce, pe].filter((x): x is number => x != null);
    if (!available.length) continue;
    const first = item.CE[0] ?? item.PE[0];
    if (!first) continue;
    out.push({
      absSpotMovePct: first.absSpotMovePct,
      bothSidesPresent: ce != null && pe != null,
      sideBalancedAgreementShare: available.reduce((sum, x) => sum + x, 0) / available.length,
    });
  }
  return out;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, x) => sum + x, 0) / values.length : null;
}

function thresholdWindow(scores: IntervalScore[], thresholdPct: number): H1DirectionThresholdCandidateWindow {
  const filtered = scores.filter((x) => x.absSpotMovePct >= thresholdPct);
  return {
    intervalCount: filtered.length,
    retentionRate: scores.length ? filtered.length / scores.length : null,
    meanSideBalancedAgreementShare: mean(filtered.map((x) => x.sideBalancedAgreementShare)),
    strictMajorityIntervalRate: filtered.length
      ? filtered.filter((x) => x.sideBalancedAgreementShare > 0.5).length / filtered.length
      : null,
  };
}

function buildThresholdOosMatrix(
  usable: H1DirectionResponseResearchInput[],
  built: Array<{ summary: H1DirectionResponseDateSummary; observations: Observation[] }>,
): H1DirectionThresholdOosMatrix {
  const days = built
    .map((x, index) => {
      const replay = usable[index]?.replay;
      const continuityComplete = replay?.continuity?.complete;
      return {
        tradeDate: usable[index]?.tradeDate ?? "UNKNOWN",
        scores: intervalScores(x.observations),
        continuityComplete: continuityComplete === true ? true : continuityComplete === false ? false : null,
      };
    })
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.tradeDate) && x.scores.length > 0)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  const blockers: string[] = ["DIRECTION_THRESHOLD_CANDIDATE_NOT_SELECTED"];
  if (days.length < 2) blockers.push("DIRECTION_THRESHOLD_OOS_REQUIRES_2_NONEMPTY_DATES");

  const cut = days.length >= 2 ? Math.max(1, Math.floor(days.length * 0.7)) : days.length;
  const calibrationDays = days.slice(0, cut);
  const oosDays = days.slice(cut);
  const calibrationScores = calibrationDays.flatMap((x) => x.scores);
  const oosScores = oosDays.flatMap((x) => x.scores);
  const calibrationIncompleteDates = calibrationDays.filter((x) => x.continuityComplete === false).map((x) => x.tradeDate);
  const oosIncompleteDates = oosDays.filter((x) => x.continuityComplete === false).map((x) => x.tradeDate);
  const calibrationContinuityUnknownDates = calibrationDays.filter((x) => x.continuityComplete == null).map((x) => x.tradeDate);
  const oosContinuityUnknownDates = oosDays.filter((x) => x.continuityComplete == null).map((x) => x.tradeDate);
  const allIncludedDatesComplete =
    days.length > 0 &&
    calibrationIncompleteDates.length === 0 &&
    oosIncompleteDates.length === 0 &&
    calibrationContinuityUnknownDates.length === 0 &&
    oosContinuityUnknownDates.length === 0;

  if (calibrationIncompleteDates.length || oosIncompleteDates.length) {
    blockers.push("DIRECTION_THRESHOLD_OOS_INCLUDES_INCOMPLETE_REPLAY_DATES");
  }
  if (calibrationContinuityUnknownDates.length || oosContinuityUnknownDates.length) {
    blockers.push("DIRECTION_THRESHOLD_OOS_REPLAY_CONTINUITY_UNAVAILABLE");
  }

  const specs = [
    ["P50", 0.5],
    ["P75", 0.75],
    ["P90", 0.9],
    ["P95", 0.95],
  ] as const;

  const candidates = calibrationScores.length && oosScores.length
    ? specs.flatMap(([label, q]) => {
        const thresholdPct = quantile(calibrationScores.map((x) => x.absSpotMovePct), q);
        if (thresholdPct == null) return [];
        return [{
          label,
          thresholdPct,
          calibration: thresholdWindow(calibrationScores, thresholdPct),
          oos: thresholdWindow(oosScores, thresholdPct),
        }];
      })
    : [];

  if (!candidates.length) blockers.push("DIRECTION_THRESHOLD_OOS_CANDIDATES_UNAVAILABLE");

  return {
    version: "H1_DIRECTION_THRESHOLD_OOS_MATRIX_V1",
    semantics: "CALIBRATION_DERIVED_CANDIDATES_OOS_EVALUATION_NO_SELECTION",
    split: "CHRONOLOGICAL_70_30_NONEMPTY_DATES",
    calibrationDates: calibrationDays.map((x) => x.tradeDate),
    oosDates: oosDays.map((x) => x.tradeDate),
    calibrationIntervalCount: calibrationScores.length,
    oosIntervalCount: oosScores.length,
    candidates,
    selectedCandidate: null,
    temporalCandidateMatrixEvaluated: candidates.length > 0,
    evidenceQuality: {
      methodology: "REPLAY_CONTINUITY_VISIBILITY_ONLY_NO_ARBITRARY_COVERAGE_CUTOFF",
      calibrationIncompleteDates,
      oosIncompleteDates,
      calibrationContinuityUnknownDates,
      oosContinuityUnknownDates,
      allIncludedDatesComplete,
      arbitraryCoverageCutoffApplied: false,
    },
    blockers,
    safety: {
      readOnly: true,
      thresholdSelected: false,
      thresholdPromoted: false,
      affectsSelector: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      grantsPromotionAuthority: false,
      failClosed: true,
    },
  };
}

function intervalWeightedDateSummary(
  tradeDate: string,
  rows: Observation[],
): H1DirectionResponseIntervalWeightedDateSummary {
  const scores = intervalScores(rows);
  return {
    tradeDate,
    intervalCount: scores.length,
    bothSidesPresentIntervalCount: scores.filter((x) => x.bothSidesPresent).length,
    meanSideBalancedAgreementShare: mean(scores.map((x) => x.sideBalancedAgreementShare)),
    strictMajorityIntervalRate: scores.length
      ? scores.filter((x) => x.sideBalancedAgreementShare > 0.5).length / scores.length
      : null,
  };
}

function dateSummary(input: H1DirectionResponseResearchInput): { summary: H1DirectionResponseDateSummary; observations: Observation[] } {
  const moves = marketMoves(input.replay);
  const obs = observations(input.replay, moves);
  const absMoves = moves.map((x) => Math.abs(x.movePct));
  return {
    summary: {
      tradeDate: input.tradeDate,
      marketPairCount: moves.length,
      comparableCount: obs.length,
      agreementRate: agreementRate(obs),
      spotMoveAbsP50: quantile(absMoves, 0.5),
      spotMoveAbsP75: quantile(absMoves, 0.75),
      spotMoveAbsP90: quantile(absMoves, 0.9),
      spotMoveAbsP95: quantile(absMoves, 0.95),
    },
    observations: obs,
  };
}

export function buildH1DirectionResponseResearch(inputs: H1DirectionResponseResearchInput[]): H1DirectionResponseResearchResult {
  const usable = (inputs ?? []).filter((x) => x?.replay?.ok);
  const built = usable.map(dateSummary);
  const combined = built.flatMap((x) => x.observations);
  const magnitudes = combined.map((x) => x.absSpotMovePct);
  const p50 = quantile(magnitudes, 0.5);
  const p75 = quantile(magnitudes, 0.75);
  const p90 = quantile(magnitudes, 0.9);
  const p95 = quantile(magnitudes, 0.95);

  const specs: Array<H1DirectionResponseQuantileBucket["label"]> = ["LE_P50", "P50_P75", "P75_P90", "P90_P95", "GT_P95"];
  const ranges: Array<[number | null, number | null]> = [
    [null, p50],
    [p50, p75],
    [p75, p90],
    [p90, p95],
    [p95, null],
  ];

  const quantileBuckets = specs.map((label, index) => {
    const [minExclusive, maxInclusive] = ranges[index];
    const rows = combined.filter((x) =>
      (minExclusive == null || x.absSpotMovePct > minExclusive) &&
      (maxInclusive == null || x.absSpotMovePct <= maxInclusive),
    );
    return {
      label,
      minExclusive,
      maxInclusive,
      sampleCount: rows.length,
      agreementRate: agreementRate(rows),
    };
  });

  const intervalDateSummaries = built.map((x, index) =>
    intervalWeightedDateSummary(usable[index]?.tradeDate ?? "UNKNOWN", x.observations),
  );
  const combinedIntervalScores = built.flatMap((x) => intervalScores(x.observations));
  const thresholdOos = buildThresholdOosMatrix(usable, built);
  const temporalHoldoutEvaluated =
    thresholdOos.temporalCandidateMatrixEvaluated &&
    thresholdOos.evidenceQuality.allIncludedDatesComplete;

  const blockers = [
    "DIRECTION_POLICY_THRESHOLD_NOT_SELECTED",
    ...(temporalHoldoutEvaluated ? [] : ["DIRECTION_POLICY_TEMPORAL_HOLDOUT_NOT_EVALUATED"]),
    "DIRECTION_POLICY_SELECTION_RUBRIC_NOT_DEFINED",
  ];
  if (!thresholdOos.evidenceQuality.allIncludedDatesComplete) {
    blockers.push("DIRECTION_POLICY_OOS_REPLAY_QUALITY_INCOMPLETE");
  }

  return {
    version: H1_DIRECTION_RESPONSE_RESEARCH_VERSION,
    productionImpact: "NONE",
    semantics: "DESCRIPTIVE_DIRECTION_RESPONSE_RESEARCH_ONLY_NO_THRESHOLD_SELECTION",
    dateSummaries: built.map((x) => x.summary),
    combinedComparableCount: combined.length,
    combinedAgreementRate: agreementRate(combined),
    combinedSpotMoveAbs: { p50, p75, p90, p95 },
    quantileBuckets,
    intervalWeighted: {
      methodology: "EQUAL_INTERVAL_WEIGHT_EQUAL_SIDE_WEIGHT_WITHIN_INTERVAL",
      intervalCount: combinedIntervalScores.length,
      bothSidesPresentIntervalCount: combinedIntervalScores.filter((x) => x.bothSidesPresent).length,
      meanSideBalancedAgreementShare: mean(combinedIntervalScores.map((x) => x.sideBalancedAgreementShare)),
      strictMajorityIntervalRate: combinedIntervalScores.length
        ? combinedIntervalScores.filter((x) => x.sideBalancedAgreementShare > 0.5).length / combinedIntervalScores.length
        : null,
      dateSummaries: intervalDateSummaries,
    },
    thresholdOos,
    evidenceState: combined.length
      ? "OBSERVATIONS_AVAILABLE_NO_POLICY_PROMOTION"
      : "INSUFFICIENT_REPLAY_OBSERVATIONS",
    blockers,
    safety: {
      readOnly: true,
      thresholdSelected: false,
      thresholdPromoted: false,
      temporalHoldoutEvaluated,
      policySelectionRubricDefined: false,
      affectsSelector: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      grantsPromotionAuthority: false,
      failClosed: true,
    },
  };
}
