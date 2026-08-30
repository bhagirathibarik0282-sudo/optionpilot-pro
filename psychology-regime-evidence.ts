import { REQUIRED_SHADOW_REGIMES, type ShadowValidationRegime } from "./psychology-shadow-validation.ts";

export type ShadowValidationRegimeEvidenceSource = "DETERMINISTIC_UPSTREAM";

export interface ShadowValidationRegimeEvidence {
  regime: ShadowValidationRegime;
  source: ShadowValidationRegimeEvidenceSource;
  observedAt: string;
  ruleVersion: string;
}

export interface ShadowValidationRegimeEvidenceResult {
  valid: boolean;
  regimes: ShadowValidationRegime[];
  blockers: string[];
}

function validIso(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

/** Promotion-grade regime coverage may use only closed deterministic upstream evidence. */
export function validateShadowValidationRegimeEvidence(
  evidence: readonly ShadowValidationRegimeEvidence[] | null | undefined,
  decisionAt: string,
  diagnosticRegimes?: readonly ShadowValidationRegime[],
): ShadowValidationRegimeEvidenceResult {
  const blockers: string[] = [];
  const regimes: ShadowValidationRegime[] = [];

  if (!Array.isArray(evidence) || evidence.length === 0) {
    return { valid: false, regimes, blockers: ["REGIME_EVIDENCE_MISSING"] };
  }
  if (!validIso(decisionAt)) blockers.push("REGIME_EVIDENCE_DECISION_AT_INVALID");

  const seen = new Set<ShadowValidationRegime>();
  for (const item of evidence) {
    if (!item || typeof item !== "object") {
      blockers.push("REGIME_EVIDENCE_INVALID_ITEM");
      continue;
    }
    if (!REQUIRED_SHADOW_REGIMES.includes(item.regime)) {
      blockers.push(`REGIME_EVIDENCE_UNSUPPORTED_REGIME:${String(item.regime)}`);
      continue;
    }
    if (diagnosticRegimes && !diagnosticRegimes.includes(item.regime)) blockers.push(`REGIME_EVIDENCE_LABEL_MISMATCH:${item.regime}`);
    if (item.source !== "DETERMINISTIC_UPSTREAM") blockers.push(`REGIME_EVIDENCE_UNSUPPORTED_SOURCE:${String(item.source)}`);
    if (typeof item.ruleVersion !== "string" || !item.ruleVersion.trim()) blockers.push(`REGIME_EVIDENCE_RULE_VERSION_MISSING:${item.regime}`);
    if (typeof item.observedAt !== "string" || !validIso(item.observedAt)) {
      blockers.push(`REGIME_EVIDENCE_OBSERVED_AT_INVALID:${item.regime}`);
    } else if (validIso(decisionAt) && Date.parse(item.observedAt) > Date.parse(decisionAt)) {
      blockers.push(`REGIME_EVIDENCE_LOOKAHEAD:${item.regime}`);
    }
    if (seen.has(item.regime)) blockers.push(`REGIME_EVIDENCE_DUPLICATE:${item.regime}`);
    else {
      seen.add(item.regime);
      regimes.push(item.regime);
    }
  }

  return { valid: blockers.length === 0, regimes: blockers.length === 0 ? regimes : [], blockers };
}
