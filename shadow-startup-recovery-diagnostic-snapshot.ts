import { dbQuerySafe } from "./db.js";
import {
  runShadowStartupRecoveryDryRun,
  type ShadowStartupRecoveryDryRunInput,
  type ShadowStartupRecoveryDryRunResult,
} from "./shadow-startup-recovery-dry-run.js";
import type { ShadowReplayDbQuery } from "./shadow-replay-postgres-store.js";

export interface ShadowStartupRecoveryDiagnosticInput {
  diagnosticVersion: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1";
  observedAt: string;
  dryRun: ShadowStartupRecoveryDryRunInput;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowStartupRecoveryDiagnosticSnapshot {
  version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1";
  observedAt: string | null;
  diagnosticAccepted: boolean;
  dryRunVersion: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1";
  startupAccepted: boolean;
  decision: ShadowStartupRecoveryDryRunResult["decision"];
  runtimeAccepted: boolean;
  managementResumeAllowed: boolean;
  newEntryResumeAllowed: false;
  reconciliationRequired: boolean;
  effectiveOpenQuantity: number;
  dryRunOnly: true;
  startupSideEffectsAllowed: false;
  diagnosticOnly: true;
  reasonCodes: string[];
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function validIso(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function blocked(reasonCodes: string[], observedAt: string | null = null): ShadowStartupRecoveryDiagnosticSnapshot {
  return {
    version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1",
    observedAt,
    diagnosticAccepted: false,
    dryRunVersion: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1",
    startupAccepted: false,
    decision: "HALT",
    runtimeAccepted: false,
    managementResumeAllowed: false,
    newEntryResumeAllowed: false,
    reconciliationRequired: false,
    effectiveOpenQuantity: 0,
    dryRunOnly: true,
    startupSideEffectsAllowed: false,
    diagnosticOnly: true,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export async function buildShadowStartupRecoveryDiagnosticSnapshot(
  input: ShadowStartupRecoveryDiagnosticInput,
  query: ShadowReplayDbQuery = dbQuerySafe,
): Promise<ShadowStartupRecoveryDiagnosticSnapshot> {
  if (!input || input.diagnosticVersion !== "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1") {
    return blocked(["INVALID_STARTUP_DIAGNOSTIC_VERSION"]);
  }
  if (!validIso(input.observedAt)) return blocked(["INVALID_OBSERVED_AT"]);
  if (!input.dryRun) return blocked(["MISSING_DRY_RUN_INPUT"], input.observedAt);
  if (typeof query !== "function") return blocked(["INVALID_POSTGRES_QUERY_ADAPTER"], input.observedAt);
  if (
    input.authorizesOrder !== false ||
    input.brokerOrderAllowed !== false ||
    input.placesOrder !== false ||
    input.shadowOnly !== true ||
    input.failClosed !== true
  ) {
    return blocked(["DIAGNOSTIC_ORDER_OR_SHADOW_INVARIANT_VIOLATED"], input.observedAt);
  }

  try {
    const result = await runShadowStartupRecoveryDryRun(input.dryRun, query);
    return {
      version: "SHADOW_STARTUP_RECOVERY_DIAGNOSTIC_V1",
      observedAt: input.observedAt,
      diagnosticAccepted: true,
      dryRunVersion: result.version,
      startupAccepted: result.startupAccepted,
      decision: result.decision,
      runtimeAccepted: result.runtimeAccepted,
      managementResumeAllowed: result.managementResumeAllowed,
      newEntryResumeAllowed: false,
      reconciliationRequired: result.reconciliationRequired,
      effectiveOpenQuantity: result.effectiveOpenQuantity,
      dryRunOnly: true,
      startupSideEffectsAllowed: false,
      diagnosticOnly: true,
      reasonCodes: result.reasonCodes,
      authorizesOrder: false,
      brokerOrderAllowed: false,
      placesOrder: false,
      shadowOnly: true,
      failClosed: true,
    };
  } catch {
    return blocked(["STARTUP_DIAGNOSTIC_BUILD_FAILED"], input.observedAt);
  }
}
