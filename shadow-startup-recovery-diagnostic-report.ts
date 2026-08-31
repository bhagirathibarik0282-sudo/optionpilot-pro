import type { ShadowStartupRecoveryDiagnosticSnapshot } from "./shadow-startup-recovery-diagnostic-snapshot.js";

export interface ShadowStartupRecoveryDiagnosticReport {
  version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_REPORT_V1";
  observedAt: string | null;
  status: "PASS" | "WARN" | "BLOCK";
  decision: ShadowStartupRecoveryDiagnosticSnapshot["decision"];
  diagnosticAccepted: boolean;
  startupAccepted: boolean;
  runtimeAccepted: boolean;
  managementResumeAllowed: boolean;
  newEntryResumeAllowed: false;
  reconciliationRequired: boolean;
  effectiveOpenQuantity: number;
  reasonCodes: string[];
  deterministicJson: string;
  diagnosticOnly: true;
  loggingSideEffectAllowed: false;
  startupSideEffectsAllowed: false;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function statusOf(snapshot: ShadowStartupRecoveryDiagnosticSnapshot): "PASS" | "WARN" | "BLOCK" {
  if (!snapshot.diagnosticAccepted || snapshot.decision === "HALT") return "BLOCK";
  if (snapshot.decision === "RECONCILE_REQUIRED") return "WARN";
  return "PASS";
}

export function buildShadowStartupRecoveryDiagnosticReport(
  snapshot: ShadowStartupRecoveryDiagnosticSnapshot,
): ShadowStartupRecoveryDiagnosticReport {
  const safe = snapshot && snapshot.authorizesOrder === false && snapshot.brokerOrderAllowed === false &&
    snapshot.placesOrder === false && snapshot.shadowOnly === true && snapshot.failClosed === true &&
    snapshot.startupSideEffectsAllowed === false && snapshot.newEntryResumeAllowed === false;

  const base = safe ? snapshot : {
    observedAt: null,
    diagnosticAccepted: false,
    startupAccepted: false,
    decision: "HALT" as const,
    runtimeAccepted: false,
    managementResumeAllowed: false,
    reconciliationRequired: false,
    effectiveOpenQuantity: 0,
    reasonCodes: ["DIAGNOSTIC_REPORT_INPUT_INVARIANT_VIOLATED"],
  };

  const payload = {
    version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_REPORT_V1" as const,
    observedAt: base.observedAt,
    status: safe ? statusOf(snapshot) : "BLOCK" as const,
    decision: base.decision,
    diagnosticAccepted: base.diagnosticAccepted,
    startupAccepted: base.startupAccepted,
    runtimeAccepted: base.runtimeAccepted,
    managementResumeAllowed: base.managementResumeAllowed,
    newEntryResumeAllowed: false as const,
    reconciliationRequired: base.reconciliationRequired,
    effectiveOpenQuantity: base.effectiveOpenQuantity,
    reasonCodes: [...base.reasonCodes],
    diagnosticOnly: true as const,
    loggingSideEffectAllowed: false as const,
    startupSideEffectsAllowed: false as const,
    authorizesOrder: false as const,
    brokerOrderAllowed: false as const,
    placesOrder: false as const,
    shadowOnly: true as const,
    failClosed: true as const,
  };

  return { ...payload, deterministicJson: JSON.stringify(payload) };
}
