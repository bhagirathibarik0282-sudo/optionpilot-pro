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
  | "EXIT";

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
  /** Optional narrative-only signals; existing callers remain backward compatible. */
  footprintLeadershipChanged?: boolean;
  structuralBoundaryChanged?: boolean;
  oppositePremiumStateChanged?: boolean;
  crossDteCoherenceChanged?: boolean;
  breadthStateChanged?: boolean;
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
  /** True when the message passes all non-duplicate eligibility gates. */
  eligibleBeforeDuplicateSuppression: boolean;
  /** True only when a message that was otherwise eligible was suppressed as an exact duplicate. */
  duplicateSuppressed: boolean;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  haikuMayOverride: false;
}

export interface TelegramTriggerDiagnostic {
  reason: string;
  shouldSpeak: boolean;
  observedAt: string;
}

const lastTriggerDiagnosticBySymbol = new Map<string, TelegramTriggerDiagnostic>();
let activeDiagnosticCandidateKey = "";

function candidateSymbol(candidateKey: string): string | null {
  const symbol = candidateKey.split("|")[0]?.trim().toUpperCase() ?? "";
  return symbol === "NIFTY" || symbol === "BANKNIFTY" || symbol === "SENSEX" ? symbol : null;
}

export function getLastTelegramTriggerDiagnostic(symbol: string): TelegramTriggerDiagnostic | null {
  const value = lastTriggerDiagnosticBySymbol.get(symbol.trim().toUpperCase());
  return value ? { ...value } : null;
}

function out(
  shouldSpeak: boolean,
  urgent: boolean,
  reason: string,
  eligibleBeforeDuplicateSuppression = false,
  duplicateSuppressed = false,
): MessageTriggerResult {
  console.log(`[Telegram Trigger] ${shouldSpeak ? "ELIGIBLE" : "SUPPRESSED"} reason=${reason}`);
  const symbol = candidateSymbol(activeDiagnosticCandidateKey);
  if (symbol) {
    lastTriggerDiagnosticBySymbol.set(symbol, {
      reason,
      shouldSpeak,
      observedAt: new Date().toISOString(),
    });
  }
  return {
    version: "MESSAGE_TRIGGER_ENGINE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    shouldSpeak,
    urgent,
    reason,
    eligibleBeforeDuplicateSuppression,
    duplicateSuppressed,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    haikuMayOverride: false,
  };
}

function meaningfulChange(input: MessageTriggerInput): boolean {
  return (
    input.candidateSelectionChanged ||
    input.lifecycleChanged ||
    input.premiumBehaviourChanged ||
    input.buyerSellerStateChanged ||
    input.behaviourRiskChanged ||
    input.materialEvidenceChange ||
    input.footprintLeadershipChanged === true ||
    input.structuralBoundaryChanged === true ||
    input.oppositePremiumStateChanged === true ||
    input.crossDteCoherenceChanged === true ||
    input.breadthStateChanged === true
  );
}

/**
 * No timing or confirmation threshold is invented here.
 * requiredConfirmations and cooldownSatisfied must come from an upstream frozen policy.
 * EXIT and data-unavailable overlay are urgent, but exact duplicate fingerprints remain suppressed.
 * The fingerprint must be scoped to the stable exact candidate key to prevent cross-candidate collisions.
 * Instrumentation explicitly exposes eligibility-before-duplicate-suppression so validation metrics do not
 * have to reverse-engineer trigger behavior downstream.
 */
export function evaluateMessageTrigger(input: MessageTriggerInput): MessageTriggerResult {
  const candidateKey = input.candidateKey.trim();
  activeDiagnosticCandidateKey = candidateKey;
  if (!candidateKey) return out(false, false, "MISSING_CANDIDATE_KEY");

  const fingerprint = input.currentFingerprint.trim();
  if (!fingerprint) return out(false, false, "MISSING_MESSAGE_FINGERPRINT");
  if (!fingerprint.startsWith(`${candidateKey}:`)) {
    return out(false, false, "FINGERPRINT_CANDIDATE_SCOPE_MISMATCH");
  }

  let eligible = false;
  let urgent = false;
  let nonDuplicateReason = "NO_MEANINGFUL_CHANGE";

  if (!input.dataFresh) {
    eligible = true;
    urgent = true;
    nonDuplicateReason = "DATA_UNAVAILABLE_MESSAGE_ELIGIBLE";
  } else if (input.lifecycle === "EXIT") {
    eligible = true;
    urgent = true;
    nonDuplicateReason = "TERMINAL_EXIT_MESSAGE_ELIGIBLE";
  } else {
    if (!Number.isInteger(input.requiredConfirmations) || input.requiredConfirmations < 1) {
      return out(false, false, "INVALID_REQUIRED_CONFIRMATIONS_POLICY");
    }
    if (!Number.isInteger(input.consecutiveConfirmations) || input.consecutiveConfirmations < 0) {
      return out(false, false, "INVALID_CONFIRMATION_COUNT");
    }

    if (!meaningfulChange(input)) return out(false, false, "NO_MEANINGFUL_CHANGE");

    if (input.consecutiveConfirmations < input.requiredConfirmations) {
      return out(false, false, "HYSTERESIS_CONFIRMATION_NOT_MET");
    }

    if (!input.cooldownSatisfied) {
      return out(false, false, "COOLDOWN_NOT_SATISFIED");
    }

    eligible = true;
    nonDuplicateReason = "MEANINGFUL_CONFIRMED_CHANGE_ELIGIBLE";
  }

  if (eligible && input.lastSpokenFingerprint === fingerprint) {
    return out(false, false, "EXACT_DUPLICATE_SUPPRESSED", true, true);
  }

  return out(eligible, urgent, nonDuplicateReason, eligible, false);
}
