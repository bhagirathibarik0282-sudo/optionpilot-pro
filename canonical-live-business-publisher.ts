import { buildCanonicalBuyerCandidatePacketFromSelection } from "./canonical-buyer-candidate-packet.js";
import { consumeCanonicalBusinessPacket } from "./canonical-business-consumer.js";
import { canonicalBusinessRuntimeRegistry } from "./canonical-business-runtime-registry.js";
import type { BusinessHorizonInput } from "./business-buyer-seller-layer.js";
import type { ExecutionCandidateInput, ExecutionCandidateResult } from "./execution-candidate-selector.js";

export interface ExactLiveSelectorEvaluation {
  candidate: ExecutionCandidateInput;
  selector: ExecutionCandidateResult;
}

export interface VerifiedLiveBusinessInputs {
  provenance: "LIVE_BUSINESS_EVIDENCE_VERIFIED_V1";
  observedAtMs: number;
  telegramQualityStars: number;
  horizons: BusinessHorizonInput[];
  devilFlags?: string[];
}

export interface CanonicalLiveBusinessPublishResult {
  accepted: boolean;
  reason:
    | "CANONICAL_LIVE_BUSINESS_PUBLISHED"
    | "INVALID_BUSINESS_PROVENANCE"
    | "INVALID_BUSINESS_TIMESTAMP"
    | "INVALID_TELEGRAM_QUALITY"
    | "MISSING_REQUIRED_HORIZONS"
    | "CANONICAL_PACKET_BLOCKED"
    | "RUNTIME_REGISTRY_REJECTED";
  candidateKey: string | null;
  failClosed: true;
}

const REQUIRED_HORIZONS = new Set(["INTRADAY", "MULTIDAY", "EXPIRY"]);

/**
 * Strict authority-preserving live publisher boundary.
 * It does not derive business scores and does not rerun the selector.
 * Caller must supply already-verified live business evidence.
 */
export function publishCanonicalLiveBusiness(
  evaluation: ExactLiveSelectorEvaluation,
  business: VerifiedLiveBusinessInputs,
): CanonicalLiveBusinessPublishResult {
  if (business?.provenance !== "LIVE_BUSINESS_EVIDENCE_VERIFIED_V1") {
    return { accepted: false, reason: "INVALID_BUSINESS_PROVENANCE", candidateKey: null, failClosed: true };
  }
  if (!Number.isFinite(business.observedAtMs) || business.observedAtMs <= 0) {
    return { accepted: false, reason: "INVALID_BUSINESS_TIMESTAMP", candidateKey: null, failClosed: true };
  }
  if (!Number.isFinite(business.telegramQualityStars) || business.telegramQualityStars < 1 || business.telegramQualityStars > 5) {
    return { accepted: false, reason: "INVALID_TELEGRAM_QUALITY", candidateKey: null, failClosed: true };
  }
  const horizons = new Set((business.horizons ?? []).map((h) => h.horizon));
  if ([...REQUIRED_HORIZONS].some((h) => !horizons.has(h as BusinessHorizonInput["horizon"]))) {
    return { accepted: false, reason: "MISSING_REQUIRED_HORIZONS", candidateKey: null, failClosed: true };
  }

  const canonical = buildCanonicalBuyerCandidatePacketFromSelection(evaluation.candidate, evaluation.selector);
  if (canonical.decision !== "READY" || !canonical.packet) {
    return { accepted: false, reason: "CANONICAL_PACKET_BLOCKED", candidateKey: null, failClosed: true };
  }

  const consumer = consumeCanonicalBusinessPacket({
    packet: canonical.packet,
    horizons: business.horizons,
    telegramQualityStars: business.telegramQualityStars,
    devilFlags: business.devilFlags,
  });
  const accepted = canonicalBusinessRuntimeRegistry.publish(canonical.packet.symbol, consumer, business.observedAtMs);
  if (!accepted) {
    return { accepted: false, reason: "RUNTIME_REGISTRY_REJECTED", candidateKey: canonical.packet.candidateKey, failClosed: true };
  }
  return { accepted: true, reason: "CANONICAL_LIVE_BUSINESS_PUBLISHED", candidateKey: canonical.packet.candidateKey, failClosed: true };
}
