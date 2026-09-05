import type { CanonicalBuyerCandidatePacket } from "./canonical-buyer-candidate-packet.js";
import {
  buildBusinessHorizonView,
  evaluateBuyerTelegramEligibility,
  type BusinessHorizonInput,
  type BusinessHorizonView,
  type BuyerTelegramGateResult,
} from "./business-buyer-seller-layer.js";

export interface CanonicalBusinessConsumerInput {
  packet: CanonicalBuyerCandidatePacket | null;
  horizons: BusinessHorizonInput[];
  telegramQualityStars: number;
  devilFlags?: string[];
}

export interface CanonicalBuyerDashboardCandidate {
  candidateKey: string;
  role: "OPTION_BUYER";
  symbol: CanonicalBuyerCandidatePacket["symbol"];
  optionSide: CanonicalBuyerCandidatePacket["optionSide"];
  strike: number;
  expiryDate: string;
  dte: number;
  moneyness: CanonicalBuyerCandidatePacket["moneyness"];
  premiumLtp: number;
  dteBucket: CanonicalBuyerCandidatePacket["dteBucket"];
  sourceAuthority: "EXECUTION_CANDIDATE_SELECTOR_V2";
}

export interface CanonicalBusinessConsumerResult {
  version: "CANONICAL_BUSINESS_CONSUMER_V1";
  buyerCandidate: CanonicalBuyerDashboardCandidate | null;
  horizons: BusinessHorizonView[];
  telegram: BuyerTelegramGateResult;
  candidateKey: string | null;
  sameCanonicalCandidateForDashboardAndTelegram: true;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

/**
 * Read-only consumer projection over the canonical buyer packet.
 *
 * Deep Research invariants:
 * - Never selects, re-ranks, or changes a candidate.
 * - Dashboard and Telegram eligibility reference the same canonical candidateKey.
 * - CE/PE remains option side only; business role comes from the packet.
 * - Missing packet fails closed for Telegram and shows no buyer candidate.
 * - Horizon views are presentation projections over already-computed deterministic scores.
 */
export function consumeCanonicalBusinessPacket(
  input: CanonicalBusinessConsumerInput,
): CanonicalBusinessConsumerResult {
  const horizons = input.horizons.map(buildBusinessHorizonView);
  const candidateKey = input.packet?.candidateKey ?? null;

  const buyerCandidate: CanonicalBuyerDashboardCandidate | null = input.packet
    ? {
        candidateKey: input.packet.candidateKey,
        role: input.packet.role,
        symbol: input.packet.symbol,
        optionSide: input.packet.optionSide,
        strike: input.packet.strike,
        expiryDate: input.packet.expiryDate,
        dte: input.packet.dte,
        moneyness: input.packet.moneyness,
        premiumLtp: input.packet.premiumLtp,
        dteBucket: input.packet.dteBucket,
        sourceAuthority: input.packet.sourceAuthority,
      }
    : null;

  const telegram = input.packet
    ? evaluateBuyerTelegramEligibility({
        role: input.packet.role,
        candidateStatus: input.packet.status,
        qualityStars: input.telegramQualityStars,
        devilFlags: input.devilFlags,
      })
    : { allowed: false, reason: "CANDIDATE_NOT_READY" as const };

  return {
    version: "CANONICAL_BUSINESS_CONSUMER_V1",
    buyerCandidate,
    horizons,
    telegram,
    candidateKey,
    sameCanonicalCandidateForDashboardAndTelegram: true,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
