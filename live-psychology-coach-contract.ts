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
  | "EXIT"
  | "DATA_UNAVAILABLE";

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
  /** When supplied, Message Trigger Engine is authoritative about whether speech is eligible. */
  triggerShouldSpeak?: boolean;
  triggerReason?: string;
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

function baseDecision(input: LivePsychologyCoachInput, shouldSpeak: boolean, heading: string, risks: BehaviourRisk[], reason: string): LivePsychologyCoachDecision {
  return {
    version: "LIVE_PSYCHOLOGY_COACH_CONTRACT_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    scalpPriority: input.candidate.style === "SCALP",
    shouldSpeak,
    heading,
    lifecycle: input.lifecycle,
    risks,
    haikuMayDecideTradeState: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    reason,
  };
}

/**
 * Research-only contract for SCALP-first live coaching.
 * Deterministic engines decide state. When Message Trigger Engine output is supplied,
 * it alone decides whether speech is eligible. Haiku remains language-only.
 */
export function evaluateLivePsychologyCoach(input: LivePsychologyCoachInput): LivePsychologyCoachDecision {
  validateCandidate(input.candidate);

  const c = input.candidate;
  const heading = `${c.style === "SCALP" ? "🔥" : "📌"} ${c.style} • ${c.symbol.trim().toUpperCase()} ${c.strike} ${c.side} • ${input.lifecycle} • ${c.candidateId}`;
  const unavailable = !input.dataFresh || input.lifecycle === "DATA_UNAVAILABLE" || input.premiumBehaviour === "DATA_UNAVAILABLE" || input.buyerSellerState === "DATA_UNAVAILABLE" || input.risks.includes("DATA_UNAVAILABLE");

  if (input.triggerShouldSpeak !== undefined) {
    if (!input.triggerShouldSpeak) {
      return baseDecision(input, false, heading, input.risks, input.triggerReason || "Message Trigger Engine suppressed commentary.");
    }
    if (unavailable) {
      return baseDecision(input, true, heading, ["DATA_UNAVAILABLE"], "Live evidence incomplete; only a no-fresh-guidance message is eligible.");
    }
    return baseDecision(input, true, heading, input.risks, input.triggerReason || "Message Trigger Engine confirmed speech eligibility.");
  }

  // Backward-compatible standalone contract behavior.
  if (unavailable) {
    return baseDecision(input, true, heading, ["DATA_UNAVAILABLE"], "Live evidence incomplete; only a no-fresh-guidance message is eligible.");
  }

  if (!input.meaningfulChange) {
    return baseDecision(input, false, heading, input.risks, "No meaningful state change; suppress repeated commentary.");
  }

  if (input.consecutiveConfirmations < 2 && input.lifecycle !== "EXIT") {
    return baseDecision(input, false, heading, input.risks, "State change not persistent enough; hysteresis suppresses noise.");
  }

  return baseDecision(input, true, heading, input.risks, "Meaningful deterministic state change confirmed; language layer may explain it.");
}
