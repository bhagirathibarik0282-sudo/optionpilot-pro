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
  previousState?: ShadowBrokerState;
}

export interface ShadowBrokerSubmissionResult {
  version: "SHADOW_BROKER_SUBMISSION_STATE_V1";
  state: ShadowBrokerState;
  reasonCodes: string[];
  failClosed: true;
  shadowOnly: true;
  placesOrder: false;
}

const terminalStates = new Set<ShadowBrokerState>(["BLOCKED", "REJECTED", "FILLED", "CANCELLED"]);
const progressionRank: Partial<Record<ShadowBrokerState, number>> = {
  AUTHORIZED: 1,
  SUBMISSION_SIMULATED: 2,
  ACKNOWLEDGED: 3,
  PARTIALLY_FILLED: 4,
  FILLED: 5,
};

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

  const nextState = classifyState(input);
  const previousState = input.previousState;

  if (previousState && terminalStates.has(previousState) && nextState !== previousState) {
    return result("BLOCKED", ["TERMINAL_STATE_REGRESSION"]);
  }

  const previousRank = previousState ? progressionRank[previousState] : undefined;
  const nextRank = progressionRank[nextState];
  if (previousRank !== undefined && nextRank !== undefined && nextRank < previousRank) {
    return result("BLOCKED", ["STATE_REGRESSION"]);
  }

  return stateResult(nextState);
}

function classifyState(input: ShadowBrokerSubmissionInput): ShadowBrokerState {
  if (input.cancelled) return "CANCELLED";
  if (input.brokerRejected) return "REJECTED";
  if (!input.simulatedSubmissionAccepted) return "AUTHORIZED";
  if (!input.brokerAcknowledged) return "SUBMISSION_SIMULATED";
  if (input.filledQuantity === input.totalQuantity) return "FILLED";
  if (input.filledQuantity > 0) return "PARTIALLY_FILLED";
  return "ACKNOWLEDGED";
}

function stateResult(state: ShadowBrokerState): ShadowBrokerSubmissionResult {
  switch (state) {
    case "CANCELLED": return result(state, ["SHADOW_ORDER_CANCELLED"]);
    case "REJECTED": return result(state, ["SHADOW_ORDER_REJECTED"]);
    case "AUTHORIZED": return result(state, ["AWAITING_SHADOW_SUBMISSION"]);
    case "SUBMISSION_SIMULATED": return result(state, ["AWAITING_SHADOW_ACKNOWLEDGEMENT"]);
    case "FILLED": return result(state, ["SHADOW_ORDER_FULLY_FILLED"]);
    case "PARTIALLY_FILLED": return result(state, ["SHADOW_ORDER_PARTIALLY_FILLED"]);
    case "ACKNOWLEDGED": return result(state, ["SHADOW_ORDER_ACKNOWLEDGED"]);
    default: return result("BLOCKED", ["UNKNOWN_SHADOW_BROKER_STATE"]);
  }
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
