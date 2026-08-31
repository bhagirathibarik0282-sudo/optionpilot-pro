export type ImmediateSide = "CE" | "PE" | "NONE";
export type ImmediateVerdict = "CE_FAVOURED" | "PE_FAVOURED" | "WAIT";
export type ImmediateAlignment = "FAVOURS_TREND" | "CONFLICTS_TREND" | "VOLATILITY_ONLY" | "NEUTRAL";
export type ImmediateEventFamily =
  | "SPOT"
  | "FUTURES"
  | "FUTURES_OI"
  | "PCR"
  | "CALL_WALL"
  | "PUT_WALL"
  | "CE_PREMIUM"
  | "PE_PREMIUM"
  | "CE_IV"
  | "PE_IV"
  | "ATM_IV"
  | "INDIA_VIX"
  | "CROSS_INDEX";

export interface ImmediateVerifiedEvent {
  id: string;
  family: ImmediateEventFamily;
  occurredAt: string;
  fact: string;
  abnormalImmediateChange: boolean;
  fresh: boolean;
  alignment: ImmediateAlignment;
}

export interface ImmediateExpansionChainInput {
  symbol: string;
  lockedTrendSide: ImmediateSide;
  trendValid: boolean;
  clusterReady: boolean;
  events: ImmediateVerifiedEvent[];
}

export interface ImmediateExpansionChainResult {
  version: "IMMEDIATE_EXPANSION_CHAIN_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  symbol: string;
  verdict: ImmediateVerdict;
  whyNow: string;
  whatToWatch: string;
  invalidation: string;
  immediateEvents: ImmediateVerifiedEvent[];
  haikuFacts: string[];
  haikuMayChangeVerdict: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function sideVerdict(side: ImmediateSide): ImmediateVerdict {
  if (side === "CE") return "CE_FAVOURED";
  if (side === "PE") return "PE_FAVOURED";
  return "WAIT";
}

function watchText(side: ImmediateSide): string {
  if (side === "CE") return "Watch CE continuation, PE weakness, futures support, and fresh cross-index agreement.";
  if (side === "PE") return "Watch PE continuation, CE weakness, futures downside support, and fresh cross-index agreement.";
  return "Watch which premium side gains immediate expansion while the opposite leg weakens and cross-index evidence agrees.";
}

function invalidationText(side: ImmediateSide): string {
  if (side === "CE") return "Confidence weakens if PE re-expands, put support sheds, futures support fails, or cross-index alignment breaks.";
  if (side === "PE") return "Confidence weakens if CE re-expands, call resistance sheds against the bearish thesis, futures downside fails, or cross-index alignment breaks.";
  return "No directional invalidation is defined until a side is deterministically favoured.";
}

/**
 * Deterministic research-only chain for the user's "immediate expansion" concept.
 * Upstream logic owns thresholding, trend selection, freshness and cluster readiness.
 * This layer never invents thresholds, never infers participant identity, and never lets Haiku choose a side.
 */
export function evaluateImmediateExpansionChain(input: ImmediateExpansionChainInput): ImmediateExpansionChainResult {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("symbol is required");

  const immediateEvents = input.events
    .filter((event) => event.abnormalImmediateChange && event.fresh && event.fact.trim())
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const supportsTrend = immediateEvents.filter((event) => event.alignment === "FAVOURS_TREND");
  const conflictsTrend = immediateEvents.filter((event) => event.alignment === "CONFLICTS_TREND");
  const volatilityOnly = immediateEvents.filter((event) => event.alignment === "VOLATILITY_ONLY");

  let verdict: ImmediateVerdict = "WAIT";
  let whyNow = "No fresh abnormal immediate change is ready for a directional message.";

  if (!input.trendValid || input.lockedTrendSide === "NONE") {
    whyNow = volatilityOnly.length > 0
      ? "Immediate volatility expansion is present, but there is no locked directional trend."
      : "Directional trend is not locked, so the engine must wait.";
  } else if (conflictsTrend.length > 0) {
    whyNow = `Immediate evidence is conflicting: ${conflictsTrend[0].fact}`;
  } else if (input.clusterReady && supportsTrend.length > 0) {
    verdict = sideVerdict(input.lockedTrendSide);
    whyNow = supportsTrend.map((event) => event.fact.trim()).slice(0, 3).join(" ");
  } else if (supportsTrend.length > 0) {
    whyNow = `${supportsTrend[0].fact.trim()} Directional evidence is improving, but the synchronized cluster is not ready yet.`;
  } else if (volatilityOnly.length > 0) {
    whyNow = `${volatilityOnly[0].fact.trim()} This is volatility expansion, not a clean directional confirmation.`;
  }

  const haikuFacts = immediateEvents.map((event) => `${event.occurredAt} ${event.family}: ${event.fact.trim()}`).slice(0, 6);

  return {
    version: "IMMEDIATE_EXPANSION_CHAIN_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    symbol,
    verdict,
    whyNow,
    whatToWatch: watchText(verdict === "CE_FAVOURED" ? "CE" : verdict === "PE_FAVOURED" ? "PE" : "NONE"),
    invalidation: invalidationText(verdict === "CE_FAVOURED" ? "CE" : verdict === "PE_FAVOURED" ? "PE" : "NONE"),
    immediateEvents,
    haikuFacts,
    haikuMayChangeVerdict: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
