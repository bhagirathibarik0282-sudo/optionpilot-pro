import { loadKnownThenScoreObservations, scoreObservationShadowEnabled, type KnownThenScoreObservation } from "./score-observation-known-then.js";

export const PHASE51_READINESS_VERSION = "PHASE51_SHADOW_READINESS_V1" as const;

export type ShadowCollectionState = "DISABLED" | "ENABLED_NO_DATA" | "ENABLED_OBSERVING";

export interface Phase51CadenceSummary {
  intervalCount: number;
  minSeconds: number | null;
  medianSeconds: number | null;
  maxSeconds: number | null;
}

export interface Phase51ShadowReadinessReport {
  version: typeof PHASE51_READINESS_VERSION;
  architectureRole: "RESEARCH_SHADOW_OBSERVABILITY_ONLY";
  productionImpact: "NONE";
  collectionState: ShadowCollectionState;
  shadowFlagEnabled: boolean;
  totalRows: number;
  distinctObservationIds: number;
  duplicateObservationIds: number;
  symbolCounts: Record<string, number>;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  maxPainContributionKnownRows: number;
  maxPainContributionUnknownRows: number;
  maxPainContributionKnownRate: number | null;
  cadence: Phase51CadenceSummary;
  automaticActivationAllowed: false;
  productionReady: false;
  promotionDecision: "MANUAL_REVIEW_AFTER_MULTI_SESSION_SHADOW_VALIDATION";
  notes: string[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildPhase51ShadowReadinessReport(
  rows: KnownThenScoreObservation[],
  shadowFlagEnabled: boolean,
): Phase51ShadowReadinessReport {
  const ids = rows.map((r) => r.observationId).filter(Boolean);
  const distinctIds = new Set(ids).size;
  const symbolCounts: Record<string, number> = {};
  for (const row of rows) symbolCounts[row.symbol] = (symbolCounts[row.symbol] ?? 0) + 1;

  const orderedTimes = rows
    .map((r) => Date.parse(r.observedAt))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < orderedTimes.length; i++) {
    const seconds = (orderedTimes[i] - orderedTimes[i - 1]) / 1000;
    if (Number.isFinite(seconds) && seconds >= 0) intervals.push(seconds);
  }

  const knownMaxPain = rows.filter((r) => r.maxPainContribution === -0.5 || r.maxPainContribution === 0 || r.maxPainContribution === 0.5).length;
  const unknownMaxPain = rows.length - knownMaxPain;
  const notes: string[] = [];
  if (!shadowFlagEnabled) notes.push("Shadow collection flag is OFF; readiness report is observational only and does not enable collection.");
  if (shadowFlagEnabled && rows.length === 0) notes.push("Shadow flag is ON but no KNOWN_THEN score observations are available yet.");
  if (unknownMaxPain > 0) notes.push("Some observations have UNKNOWN Max Pain contribution and must be excluded from Max Pain removal impact denominators.");
  if (rows.length > 0) notes.push("Cadence metrics are descriptive only; Phase 51 does not freeze a production cadence threshold.");
  notes.push("Automatic production activation is forbidden; multi-session shadow validation plus explicit promotion review is required.");

  return {
    version: PHASE51_READINESS_VERSION,
    architectureRole: "RESEARCH_SHADOW_OBSERVABILITY_ONLY",
    productionImpact: "NONE",
    collectionState: !shadowFlagEnabled ? "DISABLED" : rows.length === 0 ? "ENABLED_NO_DATA" : "ENABLED_OBSERVING",
    shadowFlagEnabled,
    totalRows: rows.length,
    distinctObservationIds: distinctIds,
    duplicateObservationIds: Math.max(0, ids.length - distinctIds),
    symbolCounts,
    firstObservedAt: orderedTimes.length ? new Date(orderedTimes[0]).toISOString() : null,
    lastObservedAt: orderedTimes.length ? new Date(orderedTimes[orderedTimes.length - 1]).toISOString() : null,
    maxPainContributionKnownRows: knownMaxPain,
    maxPainContributionUnknownRows: unknownMaxPain,
    maxPainContributionKnownRate: rows.length ? knownMaxPain / rows.length : null,
    cadence: {
      intervalCount: intervals.length,
      minSeconds: intervals.length ? Math.min(...intervals) : null,
      medianSeconds: median(intervals),
      maxSeconds: intervals.length ? Math.max(...intervals) : null,
    },
    automaticActivationAllowed: false,
    productionReady: false,
    promotionDecision: "MANUAL_REVIEW_AFTER_MULTI_SESSION_SHADOW_VALIDATION",
    notes,
  };
}

export async function getPhase51ShadowReadiness(symbol?: string, limit = 5000): Promise<Phase51ShadowReadinessReport> {
  const rows = await loadKnownThenScoreObservations(symbol, limit);
  return buildPhase51ShadowReadinessReport(rows, scoreObservationShadowEnabled());
}

export const PHASE51_SAFETY = Object.freeze({
  readOnlyObservability: true,
  shadowFlagMutation: false,
  automaticActivationAllowed: false,
  productionReady: false,
  affectsProductionScore: false,
  affectsVerdict: false,
  affectsTelegramTradeDecision: false,
  affectsExecution: false,
  addsBrokerRequest: false,
  freezesCadenceThreshold: false,
});
