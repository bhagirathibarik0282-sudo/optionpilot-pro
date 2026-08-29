export type TradeStyle = "SCALP" | "SWING";
export type CandidateSide = "CE" | "PE";

export type PremiumBehaviourState =
  | "RESPONDING_WELL"
  | "WEAK_RESPONSE"
  | "OVEREXTENDED"
  | "IV_DRIVEN"
  | "THETA_PRESSURE"
  | "OPPOSITE_PREMIUM_WARNING"
  | "DIVERGING"
  | "DATA_UNAVAILABLE";

export type BuyerSellerState =
  | "BUYERS_IN_CONTROL"
  | "SELLERS_IN_CONTROL"
  | "BUYERS_LOSING_STRENGTH"
  | "SELLERS_LOSING_STRENGTH"
  | "BUYING_REJECTED"
  | "SELLING_REJECTED"
  | "SHORT_COVERING"
  | "LONG_UNWINDING"
  | "MARKET_UNDECIDED"
  | "DATA_UNAVAILABLE";

export type LifecycleState =
  | "WATCH"
  | "ENTRY_READY"
  | "ACTIVE"
  | "HOLD"
  | "PROTECT"
  | "PARTIAL_BOOK"
  | "TRAIL"
  | "EXIT";

export type BehaviourRisk =
  | "DO_NOT_CHASE"
  | "EARLY_EXIT_RISK"
  | "STOP_EXTENSION_RISK"
  | "REVENGE_FLIP_RISK"
  | "MISSED_MOVE_FOMO"
  | "AVERAGING_LOSER_RISK"
  | "EARLY_PROFIT_BOOKING_RISK"
  | "THESIS_WEAKENING"
  | "NO_FLIP_YET"
  | "DATA_UNAVAILABLE";

export interface CandidateIdentity {
  style: TradeStyle;
  symbol: string;
  strike: number;
  side: CandidateSide;
  expiryDate: string;
  candidateId: string;
}

export interface LivePsychologyCoachInput {
  candidate: CandidateIdentity;
  premiumBehaviour: PremiumBehaviourState;
  buyerSellerState: BuyerSellerState;
  lifecycle: LifecycleState;
  risks: BehaviourRisk[];
  dataFresh: boolean;
  meaningfulChange: boolean;
  consecutiveConfirmations: number;
}

export interface LivePsychologyCoachDecision {
  version: "LIVE_PSYCHOLOGY_COACH_CONTRACT_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  scalpPriority: boolean;
  shouldSpeak: boolean;
  heading: string;
  lifecycle: LifecycleState;
  risks: BehaviourRisk[];
  haikuMayDecideTradeState: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  reason: string;
}

function validateCandidate(candidate: CandidateIdentity): void {
  if (!candidate.symbol.trim()) throw new Error("symbol is required");
  if (!Number.isFinite(candidate.strike) || candidate.strike <= 0) throw new Error("valid strike is required");
  if (!candidate.expiryDate.trim()) throw new Error("expiryDate is required");
  if (!candidate.candidateId.trim()) throw new Error("candidateId is required");
}

/**
 * Research-only contract for SCALP-first live coaching.
 * Deterministic engines decide state; this function only decides whether a
 * meaningful, sufficiently confirmed state change is eligible to be spoken.
 * Haiku is downstream language-only and cannot change trade state.
 */
export function evaluateLivePsychologyCoach(input: LivePsychologyCoachInput): LivePsychologyCoachDecision {
  validateCandidate(input.candidate);

  const c = input.candidate;
  const heading = `${c.style === "SCALP" ? "🔥" : "📌"} ${c.style} • ${c.symbol.trim().toUpperCase()} ${c.strike} ${c.side} • ${input.lifecycle} • ${c.candidateId}`;

  if (!input.dataFresh || input.premiumBehaviour === "DATA_UNAVAILABLE" || input.buyerSellerState === "DATA_UNAVAILABLE" || input.risks.includes("DATA_UNAVAILABLE")) {
    return {
      version: "LIVE_PSYCHOLOGY_COACH_CONTRACT_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      scalpPriority: c.style === "SCALP",
      shouldSpeak: true,
      heading,
      lifecycle: input.lifecycle,
      risks: ["DATA_UNAVAILABLE"],
      haikuMayDecideTradeState: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      reason: "Live evidence incomplete; only a no-fresh-guidance message is eligible.",
    };
  }

  if (!input.meaningfulChange) {
    return {
      version: "LIVE_PSYCHOLOGY_COACH_CONTRACT_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      scalpPriority: c.style === "SCALP",
      shouldSpeak: false,
      heading,
      lifecycle: input.lifecycle,
      risks: input.risks,
      haikuMayDecideTradeState: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      reason: "No meaningful state change; suppress repeated commentary.",
    };
  }

  if (input.consecutiveConfirmations < 2 && input.lifecycle !== "EXIT") {
    return {
      version: "LIVE_PSYCHOLOGY_COACH_CONTRACT_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      scalpPriority: c.style === "SCALP",
      shouldSpeak: false,
      heading,
      lifecycle: input.lifecycle,
      risks: input.risks,
      haikuMayDecideTradeState: false,
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
      reason: "State change not persistent enough; hysteresis suppresses noise.",
    };
  }

  return {
    version: "LIVE_PSYCHOLOGY_COACH_CONTRACT_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    scalpPriority: c.style === "SCALP",
    shouldSpeak: true,
    heading,
    lifecycle: input.lifecycle,
    risks: input.risks,
    haikuMayDecideTradeState: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    reason: "Meaningful deterministic state change confirmed; language layer may explain it.",
  };
}
