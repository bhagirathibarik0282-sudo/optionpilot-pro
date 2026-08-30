// Shadow-only broker submission acknowledgement state machine.
// This module never calls a broker API and never places an order.

export type ShadowBrokerState =
  | "BLOCKED"
  | "AUTHORIZED"
  | "SUBMISSION_SIMULATED"
  | "ACKNOWLEDGED"
  | "REJECTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED";

export interface ShadowBrokerSubmissionInput {
  authorizationDecision: "AUTHORIZE_SIMULATION" | "BLOCK";
  simulatedSubmissionAccepted: boolean;
  brokerAcknowledged: boolean;
  brokerRejected: boolean;
  filledQuantity: number;
  totalQuantity: number;
  cancelled: boolean;
}

export interface ShadowBrokerSubmissionResult {
  version: "SHADOW_BROKER_SUBMISSION_STATE_V1";
  state: ShadowBrokerState;
  reasonCodes: string[];
  failClosed: true;
  shadowOnly: true;
  placesOrder: false;
}

export function evaluateShadowBrokerSubmission(
  input: ShadowBrokerSubmissionInput,
): ShadowBrokerSubmissionResult {
  const reasons: string[] = [];

  if (input?.authorizationDecision !== "AUTHORIZE_SIMULATION") {
    return result("BLOCKED", ["SIMULATION_NOT_AUTHORIZED"]);
  }

  if (!Number.isInteger(input?.totalQuantity) || input.totalQuantity <= 0) reasons.push("INVALID_TOTAL_QUANTITY");
  if (!Number.isInteger(input?.filledQuantity) || input.filledQuantity < 0) reasons.push("INVALID_FILLED_QUANTITY");
  if (Number.isInteger(input?.filledQuantity) && Number.isInteger(input?.totalQuantity) && input.filledQuantity > input.totalQuantity) {
    reasons.push("FILLED_QUANTITY_EXCEEDS_TOTAL");
  }
  if (input?.brokerRejected === true && input?.brokerAcknowledged === true) reasons.push("CONFLICTING_ACK_REJECT_STATE");
  if (input?.cancelled === true && input?.filledQuantity === input?.totalQuantity && input?.totalQuantity > 0) reasons.push("FILLED_AND_CANCELLED_CONFLICT");

  if (reasons.length > 0) return result("BLOCKED", reasons);
  if (input.cancelled) return result("CANCELLED", ["SHADOW_ORDER_CANCELLED"]);
  if (input.brokerRejected) return result("REJECTED", ["SHADOW_ORDER_REJECTED"]);
  if (!input.simulatedSubmissionAccepted) return result("AUTHORIZED", ["AWAITING_SHADOW_SUBMISSION"]);
  if (!input.brokerAcknowledged) return result("SUBMISSION_SIMULATED", ["AWAITING_SHADOW_ACKNOWLEDGEMENT"]);
  if (input.filledQuantity === input.totalQuantity) return result("FILLED", ["SHADOW_ORDER_FULLY_FILLED"]);
  if (input.filledQuantity > 0) return result("PARTIALLY_FILLED", ["SHADOW_ORDER_PARTIALLY_FILLED"]);
  return result("ACKNOWLEDGED", ["SHADOW_ORDER_ACKNOWLEDGED"]);
}

function result(state: ShadowBrokerState, reasonCodes: string[]): ShadowBrokerSubmissionResult {
  return {
    version: "SHADOW_BROKER_SUBMISSION_STATE_V1",
    state,
    reasonCodes,
    failClosed: true,
    shadowOnly: true,
    placesOrder: false,
  };
}
