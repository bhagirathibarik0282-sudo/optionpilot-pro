import { verifyShadowReplayPersistence, type ShadowReplayPersistenceInput } from "./shadow-replay-persistence.js";
import { guardShadowBrokerStateRecovery, type ShadowBrokerStateRecoveryGuardInput } from "./shadow-broker-state-recovery-guard.js";
import { coordinateShadowRestartRecovery } from "./shadow-restart-recovery-coordinator.js";

export interface ShadowRestartRecoveryE2EInput {
  persistence: ShadowReplayPersistenceInput;
  brokerRecovery: ShadowBrokerStateRecoveryGuardInput;
}

export interface ShadowRestartRecoveryE2EResult {
  version: "SHADOW_RESTART_RECOVERY_E2E_V1";
  decision: "RESUME_IDLE_SHADOW" | "RESUME_MANAGEMENT_SHADOW" | "RECONCILE_REQUIRED" | "HALT";
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

function halt(reasonCodes: string[]): ShadowRestartRecoveryE2EResult {
  return {
    version: "SHADOW_RESTART_RECOVERY_E2E_V1",
    decision: "HALT",
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

export function runShadowRestartRecoveryE2E(input: ShadowRestartRecoveryE2EInput): ShadowRestartRecoveryE2EResult {
  if (!input?.persistence || !input?.brokerRecovery) return halt(["MISSING_RECOVERY_INPUT"]);
  if (input.persistence.authorizesOrder !== false || input.persistence.brokerOrderAllowed !== false || input.persistence.placesOrder !== false) {
    return halt(["PERSISTENCE_ORDER_INVARIANT_VIOLATED"]);
  }
  if (input.brokerRecovery.authorizesOrder !== false || input.brokerRecovery.brokerOrderAllowed !== false || input.brokerRecovery.placesOrder !== false) {
    return halt(["BROKER_RECOVERY_ORDER_INVARIANT_VIOLATED"]);
  }

  const persistence = verifyShadowReplayPersistence(input.persistence);
  const recovery = guardShadowBrokerStateRecovery(input.brokerRecovery);
  const coordinated = coordinateShadowRestartRecovery({
    persistenceVersion: persistence.version,
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
    version: "SHADOW_RESTART_RECOVERY_E2E_V1",
    decision: coordinated.decision,
    managementResumeAllowed: coordinated.managementResumeAllowed,
    newEntryResumeAllowed: false,
    reconciliationRequired: coordinated.reconciliationRequired,
    effectiveOpenQuantity: coordinated.effectiveOpenQuantity,
    reasonCodes: coordinated.reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}
