export type ShadowRestartRecoveryDecision =
  | "RESUME_IDLE_SHADOW"
  | "RESUME_MANAGEMENT_SHADOW"
  | "RECONCILE_REQUIRED"
  | "HALT";

export interface ShadowRestartRecoveryCoordinatorInput {
  persistenceVersion: "SHADOW_REPLAY_PERSISTENCE_V1";
  persistenceDecision: "PERSISTENCE_CONFIRMED" | "REUSE_CONFIRMED" | "BLOCK";
  persistenceConfirmed: boolean;
  reusableAfterRestart: boolean;
  recoveryVersion: "SHADOW_BROKER_STATE_RECOVERY_GUARD_V1";
  recoveryDecision: "ALLOW_STATE" | "RECONCILE_REQUIRED" | "BLOCK";
  effectiveOpenQuantity: number;
  exactContractBound: boolean;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowRestartRecoveryCoordinatorResult {
  version: "SHADOW_RESTART_RECOVERY_COORDINATOR_V1";
  decision: ShadowRestartRecoveryDecision;
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

function out(
  decision: ShadowRestartRecoveryDecision,
  effectiveOpenQuantity: number,
  reasonCodes: string[],
  managementResumeAllowed = false,
  reconciliationRequired = false,
): ShadowRestartRecoveryCoordinatorResult {
  return {
    version: "SHADOW_RESTART_RECOVERY_COORDINATOR_V1",
    decision,
    managementResumeAllowed,
    newEntryResumeAllowed: false,
    reconciliationRequired,
    effectiveOpenQuantity,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function coordinateShadowRestartRecovery(
  input: ShadowRestartRecoveryCoordinatorInput,
): ShadowRestartRecoveryCoordinatorResult {
  const reasons: string[] = [];
  if (input?.persistenceVersion !== "SHADOW_REPLAY_PERSISTENCE_V1") reasons.push("INVALID_PERSISTENCE_VERSION");
  if (!["PERSISTENCE_CONFIRMED", "REUSE_CONFIRMED", "BLOCK"].includes(input?.persistenceDecision)) reasons.push("INVALID_PERSISTENCE_DECISION");
  if (input?.recoveryVersion !== "SHADOW_BROKER_STATE_RECOVERY_GUARD_V1") reasons.push("INVALID_RECOVERY_VERSION");
  if (!["ALLOW_STATE", "RECONCILE_REQUIRED", "BLOCK"].includes(input?.recoveryDecision)) reasons.push("INVALID_RECOVERY_DECISION");
  if (!Number.isInteger(input?.effectiveOpenQuantity) || input.effectiveOpenQuantity < 0) reasons.push("INVALID_EFFECTIVE_OPEN_QUANTITY");
  if (input?.exactContractBound !== true && input?.exactContractBound !== false) reasons.push("INVALID_CONTRACT_BINDING");
  if (input?.persistenceConfirmed !== true && input?.persistenceConfirmed !== false) reasons.push("INVALID_PERSISTENCE_CONFIRMED_FLAG");
  if (input?.reusableAfterRestart !== true && input?.reusableAfterRestart !== false) reasons.push("INVALID_RESTART_REUSE_FLAG");
  if (input?.authorizesOrder !== false) reasons.push("ORDER_AUTHORIZATION_INVARIANT_VIOLATED");
  if (input?.brokerOrderAllowed !== false) reasons.push("BROKER_ORDER_INVARIANT_VIOLATED");
  if (input?.placesOrder !== false) reasons.push("ORDER_PLACEMENT_INVARIANT_VIOLATED");
  if (input?.shadowOnly !== true) reasons.push("SHADOW_ONLY_INVARIANT_VIOLATED");
  if (input?.failClosed !== true) reasons.push("FAIL_CLOSED_INVARIANT_VIOLATED");
  if (reasons.length) return out("HALT", 0, reasons);

  if (!input.exactContractBound) return out("HALT", 0, ["EXACT_CONTRACT_NOT_BOUND"]);
  if (input.persistenceDecision === "BLOCK" || !input.persistenceConfirmed || !input.reusableAfterRestart) {
    return out("HALT", 0, ["DURABLE_REPLAY_NOT_SAFE_FOR_RESTART"]);
  }
  if (input.recoveryDecision === "BLOCK") return out("HALT", 0, ["BROKER_RECOVERY_STATE_BLOCKED"]);
  if (input.recoveryDecision === "RECONCILE_REQUIRED") {
    return out("RECONCILE_REQUIRED", input.effectiveOpenQuantity, ["RESTART_REQUIRES_RECONCILIATION"], false, true);
  }
  if (input.effectiveOpenQuantity > 0) {
    return out("RESUME_MANAGEMENT_SHADOW", input.effectiveOpenQuantity, ["SAFE_SHADOW_MANAGEMENT_RESUME"], true, false);
  }
  return out("RESUME_IDLE_SHADOW", 0, ["SAFE_SHADOW_IDLE_RESUME_NO_ENTRY_REPLAY"]);
}
