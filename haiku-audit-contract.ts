import type { CanonicalEvidenceEnvelope } from "./canonical-evidence-envelope.js";

export type HaikuAuditSeverity = "INFO" | "WARNING" | "BLOCKER";

export interface HaikuAuditFinding {
  code: string;
  severity: HaikuAuditSeverity;
  message: string;
  evidenceRefs: string[];
}

export interface HaikuAuditRequest {
  version: "HAIKU_AUDIT_REQUEST_V1";
  semantics: "EXPLANATION_AND_AUDIT_ONLY";
  envelope: CanonicalEvidenceEnvelope;
  instructions: string[];
  mayChangeVerdict: false;
  mayChangeExecution: false;
  mayChangeTelegramEligibility: false;
}

export interface HaikuAuditResult {
  version: "HAIKU_AUDIT_RESULT_V1";
  semantics: "EXPLANATION_AND_AUDIT_ONLY";
  summary: string;
  findings: HaikuAuditFinding[];
  contradictionDetected: boolean;
  missingEvidenceDetected: boolean;
  escalationSuggested: boolean;
  mayChangeVerdict: false;
  mayChangeExecution: false;
  mayChangeTelegramEligibility: false;
}

export function buildHaikuAuditRequest(envelope: CanonicalEvidenceEnvelope): HaikuAuditRequest {
  return {
    version: "HAIKU_AUDIT_REQUEST_V1",
    semantics: "EXPLANATION_AND_AUDIT_ONLY",
    envelope,
    instructions: [
      "Audit only the supplied evidence; do not invent market data.",
      "Identify contradictions, stale/missing evidence, and weak transition confirmation.",
      "Explain why the deterministic evidence is coherent or conflicted.",
      "Do not create, alter, upgrade, downgrade, or override any trading verdict.",
      "Do not alter Telegram eligibility or execution state.",
      "Suggest higher-model escalation only when evidence is materially contradictory or incomplete for explanation.",
    ],
    mayChangeVerdict: false,
    mayChangeExecution: false,
    mayChangeTelegramEligibility: false,
  };
}

export function validateHaikuAuditResult(result: HaikuAuditResult): string[] {
  const problems: string[] = [];
  if (result.mayChangeVerdict !== false) problems.push("HAIKU_VERDICT_AUTHORITY_FORBIDDEN");
  if (result.mayChangeExecution !== false) problems.push("HAIKU_EXECUTION_AUTHORITY_FORBIDDEN");
  if (result.mayChangeTelegramEligibility !== false) problems.push("HAIKU_TELEGRAM_AUTHORITY_FORBIDDEN");
  if (!Array.isArray(result.findings)) problems.push("HAIKU_FINDINGS_INVALID");
  return problems;
}
