export type PositionTruthDecision = "MATCH" | "RECONCILE" | "CRITICAL_UNMANAGED_POSITION" | "HALT";
export type OrderReconciliationDecision = "OK" | "RECONCILE" | "HALT";
export type ProtectionHealth = "PROTECTED" | "DEGRADED_BUT_SAFE" | "RESTORE_REQUIRED" | "EMERGENCY_EXIT_REQUIRED";
export type ConsistencyKillSwitchDecision = "RUN" | "HALT_NEW_ENTRIES" | "EMERGENCY_EXIT_INTENT";
export type ExecutionConsistencyState = "READY" | "RECONCILE" | "HALT" | "EMERGENCY";

export interface ExecutionConsistencyInput {
  exactContractIdentityValid: boolean;
  positionTruthDecision: PositionTruthDecision;
  orderReconciliationDecision: OrderReconciliationDecision;
  protectionHealth: ProtectionHealth;
  idempotencyDecision: "ALLOW" | "BLOCK";
  preTradePersistenceConfirmed: boolean;
  brokerSessionReady: boolean;
  killSwitchDecision: ConsistencyKillSwitchDecision;
  hasOpenPosition: boolean;
  quantumStatus?: "READY" | "FALLBACK" | "UNAVAILABLE";
}

export interface ExecutionConsistencySnapshot {
  version: "EXECUTION_CONSISTENCY_SNAPSHOT_V1";
  state: ExecutionConsistencyState;
  newEntryAllowed: boolean;
  managementAllowed: boolean;
  emergencyExitRequired: boolean;
  reasonCodes: string[];
  brokerOrderAllowed: false;
  placesOrder: false;
  failClosed: true;
}

function validBool(v: unknown): v is boolean {
  return v === true || v === false;
}

export function evaluateExecutionConsistencySnapshot(
  input: ExecutionConsistencyInput,
): ExecutionConsistencySnapshot {
  const reasons: string[] = [];

  if (!validBool(input?.exactContractIdentityValid)) reasons.push("INVALID_CONTRACT_IDENTITY_STATE");
  if (!validBool(input?.preTradePersistenceConfirmed)) reasons.push("INVALID_PERSISTENCE_STATE");
  if (!validBool(input?.brokerSessionReady)) reasons.push("INVALID_BROKER_SESSION_STATE");
  if (!validBool(input?.hasOpenPosition)) reasons.push("INVALID_POSITION_PRESENCE_STATE");
  if (!["MATCH", "RECONCILE", "CRITICAL_UNMANAGED_POSITION", "HALT"].includes(input?.positionTruthDecision)) reasons.push("INVALID_POSITION_TRUTH_DECISION");
  if (!["OK", "RECONCILE", "HALT"].includes(input?.orderReconciliationDecision)) reasons.push("INVALID_ORDER_RECONCILIATION_DECISION");
  if (!["PROTECTED", "DEGRADED_BUT_SAFE", "RESTORE_REQUIRED", "EMERGENCY_EXIT_REQUIRED"].includes(input?.protectionHealth)) reasons.push("INVALID_PROTECTION_HEALTH");
  if (!["ALLOW", "BLOCK"].includes(input?.idempotencyDecision)) reasons.push("INVALID_IDEMPOTENCY_DECISION");
  if (!["RUN", "HALT_NEW_ENTRIES", "EMERGENCY_EXIT_INTENT"].includes(input?.killSwitchDecision)) reasons.push("INVALID_KILL_SWITCH_DECISION");
  if (input?.quantumStatus !== undefined && !["READY", "FALLBACK", "UNAVAILABLE"].includes(input.quantumStatus)) reasons.push("INVALID_QUANTUM_STATUS");

  const base = (
    state: ExecutionConsistencyState,
    reasonCodes: string[],
    emergencyExitRequired = false,
    managementAllowed = false,
  ): ExecutionConsistencySnapshot => ({
    version: "EXECUTION_CONSISTENCY_SNAPSHOT_V1",
    state,
    newEntryAllowed: state === "READY",
    managementAllowed,
    emergencyExitRequired,
    reasonCodes,
    brokerOrderAllowed: false,
    placesOrder: false,
    failClosed: true,
  });

  if (reasons.length > 0) return base("HALT", reasons, false, false);

  // Emergency has highest precedence and only makes sense when a position exists.
  if (input.killSwitchDecision === "EMERGENCY_EXIT_INTENT" || input.protectionHealth === "EMERGENCY_EXIT_REQUIRED") {
    if (input.hasOpenPosition) {
      return base("EMERGENCY", [
        input.killSwitchDecision === "EMERGENCY_EXIT_INTENT" ? "KILL_SWITCH_EMERGENCY_EXIT" : "PROTECTION_EMERGENCY_EXIT",
      ], true, true);
    }
    return base("HALT", ["EMERGENCY_SIGNAL_WITHOUT_CONFIRMED_OPEN_POSITION"], false, false);
  }

  if (input.positionTruthDecision === "CRITICAL_UNMANAGED_POSITION") {
    if (input.hasOpenPosition) {
      return base("EMERGENCY", ["CRITICAL_UNMANAGED_POSITION"], true, true);
    }
    return base("HALT", ["CRITICAL_POSITION_STATE_WITHOUT_CONFIRMED_OPEN_POSITION"], false, false);
  }

  // Hard fail-closed dimensions.
  const hardReasons: string[] = [];
  if (!input.exactContractIdentityValid) hardReasons.push("EXACT_CONTRACT_IDENTITY_NOT_VALID");
  if (input.positionTruthDecision === "HALT") hardReasons.push("POSITION_TRUTH_HALTED");
  if (input.orderReconciliationDecision === "HALT") hardReasons.push("ORDER_RECONCILIATION_HALTED");
  if (input.idempotencyDecision !== "ALLOW") hardReasons.push("IDEMPOTENCY_NOT_CLEAR");
  if (!input.preTradePersistenceConfirmed) hardReasons.push("PRE_TRADE_PERSISTENCE_UNCONFIRMED");
  if (!input.brokerSessionReady) hardReasons.push("BROKER_SESSION_NOT_READY");
  if (input.killSwitchDecision === "HALT_NEW_ENTRIES") hardReasons.push("KILL_SWITCH_HALTS_NEW_ENTRIES");
  if (hardReasons.length > 0) {
    return base("HALT", hardReasons, false, input.hasOpenPosition && input.protectionHealth !== "RESTORE_REQUIRED");
  }

  // Known/recoverable states require reconciliation and never authorize a new entry.
  const reconcileReasons: string[] = [];
  if (input.positionTruthDecision === "RECONCILE") reconcileReasons.push("POSITION_TRUTH_RECONCILIATION_REQUIRED");
  if (input.orderReconciliationDecision === "RECONCILE") reconcileReasons.push("ORDER_RECONCILIATION_REQUIRED");
  if (input.protectionHealth === "RESTORE_REQUIRED") reconcileReasons.push("PROTECTION_RESTORE_REQUIRED");
  if (reconcileReasons.length > 0) {
    return base("RECONCILE", reconcileReasons, false, input.hasOpenPosition);
  }

  // Quantum degradation is optional when deterministic protection is safe.
  const readyReasons = input.quantumStatus === "UNAVAILABLE" || input.quantumStatus === "FALLBACK"
    ? ["EXECUTION_CONSISTENCY_READY", "QUANTUM_OPTIONAL_DETERMINISTIC_FALLBACK"]
    : ["EXECUTION_CONSISTENCY_READY"];

  return base("READY", readyReasons, false, input.hasOpenPosition);
}
