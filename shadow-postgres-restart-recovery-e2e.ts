import { dbQuerySafe } from "./db.js";
import {
  persistShadowReplayToPostgres,
  type ShadowReplayPostgresPersistenceResult,
} from "./shadow-replay-postgres-persistence.js";
import type { ShadowReplayPersistenceAdapterInput } from "./shadow-replay-persistence-adapter.js";
import type { ShadowReplayDbQuery } from "./shadow-replay-postgres-store.js";
import {
  guardShadowBrokerStateRecovery,
  type ShadowBrokerStateRecoveryGuardInput,
} from "./shadow-broker-state-recovery-guard.js";
import { coordinateShadowRestartRecovery } from "./shadow-restart-recovery-coordinator.js";

export interface ShadowPostgresRestartRecoveryE2EInput {
  persistence: ShadowReplayPersistenceAdapterInput;
  brokerRecovery: ShadowBrokerStateRecoveryGuardInput;
}

export interface ShadowPostgresRestartRecoveryE2EResult {
  version: "SHADOW_POSTGRES_RESTART_RECOVERY_E2E_V1";
  durableBackend: "POSTGRES";
  decision: "RESUME_IDLE_SHADOW" | "RESUME_MANAGEMENT_SHADOW" | "RECONCILE_REQUIRED" | "HALT";
  persistenceDecision: ShadowReplayPostgresPersistenceResult["decision"];
  persistenceConfirmed: boolean;
  semanticReadBackConfirmed: boolean;
  managementResumeAllowed: boolean;
  newEntryResumeAllowed: false;
  reconciliationRequired: boolean;
  effectiveOpenQuantity: number;
  reasonCodes: string[];
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function halt(reasonCodes: string[]): ShadowPostgresRestartRecoveryE2EResult {
  return {
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

export async function runShadowPostgresRestartRecoveryE2E(
  input: ShadowPostgresRestartRecoveryE2EInput,
  query: ShadowReplayDbQuery = dbQuerySafe,
): Promise<ShadowPostgresRestartRecoveryE2EResult> {
  if (!input?.persistence || !input?.brokerRecovery) return halt(["MISSING_RECOVERY_INPUT"]);
  if (typeof query !== "function") return halt(["INVALID_POSTGRES_QUERY_ADAPTER"]);

  if (
    input.persistence.authorizesOrder !== false ||
    input.persistence.brokerOrderAllowed !== false ||
    input.persistence.placesOrder !== false ||
    input.persistence.shadowOnly !== true ||
    input.persistence.failClosed !== true
  ) {
    return halt(["PERSISTENCE_ORDER_OR_SHADOW_INVARIANT_VIOLATED"]);
  }

  if (
    input.brokerRecovery.authorizesOrder !== false ||
    input.brokerRecovery.brokerOrderAllowed !== false ||
    input.brokerRecovery.placesOrder !== false ||
    input.brokerRecovery.shadowOnly !== true ||
    input.brokerRecovery.failClosed !== true
  ) {
    return halt(["BROKER_RECOVERY_ORDER_OR_SHADOW_INVARIANT_VIOLATED"]);
  }

  const persistence = await persistShadowReplayToPostgres(input.persistence, query);
  const recovery = guardShadowBrokerStateRecovery(input.brokerRecovery);

  const coordinated = coordinateShadowRestartRecovery({
    persistenceVersion: "SHADOW_REPLAY_PERSISTENCE_V1",
    persistenceDecision: persistence.decision,
    persistenceConfirmed: persistence.persistenceConfirmed,
    reusableAfterRestart: persistence.reusableAfterRestart,
    recoveryVersion: recovery.version,
    recoveryDecision: recovery.decision,
    effectiveOpenQuantity: recovery.effectiveOpenQuantity,
    exactContractBound: input.brokerRecovery.exactContractBound,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  });

  return {
    version: "SHADOW_POSTGRES_RESTART_RECOVERY_E2E_V1",
    durableBackend: "POSTGRES",
    decision: coordinated.decision,
    persistenceDecision: persistence.decision,
    persistenceConfirmed: persistence.persistenceConfirmed,
    semanticReadBackConfirmed: persistence.semanticReadBackConfirmed,
    managementResumeAllowed: coordinated.managementResumeAllowed,
    newEntryResumeAllowed: false,
    reconciliationRequired: coordinated.reconciliationRequired,
    effectiveOpenQuantity: coordinated.effectiveOpenQuantity,
    reasonCodes: [...persistence.reasonCodes, ...recovery.reasonCodes, ...coordinated.reasonCodes],
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}
