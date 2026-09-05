export type BusinessHorizon = "INTRADAY" | "MULTIDAY" | "EXPIRY";
export type BusinessRole = "OPTION_BUYER" | "OPTION_SELLER";
export type BusinessAction = "BUYER_EDGE" | "SELLER_EDGE" | "WAIT";

export interface BusinessHorizonInput {
  horizon: BusinessHorizon;
  /** 0..100 presentation score built from already-computed deterministic evidence. */
  buyerScore: number | null;
  /** 0..100 presentation score built from already-computed deterministic evidence. */
  sellerScore: number | null;
  evidenceReady: boolean;
  devilFlags?: string[];
  reasons?: string[];
}

export interface BusinessHorizonView {
  horizon: BusinessHorizon;
  action: BusinessAction;
  buyerStars: 1 | 2 | 3 | 4 | 5;
  sellerStars: 1 | 2 | 3 | 4 | 5;
  headline: string;
  reasons: string[];
  devilCheck: "PASS" | "CAUTION";
}

export interface BuyerTelegramGateInput {
  /** Explicit business role. Never infer this from CE/PE or BUY/SELL directional labels. */
  role: BusinessRole;
  candidateStatus: "READY" | "WATCH" | "BLOCKED" | "DATA_UNAVAILABLE";
  qualityStars: number;
  devilFlags?: string[];
}

export interface BuyerTelegramGateResult {
  allowed: boolean;
  reason:
    | "BUYER_READY"
    | "SELLER_ROLE_BLOCKED"
    | "CANDIDATE_NOT_READY"
    | "QUALITY_BELOW_GATE"
    | "DEVIL_CHECK_BLOCKED";
}

function clampScore(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function scoreToStars(value: number | null): 1 | 2 | 3 | 4 | 5 {
  const score = clampScore(value);
  if (score >= 80) return 5;
  if (score >= 65) return 4;
  if (score >= 45) return 3;
  if (score >= 25) return 2;
  return 1;
}

/**
 * Business-facing adapter only. It deliberately converts research ambiguity,
 * unavailable evidence and devil-check failures into a simple WAIT state.
 * It does not mutate verdicts, candidates or execution state.
 */
export function buildBusinessHorizonView(input: BusinessHorizonInput): BusinessHorizonView {
  const buyerStars = scoreToStars(input.buyerScore);
  const sellerStars = scoreToStars(input.sellerScore);
  const devilFlags = input.devilFlags ?? [];

  if (!input.evidenceReady || devilFlags.length > 0) {
    return {
      horizon: input.horizon,
      action: "WAIT",
      buyerStars,
      sellerStars,
      headline: "No clear edge — wait",
      reasons: input.reasons ?? [],
      devilCheck: devilFlags.length > 0 ? "CAUTION" : "PASS",
    };
  }

  const buyerScore = clampScore(input.buyerScore);
  const sellerScore = clampScore(input.sellerScore);
  const separation = Math.abs(buyerScore - sellerScore);

  // Require both strength and separation so small score differences do not become fake conviction.
  if (Math.max(buyerScore, sellerScore) < 65 || separation < 15) {
    return {
      horizon: input.horizon,
      action: "WAIT",
      buyerStars,
      sellerStars,
      headline: "No clear edge — wait",
      reasons: input.reasons ?? [],
      devilCheck: "PASS",
    };
  }

  const action: BusinessAction = buyerScore > sellerScore ? "BUYER_EDGE" : "SELLER_EDGE";
  return {
    horizon: input.horizon,
    action,
    buyerStars,
    sellerStars,
    headline: action === "BUYER_EDGE" ? "Buyer edge" : "Seller edge",
    reasons: input.reasons ?? [],
    devilCheck: "PASS",
  };
}

/**
 * Telegram business rule: only explicit OPTION_BUYER candidates may pass.
 * CE/PE and directional BUY/SELL labels are intentionally ignored here.
 */
export function evaluateBuyerTelegramEligibility(input: BuyerTelegramGateInput): BuyerTelegramGateResult {
  if (input.role !== "OPTION_BUYER") {
    return { allowed: false, reason: "SELLER_ROLE_BLOCKED" };
  }
  if (input.candidateStatus !== "READY") {
    return { allowed: false, reason: "CANDIDATE_NOT_READY" };
  }
  if ((input.devilFlags ?? []).length > 0) {
    return { allowed: false, reason: "DEVIL_CHECK_BLOCKED" };
  }
  if (!Number.isFinite(input.qualityStars) || input.qualityStars < 4) {
    return { allowed: false, reason: "QUALITY_BELOW_GATE" };
  }
  return { allowed: true, reason: "BUYER_READY" };
}
