export interface H1PostImportCounters {
  requestedTradingDays: number;
  importedTradingDays: number;
  symbolsExpected: number;
  symbolsObserved: number;
  duplicateLogicalKeys: number;
  cePeMismatchBuckets: number;
  expiryDateShiftRows: number;
  outsideSessionRows: number;
  futureLeakRows: number;
  runningBlockRows: number;
  researchEligiblePartialRows: number;
  researchEligibleStaleRows: number;
  researchEligibleInvalidRows: number;
  traceabilityFailures: number;
  verifiedOutcomeCount: number;
  calibrationEligibleOutcomeCount: number;
  incompleteOutcomeCount: number;
  regimeMatchedAnalogCount: number;
  alignedSevenIndexDays: number;
  requiredAlignedSevenIndexDays: number;
}

export interface H1PostImportIntegrityResult {
  integrityStatus: "PASS" | "FAIL";
  calibrationReadiness: "NOT_READY" | "STRUCTURE_READY";
  hardBlockers: string[];
  warnings: string[];
  summary: string;
  ruleVersion: "H1_POST_IMPORT_INTEGRITY_V1";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

export function evaluatePostImportIntegrity(c: H1PostImportCounters): H1PostImportIntegrityResult {
  const hardBlockers: string[] = [];
  const warnings: string[] = [];

  if (c.requestedTradingDays !== c.importedTradingDays) hardBlockers.push("TRADING_DAY_COUNT_MISMATCH");
  if (c.symbolsExpected !== c.symbolsObserved) hardBlockers.push("SYMBOL_COVERAGE_MISMATCH");
  if (c.duplicateLogicalKeys > 0) hardBlockers.push("DUPLICATE_LOGICAL_KEYS");
  if (c.cePeMismatchBuckets > 0) hardBlockers.push("CE_PE_STRUCTURAL_MISMATCH");
  if (c.expiryDateShiftRows > 0) hardBlockers.push("EXPIRY_DATE_SHIFT_DETECTED");
  if (c.outsideSessionRows > 0) hardBlockers.push("OUTSIDE_SESSION_CONTAMINATION");
  if (c.futureLeakRows > 0) hardBlockers.push("FUTURE_DATA_LEAK");
  if (c.runningBlockRows > 0) hardBlockers.push("RUNNING_BLOCK_LEAK");
  if (c.researchEligiblePartialRows > 0) hardBlockers.push("PARTIAL_MARKED_RESEARCH_ELIGIBLE");
  if (c.researchEligibleStaleRows > 0) hardBlockers.push("STALE_MARKED_RESEARCH_ELIGIBLE");
  if (c.researchEligibleInvalidRows > 0) hardBlockers.push("INVALID_MARKED_RESEARCH_ELIGIBLE");
  if (c.traceabilityFailures > 0) hardBlockers.push("SNAPSHOT_OR_RULE_TRACEABILITY_FAILURE");
  if (c.alignedSevenIndexDays < c.requiredAlignedSevenIndexDays) hardBlockers.push("INSUFFICIENT_7_INDEX_ALIGNMENT");

  if (c.verifiedOutcomeCount === 0) warnings.push("NO_VERIFIED_OUTCOMES_YET");
  if (c.incompleteOutcomeCount > 0) warnings.push(`INCOMPLETE_OUTCOMES_${c.incompleteOutcomeCount}`);
  if (c.calibrationEligibleOutcomeCount < 30) warnings.push("CALIBRATION_SAMPLE_TOO_SMALL");
  if (c.regimeMatchedAnalogCount < 30) warnings.push("REGIME_MATCHED_ANALOG_SAMPLE_TOO_SMALL");

  const integrityStatus = hardBlockers.length === 0 ? "PASS" : "FAIL";
  const calibrationReadiness =
    integrityStatus === "PASS" && c.calibrationEligibleOutcomeCount >= 30 && c.regimeMatchedAnalogCount >= 30
      ? "STRUCTURE_READY"
      : "NOT_READY";

  return {
    integrityStatus,
    calibrationReadiness,
    hardBlockers,
    warnings,
    summary: integrityStatus === "FAIL"
      ? `Post-import integrity failed with ${hardBlockers.length} hard blocker(s).`
      : calibrationReadiness === "STRUCTURE_READY"
        ? "Structural integrity passed and minimum research samples exist; this does not itself validate or calibrate a probability model."
        : "Structural integrity passed, but calibration remains blocked until adequate verified samples exist.",
    ruleVersion: "H1_POST_IMPORT_INTEGRITY_V1",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}
