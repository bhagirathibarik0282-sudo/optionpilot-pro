import type { DataQualityStatus, ResearchIndexMetrics, ResearchIndexCode } from "./research-index-types.js";
import { classifySizeRegime, type SizeRegimeOutput } from "./research-size-regime.js";

export type ThesisBias = "BULLISH" | "BEARISH" | "NEUTRAL" | "CONFLICTING" | "UNAVAILABLE";
export type ThesisConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export interface MarketStoryInput {
  observedAt: string;
  dataQuality: DataQualityStatus;
  metrics: Partial<Record<ResearchIndexCode, ResearchIndexMetrics>>;
  liveDirection?: ThesisBias | null;
  fiveDayRegimePath?: string[];
  sixtyDayContext?: string | null;
}

export interface HistoricalMarketStory {
  observedAt: string;
  sizeRegime: SizeRegimeOutput;
  leadership: string[];
  laggards: string[];
  rotationState: string;
  fiveDayStory: string[];
  sixtyDayContext: string | null;
  historicalBias: ThesisBias;
  confidence: ThesisConfidence;
  conflictWithLive: boolean;
  baseCase: string;
  alternativeCase: string;
  invalidation: string;
  unknowns: string[];
  ruleVersion: "H1_MARKET_STORY_THESIS_V1";
  semantics: "HISTORICAL_CONTEXT_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function rankBy20d(metrics: Partial<Record<ResearchIndexCode, ResearchIndexMetrics>>) {
  const rows = Object.entries(metrics)
    .map(([code, m]) => ({ code, rs20: m?.rsVsNifty50_20d ?? null }))
    .filter((x): x is { code: string; rs20: number } => finite(x.rs20))
    .sort((a, b) => b.rs20 - a.rs20);
  return rows;
}

function biasFromRegime(regime: SizeRegimeOutput): ThesisBias {
  if (regime.dataQuality === "INVALID") return "UNAVAILABLE";
  if (regime.conflict) return "CONFLICTING";
  if (regime.state === "BROAD_RISK_ON" || regime.state === "MIDCAP_EXPANSION" || regime.state === "EMERGING_LARGECAP_ROTATION") return "BULLISH";
  if (regime.state === "BROAD_RISK_OFF") return "BEARISH";
  if (regime.state === "NARROW_LARGECAP_RALLY" || regime.state === "SMALLCAP_SPECULATION" || regime.state === "SIZE_ROTATION") return "NEUTRAL";
  return "UNAVAILABLE";
}

function confidenceFromQuality(quality: DataQualityStatus, conflict: boolean, availableMetrics: number): ThesisConfidence {
  if (quality === "INVALID" || availableMetrics < 3) return "INSUFFICIENT";
  if (quality === "STALE" || conflict) return "LOW";
  if (quality === "PARTIAL") return "MEDIUM";
  return availableMetrics >= 5 ? "HIGH" : "MEDIUM";
}

export function buildHistoricalMarketStory(input: MarketStoryInput): HistoricalMarketStory {
  const sizeRegime = classifySizeRegime({ metrics: input.metrics, dataQuality: input.dataQuality });
  const ranked = rankBy20d(input.metrics);
  const leadership = ranked.slice(0, 3).map((x) => `${x.code}:${x.rs20.toFixed(2)}`);
  const laggards = [...ranked].reverse().slice(0, 3).map((x) => `${x.code}:${x.rs20.toFixed(2)}`);
  const historicalBias = biasFromRegime(sizeRegime);
  const conflictWithLive = !!input.liveDirection &&
    input.liveDirection !== "UNAVAILABLE" && input.liveDirection !== "NEUTRAL" &&
    historicalBias !== "UNAVAILABLE" && historicalBias !== "NEUTRAL" &&
    historicalBias !== input.liveDirection;

  const unknowns: string[] = [];
  if (sizeRegime.strength === "UNKNOWN") unknowns.push("REGIME_STRENGTH_UNCALIBRATED");
  if (input.dataQuality !== "GOOD") unknowns.push(`DATA_QUALITY_${input.dataQuality}`);
  if (ranked.length < 5) unknowns.push("LIMITED_7_INDEX_METRIC_COVERAGE");

  const confidence = confidenceFromQuality(input.dataQuality, sizeRegime.conflict || conflictWithLive, ranked.length);

  const baseCase = historicalBias === "BULLISH"
    ? "Broad/leadership context remains constructive while live structure stays valid."
    : historicalBias === "BEARISH"
      ? "Broad/leadership context remains defensive while live structure stays valid."
      : "Historical context is rotational/mixed; current live structure must lead.";

  const alternativeCase = sizeRegime.transition === "DECELERATING"
    ? "Leadership may be fading into rotation or balance."
    : sizeRegime.transition === "ACCELERATING"
      ? "Participation may broaden further if current leadership persists."
      : "A different live regime may emerge; history should only adjust context/confidence.";

  const invalidation = "Historical thesis is invalidated as a decision aid whenever current live truth/regime/entry-risk evidence conflicts materially; live state remains authoritative.";

  return {
    observedAt: input.observedAt,
    sizeRegime,
    leadership,
    laggards,
    rotationState: sizeRegime.state,
    fiveDayStory: input.fiveDayRegimePath ?? [],
    sixtyDayContext: input.sixtyDayContext ?? null,
    historicalBias,
    confidence,
    conflictWithLive,
    baseCase,
    alternativeCase,
    invalidation,
    unknowns,
    ruleVersion: "H1_MARKET_STORY_THESIS_V1",
    semantics: "HISTORICAL_CONTEXT_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}
