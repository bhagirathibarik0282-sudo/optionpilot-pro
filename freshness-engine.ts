import type { EvidenceUsability, FreshnessState, SourceTruthReasonCode } from "./source-truth-types.js";

export interface FreshnessPolicy {
  freshMaxMs: number;
  agingMaxMs: number;
  futureToleranceMs?: number;
}

export interface FreshnessResult {
  state: FreshnessState;
  dataAgeMs: number | null;
  usability: EvidenceUsability;
  reasons: SourceTruthReasonCode[];
}

export function classifyFreshness(sourceTimestamp: string | null | undefined, receivedAt: string, policy: FreshnessPolicy): FreshnessResult {
  if (!sourceTimestamp) return { state: "UNKNOWN", dataAgeMs: null, usability: "BLOCKED", reasons: ["SOURCE_TS_MISSING"] };
  const sourceMs = new Date(sourceTimestamp).getTime();
  const receivedMs = new Date(receivedAt).getTime();
  if (!Number.isFinite(sourceMs) || !Number.isFinite(receivedMs)) {
    return { state: "UNKNOWN", dataAgeMs: null, usability: "BLOCKED", reasons: ["SOURCE_TS_INVALID"] };
  }
  const age = receivedMs - sourceMs;
  const futureTol = policy.futureToleranceMs ?? 2000;
  if (age < -futureTol) return { state: "UNKNOWN", dataAgeMs: age, usability: "BLOCKED", reasons: ["SOURCE_TS_FUTURE"] };
  const normalizedAge = Math.max(0, age);
  if (normalizedAge <= policy.freshMaxMs) return { state: "FRESH", dataAgeMs: normalizedAge, usability: "USABLE", reasons: [] };
  if (normalizedAge <= policy.agingMaxMs) return { state: "AGING", dataAgeMs: normalizedAge, usability: "CONTEXT_ONLY", reasons: ["QUOTE_AGING"] };
  return { state: "STALE", dataAgeMs: normalizedAge, usability: "BLOCKED", reasons: ["QUOTE_STALE"] };
}

export function pairUsability(left: FreshnessResult, right: FreshnessResult): EvidenceUsability {
  if (left.usability === "BLOCKED" || right.usability === "BLOCKED") return "BLOCKED";
  if (left.usability === "CONTEXT_ONLY" || right.usability === "CONTEXT_ONLY") return "CONTEXT_ONLY";
  return "USABLE";
}
