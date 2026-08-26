import type { IdentityAudit } from "./instrument-truth.js";
import type { FreshnessResult } from "./freshness-engine.js";
import type { EvidenceUsability, QualityState, SourceTruthReasonCode } from "./source-truth-types.js";

export interface EvidenceGateResult {
  usability: EvidenceUsability;
  qualityState: QualityState;
  reasonCodes: SourceTruthReasonCode[];
}

export function gateEvidence(identity: IdentityAudit, freshness: FreshnessResult, additionalReasons: SourceTruthReasonCode[] = []): EvidenceGateResult {
  const reasons = [...new Set([...identity.reasons, ...freshness.reasons, ...additionalReasons])];
  if (!identity.usable || freshness.usability === "BLOCKED") {
    return { usability: "BLOCKED", qualityState: identity.state === "MISMATCH" ? "INVALID" : "UNKNOWN", reasonCodes: reasons };
  }
  if (freshness.usability === "CONTEXT_ONLY" || additionalReasons.length) {
    return { usability: "CONTEXT_ONLY", qualityState: "PARTIAL", reasonCodes: reasons };
  }
  return { usability: "USABLE", qualityState: "VALID", reasonCodes: reasons };
}
