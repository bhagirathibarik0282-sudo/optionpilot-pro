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
 * The meaningful live layer reads persisted option rows whose stable identity is
 * symbol|expiry|strike|side.  Keep that transport representation derived from
 * the canonical buyer candidate; never let Telegram reconstruct or select it.
 */
export function canonicalMeaningfulContractKey(
  consumer: CanonicalBusinessConsumerResult | null,
): string | null {
  const candidate = consumer?.buyerCandidate;
  if (!consumer?.candidateKey || !candidate) return null;
  if (consumer.candidateKey !== candidate.candidateKey) return null;
  if (!candidate.symbol || !candidate.expiryDate || !Number.isFinite(candidate.strike)) return null;
  if (candidate.optionSide !== "CE" && candidate.optionSide !== "PE") return null;
  return `${candidate.symbol}|${candidate.expiryDate}|${candidate.strike}|${candidate.optionSide}`;
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

  const meaningfulContractKey = canonicalMeaningfulContractKey(consumer);
  const exactCanonicalKey = input.meaningfulCandidateKey === consumer.candidateKey
    && input.meaningfulCandidateKey === consumer.buyerCandidate.candidateKey;
  const exactContractKey = meaningfulContractKey !== null
    && input.meaningfulCandidateKey === meaningfulContractKey;
  if (!exactCanonicalKey && !exactContractKey) {
    return { allowed: false, reason: "CANDIDATE_IDENTITY_MISMATCH", candidateKey: consumer.candidateKey, failClosed: true };
  }

  return {
    allowed: true,
    reason: "CANONICAL_BUYER_TRANSPORT_READY",
    candidateKey: consumer.candidateKey,
    failClosed: true,
  };
}
