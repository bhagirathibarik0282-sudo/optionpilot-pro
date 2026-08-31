export type ShadowBrokerState =
  | "BLOCKED"
  | "AUTHORIZED"
  | "SUBMISSION_SIMULATED"
  | "ACKNOWLEDGED"
  | "REJECTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED";

export interface ShadowBrokerStateRecoveryGuardInput {
  stateVersion: "SHADOW_BROKER_SUBMISSION_STATE_V1";
  state: ShadowBrokerState;
  stateFactsFresh: boolean;
  filledQuantity: number;
  totalQuantity: number;
  cancelled: boolean;
  exactContractBound: boolean;
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

export interface ShadowBrokerStateRecoveryGuardResult {
  version: "SHADOW_BROKER_STATE_RECOVERY_GUARD_V1";
  decision: "ALLOW_STATE" | "RECONCILE_REQUIRED" | "BLOCK";
  effectiveOpenQuantity: number;
  reasonCodes: string[];
  authorizesOrder: false;
  brokerOrderAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
}

function out(
  decision: ShadowBrokerStateRecoveryGuardResult["decision"],
  effectiveOpenQuantity: number,
  reasonCodes: string[],
): ShadowBrokerStateRecoveryGuardResult {
  return {
    version: "SHADOW_BROKER_STATE_RECOVERY_GUARD_V1",
    decision,
    effectiveOpenQuantity,
    reasonCodes,
    authorizesOrder: false,
    brokerOrderAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
  };
}

export function guardShadowBrokerStateRecovery(
  input: ShadowBrokerStateRecoveryGuardInput,
): ShadowBrokerStateRecoveryGuardResult {
  const reasons: string[] = [];
  if (input?.stateVersion !== "SHADOW_BROKER_SUBMISSION_STATE_V1") reasons.push("INVALID_STATE_VERSION");
  if (!["BLOCKED","AUTHORIZED","SUBMISSION_SIMULATED","ACKNOWLEDGED","REJECTED","PARTIALLY_FILLED","FILLED","CANCELLED"].includes(input?.state)) reasons.push("INVALID_STATE");
  if (input?.stateFactsFresh !== true && input?.stateFactsFresh !== false) reasons.push("INVALID_STATE_FRESHNESS");
  if (!Number.isInteger(input?.filledQuantity) || input.filledQuantity < 0) reasons.push("INVALID_FILLED_QUANTITY");
  if (!Number.isInteger(input?.totalQuantity) || input.totalQuantity <= 0) reasons.push("INVALID_TOTAL_QUANTITY");
  if (Number.isInteger(input?.filledQuantity) && Number.isInteger(input?.totalQuantity) && input.filledQuantity > input.totalQuantity) reasons.push("FILLED_QUANTITY_EXCEEDS_TOTAL");
  if (input?.exactContractBound !== true && input?.exactContractBound !== false) reasons.push("INVALID_CONTRACT_BINDING");
  if (input?.authorizesOrder !== false) reasons.push("ORDER_AUTHORIZATION_INVARIANT_VIOLATED");
  if (input?.brokerOrderAllowed !== false) reasons.push("BROKER_ORDER_INVARIANT_VIOLATED");
  if (input?.placesOrder !== false) reasons.push("ORDER_PLACEMENT_INVARIANT_VIOLATED");
  if (input?.shadowOnly !== true) reasons.push("SHADOW_ONLY_INVARIANT_VIOLATED");
  if (input?.failClosed !== true) reasons.push("FAIL_CLOSED_INVARIANT_VIOLATED");
  if (reasons.length) return out("BLOCK", 0, reasons);

  if (!input.exactContractBound) return out("BLOCK", 0, ["EXACT_CONTRACT_NOT_BOUND"]);
  if (!input.stateFactsFresh) return out("RECONCILE_REQUIRED", 0, ["STALE_OR_UNKNOWN_BROKER_STATE_FACTS"]);

  if (input.state === "BLOCKED") return out("BLOCK", 0, ["UPSTREAM_STATE_BLOCKED"]);

  if (input.cancelled && input.filledQuantity > 0 && input.filledQuantity < input.totalQuantity) {
    return out("RECONCILE_REQUIRED", input.filledQuantity, ["PARTIAL_FILL_CANCEL_REQUIRES_RECONCILIATION"]);
  }

  if (input.state === "FILLED" && input.filledQuantity !== input.totalQuantity) {
    return out("RECONCILE_REQUIRED", input.filledQuantity, ["FILLED_STATE_QUANTITY_MISMATCH"]);
  }

  if (input.state === "PARTIALLY_FILLED" && !(input.filledQuantity > 0 && input.filledQuantity < input.totalQuantity)) {
    return out("RECONCILE_REQUIRED", input.filledQuantity, ["PARTIAL_STATE_QUANTITY_MISMATCH"]);
  }

  return out("ALLOW_STATE", input.filledQuantity, ["SHADOW_BROKER_STATE_RECOVERY_SAFE"]);
}
