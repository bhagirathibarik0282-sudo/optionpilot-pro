// Research-only message eligibility engine.
// Deterministic engines decide truth/state; this engine decides only whether a message is eligible to be spoken.

export type MessageTriggerLifecycle =
  | "WATCH"
  | "ENTRY_READY"
  | "ACTIVE"
  | "HOLD"
  | "PROTECT"
  | "PARTIAL_BOOK"
  | "TRAIL"
  | "EXIT"
  | "DATA_UNAVAILABLE";

export interface MessageTriggerInput {
  dataFresh: boolean;
  lifecycle: MessageTriggerLifecycle;
  candidateKey: string;
  candidateSelectionChanged: boolean;
  lifecycleChanged: boolean;
  premiumBehaviourChanged: boolean;
  buyerSellerStateChanged: boolean;
  behaviourRiskChanged: boolean;
  materialEvidenceChange: boolean;
  consecutiveConfirmations: number;
  requiredConfirmations: number;
  cooldownSatisfied: boolean;
  currentFingerprint: string;
  lastSpokenFingerprint: string | null;
}

export interface MessageTriggerResult {
  version: "MESSAGE_TRIGGER_ENGINE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  shouldSpeak: boolean;
  urgent: boolean;
  reason: string;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  haikuMayOverride: false;
}

function out(shouldSpeak: boolean, urgent: boolean, reason: string): MessageTriggerResult {
  return {
    version: "MESSAGE_TRIGGER_ENGINE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    shouldSpeak,
    urgent,
    reason,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    haikuMayOverride: false,
  };
}

/**
 * No timing or confirmation threshold is invented here.
 * requiredConfirmations and cooldownSatisfied must come from an upstream frozen policy.
 * EXIT and DATA_UNAVAILABLE are urgent, but exact duplicate fingerprints remain suppressed.
 * The fingerprint must be scoped to the stable exact candidate key to prevent cross-candidate collisions.
 */
export function evaluateMessageTrigger(input: MessageTriggerInput): MessageTriggerResult {
  const candidateKey = input.candidateKey.trim();
  if (!candidateKey) return out(false, false, "MISSING_CANDIDATE_KEY");

  const fingerprint = input.currentFingerprint.trim();
  if (!fingerprint) return out(false, false, "MISSING_MESSAGE_FINGERPRINT");
  if (!fingerprint.startsWith(`${candidateKey}:`)) {
    return out(false, false, "FINGERPRINT_CANDIDATE_SCOPE_MISMATCH");
  }

  if (input.lastSpokenFingerprint === fingerprint) {
    return out(false, false, "EXACT_DUPLICATE_SUPPRESSED");
  }

  const dataUnavailable = !input.dataFresh || input.lifecycle === "DATA_UNAVAILABLE";
  if (dataUnavailable) return out(true, true, "DATA_UNAVAILABLE_MESSAGE_ELIGIBLE");

  if (input.lifecycle === "EXIT") return out(true, true, "TERMINAL_EXIT_MESSAGE_ELIGIBLE");

  if (!Number.isInteger(input.requiredConfirmations) || input.requiredConfirmations < 1) {
    return out(false, false, "INVALID_REQUIRED_CONFIRMATIONS_POLICY");
  }
  if (!Number.isInteger(input.consecutiveConfirmations) || input.consecutiveConfirmations < 0) {
    return out(false, false, "INVALID_CONFIRMATION_COUNT");
  }

  const meaningful =
    input.candidateSelectionChanged ||
    input.lifecycleChanged ||
    input.premiumBehaviourChanged ||
    input.buyerSellerStateChanged ||
    input.behaviourRiskChanged ||
    input.materialEvidenceChange;

  if (!meaningful) return out(false, false, "NO_MEANINGFUL_CHANGE");

  if (input.consecutiveConfirmations < input.requiredConfirmations) {
    return out(false, false, "HYSTERESIS_CONFIRMATION_NOT_MET");
  }

  if (!input.cooldownSatisfied) {
    return out(false, false, "COOLDOWN_NOT_SATISFIED");
  }

  return out(true, false, "MEANINGFUL_CONFIRMED_CHANGE_ELIGIBLE");
}
