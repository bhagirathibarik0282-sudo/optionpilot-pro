import { buildPsychologyRealEvidenceLedger, type PsychologyRealEvidenceLedgerResult } from "./psychology-real-evidence-ledger.ts";
import { restorePsychologyRealEvidence, type StoredPsychologyRealEvidence } from "./psychology-real-evidence-store.ts";
import type { PsychologyReplayValidationInput } from "./psychology-shadow-replay-adapter.ts";

export type PsychologyRealEvidenceRunnerStatus =
  | "NO_EVIDENCE"
  | "EVIDENCE_PRESENT_PROVENANCE_BLOCKED";

export interface PsychologyRealEvidenceRunnerResult {
  version: "PSYCHOLOGY_REAL_EVIDENCE_RUNNER_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  restoredRecords: number;
  status: PsychologyRealEvidenceRunnerStatus;
  ledger: PsychologyRealEvidenceLedgerResult;
  regimeTagProvenanceVerified: false;
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
    validation: { ...row.validation, regimes: [...row.validation.regimes] },
  };
}

/**
 * Research-only restore-and-ledger runner.
 *
 * Important safety boundary: the current stored schema preserves caller-supplied
 * validation regime tags but does not yet carry deterministic provenance proving
 * how each regime tag was derived. The runner therefore refuses to treat apparent
 * regime coverage as promotion-grade evidence. Counts remain diagnostic only until
 * a deterministic regime-evidence provenance contract is added.
 */
export function buildPsychologyRealEvidenceRunnerResult(
  rows: readonly StoredPsychologyRealEvidence[],
): PsychologyRealEvidenceRunnerResult {
  const inputs = rows.map(toValidationInput);
  const ledger = buildPsychologyRealEvidenceLedger(inputs);
  const blockers: string[] = [];

  if (rows.length === 0) blockers.push("NO_STORED_REAL_EVIDENCE");
  blockers.push("REGIME_TAG_PROVENANCE_NOT_VERIFIED");
  if (ledger.missingRegimes.length > 0) blockers.push(`MISSING_REGIMES:${ledger.missingRegimes.join(",")}`);
  if (ledger.nullMetrics.length > 0) blockers.push(`NULL_METRICS:${ledger.nullMetrics.join(",")}`);
  blockers.push("ACCEPTANCE_THRESHOLDS_NOT_CALIBRATED_OR_FROZEN");

  return {
    version: "PSYCHOLOGY_REAL_EVIDENCE_RUNNER_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    restoredRecords: rows.length,
    status: rows.length === 0 ? "NO_EVIDENCE" : "EVIDENCE_PRESENT_PROVENANCE_BLOCKED",
    ledger,
    regimeTagProvenanceVerified: false,
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
