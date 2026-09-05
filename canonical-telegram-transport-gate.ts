import type { CanonicalBusinessConsumerResult } from "./canonical-business-consumer.js";

export interface CanonicalTelegramTransportInput {
  consumer: CanonicalBusinessConsumerResult | null;
  meaningfulCandidateKey: string | null;
}

export interface CanonicalTelegramTransportGateResult {
  allowed: boolean;
  reason:
    | "CANONICAL_BUYER_TRANSPORT_READY"
    | "CANONICAL_CONSUMER_MISSING"
    | "BUYER_TELEGRAM_GATE_BLOCKED"
    | "CANONICAL_CANDIDATE_MISSING"
    | "MEANINGFUL_CANDIDATE_MISSING"
    | "CANDIDATE_IDENTITY_MISMATCH";
  candidateKey: string | null;
  failClosed: true;
}

/**
 * Final transport guard for an OptionPilot-owned candidate Telegram alert.
 * It never selects or ranks a candidate. It only proves that the candidate
 * observed by the meaningful-message layer is exactly the same candidate
 * already approved by the canonical business consumer.
 *
 * Generic/non-owned Telegram messages must be classified before calling this
 * guard. Candidate alerts fail closed when canonical identity cannot be proved.
 */
export function evaluateCanonicalTelegramTransport(
  input: CanonicalTelegramTransportInput,
): CanonicalTelegramTransportGateResult {
  const consumer = input.consumer;
  if (!consumer) {
    return { allowed: false, reason: "CANONICAL_CONSUMER_MISSING", candidateKey: null, failClosed: true };
  }

  if (!consumer.telegram.allowed) {
    return { allowed: false, reason: "BUYER_TELEGRAM_GATE_BLOCKED", candidateKey: consumer.candidateKey, failClosed: true };
  }

  if (!consumer.candidateKey || !consumer.buyerCandidate) {
    return { allowed: false, reason: "CANONICAL_CANDIDATE_MISSING", candidateKey: null, failClosed: true };
  }

  if (!input.meaningfulCandidateKey) {
    return { allowed: false, reason: "MEANINGFUL_CANDIDATE_MISSING", candidateKey: consumer.candidateKey, failClosed: true };
  }

  if (input.meaningfulCandidateKey !== consumer.candidateKey || input.meaningfulCandidateKey !== consumer.buyerCandidate.candidateKey) {
    return { allowed: false, reason: "CANDIDATE_IDENTITY_MISMATCH", candidateKey: consumer.candidateKey, failClosed: true };
  }

  return {
    allowed: true,
    reason: "CANONICAL_BUYER_TRANSPORT_READY",
    candidateKey: consumer.candidateKey,
    failClosed: true,
  };
}
