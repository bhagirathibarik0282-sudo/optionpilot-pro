import type { ResearchIndexMetrics } from "./research-index-types.js";

export type HistoryTier = "LIVE" | "5D" | "20D" | "60D" | "1Y";
export type ContextBias = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNAVAILABLE";

export interface HistoryContextInput {
  latestMetrics: ResearchIndexMetrics | null;
  liveBias?: ContextBias;
}

export interface HistoryContextSnapshot {
  priority: readonly ["LIVE", "5D", "20D", "60D", "1Y"];
  liveBias: ContextBias;
  story5d: ContextBias;
  lens20d: ContextBias;
  context60d: ContextBias;
  context1y: ContextBias;
  historicalConflict: boolean;
  confidenceAdjustment: "NONE" | "REDUCE";
  reasons: string[];
  semantics: "HISTORICAL_CONTEXT_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  ruleVersion: "H1_HISTORY_ROUTER_V1";
}

export interface AnalogCase {
  id: string;
  similarity: number | null; // expected 0..1; null = unusable
  outcome: "CONTINUATION" | "BALANCE" | "FAILURE" | "UNKNOWN";
  regimeMatched: boolean;
  qualityEligible: boolean;
}

export interface AnalogSummary {
  usableCases: number;
  highSimilarityCases: number;
  continuation: number;
  balance: number;
  failure: number;
  unknown: number;
  evidenceQuality: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
  sampleDisclosure: string;
  probabilityClaimAllowed: false;
  semantics: "DESCRIPTIVE_ANALOG_ONLY";
  affectsVerdict: false;
  ruleVersion: "H1_ANALOG_SUMMARY_V1";
}

function biasFromReturn(v: number | null): ContextBias {
  if (v == null || !Number.isFinite(v)) return "UNAVAILABLE";
  if (v > 0.25) return "BULLISH";
  if (v < -0.25) return "BEARISH";
  return "NEUTRAL";
}

function conflictWithLive(live: ContextBias, history: ContextBias[]): boolean {
  if (live !== "BULLISH" && live !== "BEARISH") return false;
  const opposite = live === "BULLISH" ? "BEARISH" : "BULLISH";
  return history.some((x) => x === opposite);
}

/**
 * Historical context router only.
 * Priority is intentionally LIVE > 5D > 20D > 60D > 1Y.
 * History may reduce confidence when it conflicts with live structure, but cannot flip the live direction.
 */
export function buildHistoryContext(input: HistoryContextInput): HistoryContextSnapshot {
  const m = input.latestMetrics;
  const liveBias = input.liveBias ?? "UNAVAILABLE";
  const story5d = biasFromReturn(m?.return5d ?? null);
  const lens20d = biasFromReturn(m?.return20d ?? null);
  const context60d = biasFromReturn(m?.return60d ?? null);
  const context1y = biasFromReturn(m?.return252d ?? null);
  const historicalConflict = conflictWithLive(liveBias, [story5d, lens20d, context60d, context1y]);
  const reasons: string[] = ["Live structure has authority over every historical tier."];
  if (story5d === "UNAVAILABLE") reasons.push("5D story unavailable: insufficient verified observations.");
  if (context60d === "UNAVAILABLE") reasons.push("60D context unavailable: insufficient verified observations.");
  if (historicalConflict) reasons.push("Historical context conflicts with live bias; confidence may reduce but direction is not flipped.");

  return {
    priority: ["LIVE", "5D", "20D", "60D", "1Y"],
    liveBias,
    story5d,
    lens20d,
    context60d,
    context1y,
    historicalConflict,
    confidenceAdjustment: historicalConflict ? "REDUCE" : "NONE",
    reasons,
    semantics: "HISTORICAL_CONTEXT_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    ruleVersion: "H1_HISTORY_ROUTER_V1",
  };
}

/**
 * Descriptive analog summary only. It reports sample size and outcome counts,
 * never converts historical frequency into a current-trade probability.
 */
export function summarizeHistoricalAnalogs(cases: AnalogCase[]): AnalogSummary {
  const usable = cases.filter((c) =>
    c.qualityEligible && c.regimeMatched && typeof c.similarity === "number" && Number.isFinite(c.similarity) && c.similarity >= 0 && c.similarity <= 1
  );
  const highSimilarity = usable.filter((c) => (c.similarity as number) >= 0.75);
  const source = highSimilarity.length >= 5 ? highSimilarity : usable;
  const continuation = source.filter((c) => c.outcome === "CONTINUATION").length;
  const balance = source.filter((c) => c.outcome === "BALANCE").length;
  const failure = source.filter((c) => c.outcome === "FAILURE").length;
  const unknown = source.filter((c) => c.outcome === "UNKNOWN").length;

  const n = source.length;
  const evidenceQuality = n >= 30 ? "HIGH" : n >= 15 ? "MEDIUM" : n >= 5 ? "LOW" : "INSUFFICIENT";

  return {
    usableCases: usable.length,
    highSimilarityCases: highSimilarity.length,
    continuation,
    balance,
    failure,
    unknown,
    evidenceQuality,
    sampleDisclosure: n > 0
      ? `Descriptive sample only: ${n} regime-matched usable analog cases; no current-trade probability inferred.`
      : "No usable regime-matched analog sample is available.",
    probabilityClaimAllowed: false,
    semantics: "DESCRIPTIVE_ANALOG_ONLY",
    affectsVerdict: false,
    ruleVersion: "H1_ANALOG_SUMMARY_V1",
  };
}
