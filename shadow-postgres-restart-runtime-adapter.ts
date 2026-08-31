import { dbQuerySafe } from "./db.js";
import {
  runShadowPostgresRestartRecoveryE2E,
  type ShadowPostgresRestartRecoveryE2EInput,
  type ShadowPostgresRestartRecoveryE2EResult,
} from "./shadow-postgres-restart-recovery-e2e.js";
import type { ShadowReplayDbQuery } from "./shadow-replay-postgres-store.js";

export interface ShadowPostgresRestartRuntimeEnvelope {
  runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1";
  recovery: ShadowPostgresRestartRecoveryE2EInput;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowPostgresRestartRuntimeResult extends ShadowPostgresRestartRecoveryE2EResult {
  runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1";
  runtimeAccepted: boolean;
}

function blocked(reasonCodes: string[]): ShadowPostgresRestartRuntimeResult {
  return {
    runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1",
    runtimeAccepted: false,
    version: "SHADOW_POSTGRES_RESTART_RECOVERY_E2E_V1",
    durableBackend: "POSTGRES",
    decision: "HALT",
    persistenceDecision: "BLOCK",
    persistenceConfirmed: false,
    semanticReadBackConfirmed: false,
    managementResumeAllowed: false,
    newEntryResumeAllowed: false,
    reconciliationRequired: false,
    effectiveOpenQuantity: 0,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export async function runShadowPostgresRestartRuntime(
  envelope: ShadowPostgresRestartRuntimeEnvelope,
  query: ShadowReplayDbQuery = dbQuerySafe,
): Promise<ShadowPostgresRestartRuntimeResult> {
  if (!envelope || envelope.runtimeVersion !== "SHADOW_POSTGRES_RESTART_RUNTIME_V1") {
    return blocked(["INVALID_RUNTIME_VERSION"]);
  }
  if (!envelope.recovery) return blocked(["MISSING_RUNTIME_RECOVERY_INPUT"]);
  if (typeof query !== "function") return blocked(["INVALID_POSTGRES_QUERY_ADAPTER"]);
  if (
    envelope.authorizesOrder !== false ||
    envelope.brokerOrderAllowed !== false ||
    envelope.placesOrder !== false ||
    envelope.shadowOnly !== true ||
    envelope.failClosed !== true
  ) {
    return blocked(["RUNTIME_ORDER_OR_SHADOW_INVARIANT_VIOLATED"]);
  }

  try {
    const result = await runShadowPostgresRestartRecoveryE2E(envelope.recovery, query);
    return {
      ...result,
      runtimeVersion: "SHADOW_POSTGRES_RESTART_RUNTIME_V1",
      runtimeAccepted: true,
      authorizesOrder: false,
      brokerOrderAllowed: false,
      placesOrder: false,
      shadowOnly: true,
      failClosed: true,
    };
  } catch {
    return blocked(["RUNTIME_RECOVERY_COMPOSITION_FAILED"]);
  }
}
