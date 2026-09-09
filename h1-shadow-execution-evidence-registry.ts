import type { BrokerExecutionAuthorizationInput } from "./broker-execution-authorization.js";

export const H1_SHADOW_EXECUTION_EVIDENCE_REGISTRY_VERSION = "H1_SHADOW_EXECUTION_EVIDENCE_REGISTRY_V1" as const;

export type H1ShadowExecutionEvidence = Omit<BrokerExecutionAuthorizationInput, "mode">;

type EvidenceEntry = {
  candidateKey: string;
  evidence: H1ShadowExecutionEvidence;
  observedAtMs: number;
};

const evidenceEntries = new Map<string, EvidenceEntry>();

function validIso(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validCandidateKey(candidateKey: string): boolean {
  const parts = candidateKey.split("|");
  if (parts.length !== 4) return false;
  const [symbol, expiry, strikeText, side] = parts;
  const strike = Number(strikeText);
  return Boolean(symbol && /^\d{4}-\d{2}-\d{2}$/.test(expiry) && Number.isFinite(strike) && strike > 0 && (side === "CE" || side === "PE"));
}

function validEvidence(evidence: H1ShadowExecutionEvidence): boolean {
  return Boolean(
    evidence &&
    (evidence.orderBuildDecision === "BUILD" || evidence.orderBuildDecision === "BLOCK") &&
    (evidence.executionRiskDecision === "ALLOW" || evidence.executionRiskDecision === "BLOCK") &&
    (evidence.killSwitchDecision === "ALLOW" || evidence.killSwitchDecision === "BLOCK") &&
    (evidence.idempotencyDecision === "ALLOW" || evidence.idempotencyDecision === "BLOCK") &&
    typeof evidence.exactContractBound === "boolean" &&
    typeof evidence.evidencePersistenceConfirmed === "boolean" &&
    typeof evidence.brokerSessionReady === "boolean"
  );
}

export function publishH1ShadowExecutionEvidence(input: {
  candidateKey: string;
  observedAt: string;
  evidence: H1ShadowExecutionEvidence;
}): { accepted: boolean; reason: string } {
  const observedAtMs = validIso(input?.observedAt);
  if (!validCandidateKey(input?.candidateKey ?? "") || observedAtMs === null || !validEvidence(input?.evidence)) {
    return { accepted: false, reason: "INVALID_H1_SHADOW_EXECUTION_EVIDENCE" };
  }

  evidenceEntries.set(input.candidateKey, {
    candidateKey: input.candidateKey,
    observedAtMs,
    evidence: { ...input.evidence },
  });
  return { accepted: true, reason: "H1_SHADOW_EXECUTION_EVIDENCE_ACCEPTED" };
}

export function getH1ShadowExecutionEvidence(
  candidateKey: string | null,
  nowIso: string,
  maxAgeMs = 90_000,
): H1ShadowExecutionEvidence | null {
  if (!candidateKey) return null;
  const nowMs = validIso(nowIso);
  if (nowMs === null) return null;
  const entry = evidenceEntries.get(candidateKey);
  if (!entry) return null;
  const ageMs = nowMs - entry.observedAtMs;
  if (ageMs < 0 || ageMs > maxAgeMs) {
    evidenceEntries.delete(candidateKey);
    return null;
  }
  return { ...entry.evidence };
}

export function clearH1ShadowExecutionEvidenceRegistry(): void {
  evidenceEntries.clear();
}
