import { buildPsychologyRealEvidenceLedger, type PsychologyRealEvidenceLedgerResult } from "./psychology-real-evidence-ledger.ts";
import { restorePsychologyRealEvidence, type StoredPsychologyRealEvidence } from "./psychology-real-evidence-store.ts";
import type { PsychologyReplayValidationInput } from "./psychology-shadow-replay-adapter.ts";

export type PsychologyRealEvidenceRunnerStatus =
  | "NO_EVIDENCE"
  | "EVIDENCE_PRESENT_PROVENANCE_BLOCKED"
  | "COVERAGE_INCOMPLETE"
  | "METRICS_INCOMPLETE"
  | "READY_FOR_THRESHOLD_RESEARCH";

export interface PsychologyRealEvidenceRunnerResult {
  version: "PSYCHOLOGY_REAL_EVIDENCE_RUNNER_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  restoredRecords: number;
  status: PsychologyRealEvidenceRunnerStatus;
  ledger: PsychologyRealEvidenceLedgerResult;
  regimeTagProvenanceVerified: boolean;
  blockers: string[];
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function toValidationInput(row: StoredPsychologyRealEvidence): PsychologyReplayValidationInput {
  return {
    source: row.source,
    replay: { ...row.replay },
    validation: {
      ...row.validation,
      regimes: [...row.validation.regimes],
      ...(row.validation.regimeEvidence ? { regimeEvidence: row.validation.regimeEvidence.map((item) => ({ ...item })) } : {}),
    },
  };
}

/** Research-only restore-and-ledger runner with deterministic regime provenance enforcement. */
export function buildPsychologyRealEvidenceRunnerResult(
  rows: readonly StoredPsychologyRealEvidence[],
): PsychologyRealEvidenceRunnerResult {
  const inputs = rows.map(toValidationInput);
  const ledger = buildPsychologyRealEvidenceLedger(inputs);
  const blockers: string[] = [];
  const regimeTagProvenanceVerified = rows.length > 0 && ledger.provenRegimeInputs === ledger.acceptedInputs && ledger.regimeProvenanceRejectedInputs === 0;

  if (rows.length === 0) blockers.push("NO_STORED_REAL_EVIDENCE");
  if (!regimeTagProvenanceVerified && rows.length > 0) blockers.push("REGIME_TAG_PROVENANCE_NOT_VERIFIED");
  if (ledger.missingRegimes.length > 0) blockers.push(`MISSING_REGIMES:${ledger.missingRegimes.join(",")}`);
  if (ledger.nullMetrics.length > 0) blockers.push(`NULL_METRICS:${ledger.nullMetrics.join(",")}`);
  blockers.push("ACCEPTANCE_THRESHOLDS_NOT_CALIBRATED_OR_FROZEN");

  let status: PsychologyRealEvidenceRunnerStatus;
  if (rows.length === 0) status = "NO_EVIDENCE";
  else if (!regimeTagProvenanceVerified) status = "EVIDENCE_PRESENT_PROVENANCE_BLOCKED";
  else if (ledger.missingRegimes.length > 0) status = "COVERAGE_INCOMPLETE";
  else if (ledger.nullMetrics.length > 0) status = "METRICS_INCOMPLETE";
  else status = "READY_FOR_THRESHOLD_RESEARCH";

  return {
    version: "PSYCHOLOGY_REAL_EVIDENCE_RUNNER_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    restoredRecords: rows.length,
    status,
    ledger,
    regimeTagProvenanceVerified,
    blockers,
    acceptanceThresholdsFrozen: false,
    promotionEligible: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}

export async function runPsychologyRealEvidenceLedgerFromStore(): Promise<PsychologyRealEvidenceRunnerResult> {
  const rows = await restorePsychologyRealEvidence();
  return buildPsychologyRealEvidenceRunnerResult(rows);
}
