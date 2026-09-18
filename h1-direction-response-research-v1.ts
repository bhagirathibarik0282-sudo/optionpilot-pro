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
  evidenceState: "OBSERVATIONS_AVAILABLE_NO_POLICY_PROMOTION" | "INSUFFICIENT_REPLAY_OBSERVATIONS";
  blockers: string[];
  safety: {
    readOnly: true;
    thresholdSelected: false;
    thresholdPromoted: false;
    temporalHoldoutEvaluated: false;
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
type Observation = { absSpotMovePct: number; agreement: boolean };

function marketMoves(replay: H1ReplayHttpResult): MarketMove[] {
  const points: MarketPoint[] = (replay.market ?? [])
    .map((row) => ({ at: isoMs(row.minute_bucket), spot: n(row.spot_ltp) }))
    .filter((x): x is { at: number; spot: number } => x.at != null && x.spot != null && x.spot > 0)
    .sort((a, b) => a.at - b.at);

  const out: MarketMove[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (current.at <= previous.at) continue;
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
      out.push({ absSpotMovePct: Math.abs(move.movePct), agreement: observedPremiumDirection === expectedPremiumDirection });
    }
  }
  return out;
}

function agreementRate(rows: Observation[]): number | null {
  return rows.length ? rows.filter((x) => x.agreement).length / rows.length : null;
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

  const blockers = [
    "DIRECTION_POLICY_THRESHOLD_NOT_SELECTED",
    "DIRECTION_POLICY_TEMPORAL_HOLDOUT_NOT_EVALUATED",
  ];

  return {
    version: H1_DIRECTION_RESPONSE_RESEARCH_VERSION,
    productionImpact: "NONE",
    semantics: "DESCRIPTIVE_DIRECTION_RESPONSE_RESEARCH_ONLY_NO_THRESHOLD_SELECTION",
    dateSummaries: built.map((x) => x.summary),
    combinedComparableCount: combined.length,
    combinedAgreementRate: agreementRate(combined),
    combinedSpotMoveAbs: { p50, p75, p90, p95 },
    quantileBuckets,
    evidenceState: combined.length
      ? "OBSERVATIONS_AVAILABLE_NO_POLICY_PROMOTION"
      : "INSUFFICIENT_REPLAY_OBSERVATIONS",
    blockers,
    safety: {
      readOnly: true,
      thresholdSelected: false,
      thresholdPromoted: false,
      temporalHoldoutEvaluated: false,
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
