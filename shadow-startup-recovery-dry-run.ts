import { dbQuerySafe } from "./db.js";
import {
  runShadowPostgresRestartRuntime,
  type ShadowPostgresRestartRuntimeEnvelope,
  type ShadowPostgresRestartRuntimeResult,
} from "./shadow-postgres-restart-runtime-adapter.js";
import type { ShadowReplayDbQuery } from "./shadow-replay-postgres-store.js";

export interface ShadowStartupRecoveryDryRunInput {
  startupVersion: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1";
  startupFactsFresh: boolean;
  runtime: ShadowPostgresRestartRuntimeEnvelope;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowStartupRecoveryDryRunResult {
  version: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1";
  startupAccepted: boolean;
  decision: ShadowPostgresRestartRuntimeResult["decision"];
  runtimeAccepted: boolean;
  managementResumeAllowed: boolean;
  newEntryResumeAllowed: false;
  reconciliationRequired: boolean;
  effectiveOpenQuantity: number;
  dryRunOnly: true;
  startupSideEffectsAllowed: false;
  reasonCodes: string[];
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function halt(reasonCodes: string[]): ShadowStartupRecoveryDryRunResult {
  return {
    version: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1",
    startupAccepted: false,
    decision: "HALT",
    runtimeAccepted: false,
    managementResumeAllowed: false,
    newEntryResumeAllowed: false,
    reconciliationRequired: false,
    effectiveOpenQuantity: 0,
    dryRunOnly: true,
    startupSideEffectsAllowed: false,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export async function runShadowStartupRecoveryDryRun(
  input: ShadowStartupRecoveryDryRunInput,
  query: ShadowReplayDbQuery = dbQuerySafe,
): Promise<ShadowStartupRecoveryDryRunResult> {
  if (!input || input.startupVersion !== "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1") {
    return halt(["INVALID_STARTUP_DRY_RUN_VERSION"]);
  }
  if (input.startupFactsFresh !== true) return halt(["STARTUP_FACTS_STALE_OR_UNKNOWN"]);
  if (!input.runtime) return halt(["MISSING_STARTUP_RUNTIME_INPUT"]);
  if (typeof query !== "function") return halt(["INVALID_POSTGRES_QUERY_ADAPTER"]);
  if (
    input.authorizesOrder !== false ||
    input.brokerOrderAllowed !== false ||
    input.placesOrder !== false ||
    input.shadowOnly !== true ||
    input.failClosed !== true
  ) {
    return halt(["STARTUP_ORDER_OR_SHADOW_INVARIANT_VIOLATED"]);
  }

  try {
    const runtime = await runShadowPostgresRestartRuntime(input.runtime, query);
    return {
      version: "SHADOW_STARTUP_RECOVERY_DRY_RUN_V1",
      startupAccepted: true,
      decision: runtime.decision,
      runtimeAccepted: runtime.runtimeAccepted,
      managementResumeAllowed: runtime.managementResumeAllowed,
      newEntryResumeAllowed: false,
      reconciliationRequired: runtime.reconciliationRequired,
      effectiveOpenQuantity: runtime.effectiveOpenQuantity,
      dryRunOnly: true,
      startupSideEffectsAllowed: false,
      reasonCodes: runtime.reasonCodes,
      authorizesOrder: false,
      brokerOrderAllowed: false,
      placesOrder: false,
      shadowOnly: true,
      failClosed: true,
    };
  } catch {
    return halt(["STARTUP_RECOVERY_DRY_RUN_FAILED"]);
  }
}
