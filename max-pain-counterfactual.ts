export const MAX_PAIN_COUNTERFACTUAL_VERSION = "MAX_PAIN_COUNTERFACTUAL_REPLAY_V1" as const;

export type MaxPainLegacyContribution = -0.5 | 0 | 0.5;

export interface CounterfactualThreshold {
  id: string;
  value: number;
}

export interface MaxPainCounterfactualObservation {
  observationId: string;
  knownThen: true;
  timestamp: string;
  symbol: string;
  legacyScore: number;
  maxPainContribution: MaxPainLegacyContribution | null;
  legacyVerdict?: string | null;
  counterfactualVerdict?: string | null;
  legacyCandidate?: string | null;
  counterfactualCandidate?: string | null;
  dte?: number | null;
  regime?: string | null;
  distanceToMaxPainPct?: number | null;
  maxPainTruthUsable?: boolean | null;
}

export interface MaxPainCounterfactualRow {
  observationId: string;
  symbol: string;
  timestamp: string;
  legacyScore: number;
  counterfactualScore: number | null;
  maxPainContribution: MaxPainLegacyContribution | null;
  scoreChanged: boolean;
  thresholdCrossings: string[];
  verdictComparable: boolean;
  verdictFlipped: boolean;
  candidateComparable: boolean;
  candidateFlipped: boolean;
  included: boolean;
  exclusionReason: string | null;
  dte: number | null;
  regime: string | null;
  distanceToMaxPainPct: number | null;
}

export interface MaxPainCounterfactualSummary {
  version: typeof MAX_PAIN_COUNTERFACTUAL_VERSION;
  totalRows: number;
  includedRows: number;
  excludedRows: number;
  scoreChangedRows: number;
  thresholdCrossingRows: number;
  verdictComparableRows: number;
  verdictFlipRows: number;
  candidateComparableRows: number;
  candidateFlipRows: number;
  positiveLegacyVoteRows: number;
  negativeLegacyVoteRows: number;
  zeroLegacyVoteRows: number;
  impactRates: {
    thresholdCrossingPct: number | null;
    verdictFlipPctOfComparable: number | null;
    candidateFlipPctOfComparable: number | null;
  };
  rows: MaxPainCounterfactualRow[];
  safety: typeof PHASE49_MAX_PAIN_COUNTERFACTUAL_SAFETY;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function pct(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

function crossesThreshold(a: number, b: number, t: number): boolean {
  if (a === b) return false;
  return (a < t && b >= t) || (a >= t && b < t);
}

/**
 * Research-only counterfactual replay.
 * It removes exactly the already-recorded legacy Max Pain contribution from
 * the same KNOWN_THEN score. It never recomputes market data and never infers
 * unavailable verdict/candidate state.
 */
export function replayWithoutMaxPain(
  observations: MaxPainCounterfactualObservation[],
  thresholds: CounterfactualThreshold[] = [],
): MaxPainCounterfactualSummary {
  const rows: MaxPainCounterfactualRow[] = observations.map((o) => {
    let exclusionReason: string | null = null;
    if (o.knownThen !== true) exclusionReason = "NOT_KNOWN_THEN";
    else if (!o.observationId) exclusionReason = "MISSING_OBSERVATION_ID";
    else if (!finite(o.legacyScore)) exclusionReason = "INVALID_LEGACY_SCORE";
    else if (o.maxPainContribution == null) exclusionReason = "MAX_PAIN_CONTRIBUTION_UNKNOWN";
    else if (![-0.5, 0, 0.5].includes(o.maxPainContribution)) exclusionReason = "INVALID_MAX_PAIN_CONTRIBUTION";

    const included = exclusionReason == null;
    const counterfactualScore = included ? o.legacyScore - (o.maxPainContribution as number) : null;
    const thresholdCrossings = included && counterfactualScore != null
      ? thresholds
          .filter((t) => finite(t.value) && crossesThreshold(o.legacyScore, counterfactualScore, t.value))
          .map((t) => t.id)
      : [];

    const legacyVerdict = o.legacyVerdict ?? null;
    const cfVerdict = o.counterfactualVerdict ?? null;
    const verdictComparable = included && legacyVerdict != null && cfVerdict != null;
    const verdictFlipped = verdictComparable ? legacyVerdict !== cfVerdict : false;

    const legacyCandidate = o.legacyCandidate ?? null;
    const cfCandidate = o.counterfactualCandidate ?? null;
    const candidateComparable = included && legacyCandidate != null && cfCandidate != null;
    const candidateFlipped = candidateComparable ? legacyCandidate !== cfCandidate : false;

    return {
      observationId: o.observationId,
      symbol: o.symbol,
      timestamp: o.timestamp,
      legacyScore: o.legacyScore,
      counterfactualScore,
      maxPainContribution: o.maxPainContribution,
      scoreChanged: included && o.maxPainContribution !== 0,
      thresholdCrossings,
      verdictComparable,
      verdictFlipped,
      candidateComparable,
      candidateFlipped,
      included,
      exclusionReason,
      dte: finite(o.dte) ? o.dte : null,
      regime: o.regime ?? null,
      distanceToMaxPainPct: finite(o.distanceToMaxPainPct) ? o.distanceToMaxPainPct : null,
    };
  });

  const included = rows.filter((r) => r.included);
  const verdictComparable = included.filter((r) => r.verdictComparable);
  const candidateComparable = included.filter((r) => r.candidateComparable);
  const thresholdCrossingRows = included.filter((r) => r.thresholdCrossings.length > 0).length;
  const verdictFlipRows = verdictComparable.filter((r) => r.verdictFlipped).length;
  const candidateFlipRows = candidateComparable.filter((r) => r.candidateFlipped).length;

  return {
    version: MAX_PAIN_COUNTERFACTUAL_VERSION,
    totalRows: rows.length,
    includedRows: included.length,
    excludedRows: rows.length - included.length,
    scoreChangedRows: included.filter((r) => r.scoreChanged).length,
    thresholdCrossingRows,
    verdictComparableRows: verdictComparable.length,
    verdictFlipRows,
    candidateComparableRows: candidateComparable.length,
    candidateFlipRows,
    positiveLegacyVoteRows: included.filter((r) => r.maxPainContribution === 0.5).length,
    negativeLegacyVoteRows: included.filter((r) => r.maxPainContribution === -0.5).length,
    zeroLegacyVoteRows: included.filter((r) => r.maxPainContribution === 0).length,
    impactRates: {
      thresholdCrossingPct: pct(thresholdCrossingRows, included.length),
      verdictFlipPctOfComparable: pct(verdictFlipRows, verdictComparable.length),
      candidateFlipPctOfComparable: pct(candidateFlipRows, candidateComparable.length),
    },
    rows,
    safety: PHASE49_MAX_PAIN_COUNTERFACTUAL_SAFETY,
  };
}

export const PHASE49_MAX_PAIN_COUNTERFACTUAL_SAFETY = Object.freeze({
  researchOnly: true,
  knownThenOnly: true,
  readOnlyForTrading: true,
  affectsProductionScore: false,
  affectsVerdict: false,
  affectsTelegramTradeDecision: false,
  affectsExecution: false,
  noProductionThresholdInference: true,
  noFabricatedImpactRateWithoutRows: true,
});
