import type { ShadowStartupRecoveryDiagnosticReport } from "./shadow-startup-recovery-diagnostic-report.js";

export interface ShadowStartupRecoveryObservabilityResponse {
  version: "SHADOW_STARTUP_RECOVERY_OBSERVABILITY_V1";
  accepted: boolean;
  httpStatus: 200 | 503;
  contentType: "application/json; charset=utf-8";
  cacheControl: "no-store";
  body: string;
  readOnly: true;
  diagnosticOnly: true;
  loggingSideEffectAllowed: false;
  startupSideEffectsAllowed: false;
  newEntryResumeAllowed: false;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function blocked(reasonCode: string): ShadowStartupRecoveryObservabilityResponse {
  const payload = {
    version: "SHADOW_STARTUP_RECOVERY_OBSERVABILITY_V1" as const,
    accepted: false,
    status: "BLOCK" as const,
    decision: "HALT" as const,
    reasonCodes: [reasonCode],
    readOnly: true as const,
    diagnosticOnly: true as const,
    loggingSideEffectAllowed: false as const,
    startupSideEffectsAllowed: false as const,
    newEntryResumeAllowed: false as const,
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };
  return {
    version: "SHADOW_STARTUP_RECOVERY_OBSERVABILITY_V1",
    accepted: false,
    httpStatus: 503,
    contentType: "application/json; charset=utf-8",
    cacheControl: "no-store",
    body: JSON.stringify(payload),
    readOnly: true,
    diagnosticOnly: true,
    loggingSideEffectAllowed: false,
    startupSideEffectsAllowed: false,
    newEntryResumeAllowed: false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

function expectedDiagnosticPayload(report: ShadowStartupRecoveryDiagnosticReport) {
  return {
    version: report.version,
    observedAt: report.observedAt,
    status: report.status,
    decision: report.decision,
    diagnosticAccepted: report.diagnosticAccepted,
    startupAccepted: report.startupAccepted,
    runtimeAccepted: report.runtimeAccepted,
    managementResumeAllowed: report.managementResumeAllowed,
    newEntryResumeAllowed: report.newEntryResumeAllowed,
    reconciliationRequired: report.reconciliationRequired,
    effectiveOpenQuantity: report.effectiveOpenQuantity,
    reasonCodes: [...report.reasonCodes],
    diagnosticOnly: report.diagnosticOnly,
    loggingSideEffectAllowed: report.loggingSideEffectAllowed,
    startupSideEffectsAllowed: report.startupSideEffectsAllowed,
    authorizesOrder: report.authorizesOrder,
    brokerOrderAllowed: report.brokerOrderAllowed,
    placesOrder: report.placesOrder,
    shadowOnly: report.shadowOnly,
    failClosed: report.failClosed,
  };
}

export function buildShadowStartupRecoveryObservabilityResponse(
  report: ShadowStartupRecoveryDiagnosticReport,
): ShadowStartupRecoveryObservabilityResponse {
  if (!report || report.version !== "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_REPORT_V1") {
    return blocked("INVALID_DIAGNOSTIC_REPORT_VERSION");
  }

  const safe = report.diagnosticOnly === true &&
    report.loggingSideEffectAllowed === false &&
    report.startupSideEffectsAllowed === false &&
    report.newEntryResumeAllowed === false &&
    report.authorizesOrder === false &&
    report.brokerOrderAllowed === false &&
    report.placesOrder === false &&
    report.shadowOnly === true &&
    report.failClosed === true;

  if (!safe) return blocked("OBSERVABILITY_INPUT_INVARIANT_VIOLATED");

  let parsed: unknown;
  try {
    parsed = JSON.parse(report.deterministicJson);
  } catch {
    return blocked("INVALID_DIAGNOSTIC_REPORT_JSON");
  }
  if (JSON.stringify(parsed) !== report.deterministicJson) {
    return blocked("NON_DETERMINISTIC_DIAGNOSTIC_REPORT_JSON");
  }

  const expected = expectedDiagnosticPayload(report);
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    return blocked("DIAGNOSTIC_REPORT_SEMANTIC_MISMATCH");
  }

  return {
    version: "SHADOW_STARTUP_RECOVERY_OBSERVABILITY_V1",
    accepted: true,
    httpStatus: report.status === "BLOCK" ? 503 : 200,
    contentType: "application/json; charset=utf-8",
    cacheControl: "no-store",
    body: report.deterministicJson,
    readOnly: true,
    diagnosticOnly: true,
    loggingSideEffectAllowed: false,
    startupSideEffectsAllowed: false,
    newEntryResumeAllowed: false,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}
