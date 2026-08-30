import { buildPsychologyRealEvidenceRunnerResult } from "./psychology-real-evidence-runner.ts";
import { isStoredPsychologyRealEvidence, type StoredPsychologyRealEvidence } from "./psychology-real-evidence-store.ts";
import { REQUIRED_SHADOW_REGIMES, SHADOW_VALIDATION_METRICS, type ShadowValidationMetricKey, type ShadowValidationRegime } from "./psychology-shadow-validation.ts";

export type PsychologyEvidenceReadinessStatus =
  | "NO_EVIDENCE"
  | "INVALID_EVIDENCE_PRESENT"
  | "REGIME_COVERAGE_INCOMPLETE"
  | "METRIC_DENOMINATORS_INCOMPLETE"
  | "STRUCTURALLY_READY_FOR_THRESHOLD_RESEARCH";

export interface PsychologyEvidenceReadinessResult {
  version: "PSYCHOLOGY_EVIDENCE_READINESS_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: PsychologyEvidenceReadinessStatus;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  completedTrades: number;
  regimeTradeCounts: Record<ShadowValidationRegime, number>;
  missingRegimes: ShadowValidationRegime[];
  metricDenominators: Record<ShadowValidationMetricKey, number>;
  zeroDenominatorMetrics: ShadowValidationMetricKey[];
  allRegimesObserved: boolean;
  allMetricDenominatorsObserved: boolean;
  provenanceVerified: boolean;
  structuralReadinessOnly: true;
  statisticalSufficiencyEstablished: false;
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function emptyDenominators(): Record<ShadowValidationMetricKey, number> {
  return Object.fromEntries(
    (Object.keys(SHADOW_VALIDATION_METRICS) as ShadowValidationMetricKey[]).map((key) => [key, 0]),
  ) as Record<ShadowValidationMetricKey, number>;
}

/**
 * Reports only structural evidence readiness. A positive result means every mandatory regime has
 * at least one provenance-backed observation and every frozen metric has a non-zero denominator.
 * It does NOT claim sample-size adequacy, statistical power, threshold validity, or promotion safety.
 */
export function buildPsychologyEvidenceReadiness(
  rows: readonly StoredPsychologyRealEvidence[],
): PsychologyEvidenceReadinessResult {
  const validRows = rows.filter(isStoredPsychologyRealEvidence);
  const invalidRecords = rows.length - validRows.length;
  const runner = buildPsychologyRealEvidenceRunnerResult(validRows);
  const denominators = emptyDenominators();

  for (const row of validRows) {
    const v = row.validation;
    if (v.completedTrade) {
      denominators.STATE_FLIPS_PER_TRADE += 1;
      denominators.AVERAGE_UPDATES_PER_TRADE += 1;
      denominators.WRONG_SIDE_FLIP_RATE += 1;
    }
    denominators.FALSE_CHASE_WARNING_RATE += v.chaseWarnings;
    denominators.MISSED_LATE_EXIT_WARNING_RATE += v.lateExitEvents;
    denominators.MISSED_THESIS_FAILURE_RATE += v.thesisFailures;
    denominators.DUPLICATE_MESSAGE_RATE += v.eligibleMessages;
    denominators.ENTRY_AFTER_EXTENSION_RATE += v.entries;
    denominators.STOP_RESPECT_VIOLATION_RATE += v.stoppedTrades;
    denominators.PROFIT_PROTECTION_USEFULNESS_RATE += v.profitProtectionOpportunities;
  }

  const zeroDenominatorMetrics = (Object.keys(denominators) as ShadowValidationMetricKey[])
    .filter((key) => denominators[key] === 0);
  const allRegimesObserved = REQUIRED_SHADOW_REGIMES.every((regime) => runner.ledger.regimeTradeCounts[regime] > 0);
  const allMetricDenominatorsObserved = zeroDenominatorMetrics.length === 0;
  const provenanceVerified = runner.regimeTagProvenanceVerified;
  const blockers: string[] = [];

  if (rows.length === 0) blockers.push("NO_REAL_EVIDENCE_RECORDS");
  if (invalidRecords > 0) blockers.push(`INVALID_EVIDENCE_RECORDS:${invalidRecords}`);
  if (!provenanceVerified && validRows.length > 0) blockers.push("REGIME_PROVENANCE_NOT_VERIFIED");
  if (!allRegimesObserved) blockers.push(`MISSING_REGIMES:${runner.ledger.missingRegimes.join(",")}`);
  if (!allMetricDenominatorsObserved) blockers.push(`ZERO_METRIC_DENOMINATORS:${zeroDenominatorMetrics.join(",")}`);
  blockers.push("STATISTICAL_SUFFICIENCY_NOT_ESTABLISHED");
  blockers.push("ACCEPTANCE_THRESHOLDS_NOT_CALIBRATED_OR_FROZEN");

  let status: PsychologyEvidenceReadinessStatus;
  if (rows.length === 0) status = "NO_EVIDENCE";
  else if (invalidRecords > 0 || !provenanceVerified) status = "INVALID_EVIDENCE_PRESENT";
  else if (!allRegimesObserved) status = "REGIME_COVERAGE_INCOMPLETE";
  else if (!allMetricDenominatorsObserved) status = "METRIC_DENOMINATORS_INCOMPLETE";
  else status = "STRUCTURALLY_READY_FOR_THRESHOLD_RESEARCH";

  return {
    version: "PSYCHOLOGY_EVIDENCE_READINESS_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status,
    totalRecords: rows.length,
    validRecords: validRows.length,
    invalidRecords,
    completedTrades: validRows.filter((row) => row.validation.completedTrade).length,
    regimeTradeCounts: { ...runner.ledger.regimeTradeCounts },
    missingRegimes: [...runner.ledger.missingRegimes],
    metricDenominators: denominators,
    zeroDenominatorMetrics,
    allRegimesObserved,
    allMetricDenominatorsObserved,
    provenanceVerified,
    structuralReadinessOnly: true,
    statisticalSufficiencyEstablished: false,
    acceptanceThresholdsFrozen: false,
    promotionEligible: false,
    blockers,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
