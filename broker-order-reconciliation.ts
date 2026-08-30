export type BrokerOrderStatus = "PENDING" | "OPEN" | "PARTIAL" | "COMPLETE" | "CANCELLED" | "REJECTED" | "UNKNOWN";
export type ReconciliationDecision = "OK" | "RECONCILE" | "HALT";

export interface BrokerOrderReconciliationInput {
  brokerConnected: boolean;
  expectedQty: number;
  filledQty: number;
  pendingQty: number;
  brokerStatus: BrokerOrderStatus;
  hasDuplicateResidualIntent: boolean;
  orderStateFresh: boolean;
}

export interface BrokerOrderReconciliationResult {
  version: "BROKER_ORDER_RECONCILIATION_V1";
  decision: ReconciliationDecision;
  residualQty: number | null;
  protectFilledQty: number;
  allowNewEntry: boolean;
  allowResidualIntent: boolean;
  reasonCodes: string[];
  failClosed: true;
}

function validQty(v: number): boolean {
  return Number.isInteger(v) && v >= 0;
}

export function reconcileBrokerOrder(input: BrokerOrderReconciliationInput): BrokerOrderReconciliationResult {
  const reasons: string[] = [];

  if (!input?.brokerConnected) reasons.push("BROKER_DISCONNECTED");
  if (!input?.orderStateFresh) reasons.push("ORDER_STATE_STALE");
  if (!validQty(input?.expectedQty) || input.expectedQty <= 0) reasons.push("INVALID_EXPECTED_QTY");
  if (!validQty(input?.filledQty) || !validQty(input?.pendingQty)) reasons.push("INVALID_BROKER_QTY");
  if (input?.brokerStatus === "UNKNOWN") reasons.push("UNKNOWN_ORDER_STATE");

  if (reasons.length > 0) {
    return {
      version: "BROKER_ORDER_RECONCILIATION_V1",
      decision: "HALT",
      residualQty: null,
      protectFilledQty: validQty(input?.filledQty) ? input.filledQty : 0,
      allowNewEntry: false,
      allowResidualIntent: false,
      reasonCodes: reasons,
      failClosed: true,
    };
  }

  if (input.filledQty > input.expectedQty || input.pendingQty > input.expectedQty || input.filledQty + input.pendingQty > input.expectedQty) {
    return {
      version: "BROKER_ORDER_RECONCILIATION_V1",
      decision: "HALT",
      residualQty: null,
      protectFilledQty: input.filledQty,
      allowNewEntry: false,
      allowResidualIntent: false,
      reasonCodes: ["BROKER_QUANTITY_MISMATCH"],
      failClosed: true,
    };
  }

  const residualQty = input.expectedQty - input.filledQty - input.pendingQty;

  if (input.brokerStatus === "COMPLETE") {
    if (input.filledQty !== input.expectedQty || input.pendingQty !== 0) {
      return {
        version: "BROKER_ORDER_RECONCILIATION_V1",
        decision: "HALT",
        residualQty,
        protectFilledQty: input.filledQty,
        allowNewEntry: false,
        allowResidualIntent: false,
        reasonCodes: ["COMPLETE_STATUS_QTY_MISMATCH"],
        failClosed: true,
      };
    }
    return {
      version: "BROKER_ORDER_RECONCILIATION_V1",
      decision: "OK",
      residualQty: 0,
      protectFilledQty: input.filledQty,
      allowNewEntry: true,
      allowResidualIntent: false,
      reasonCodes: ["ORDER_COMPLETE_RECONCILED"],
      failClosed: true,
    };
  }

  if (input.brokerStatus === "PARTIAL" || (input.filledQty > 0 && residualQty > 0)) {
    if (input.hasDuplicateResidualIntent) {
      return {
        version: "BROKER_ORDER_RECONCILIATION_V1",
        decision: "HALT",
        residualQty,
        protectFilledQty: input.filledQty,
        allowNewEntry: false,
        allowResidualIntent: false,
        reasonCodes: ["DUPLICATE_RESIDUAL_INTENT"],
        failClosed: true,
      };
    }
    return {
      version: "BROKER_ORDER_RECONCILIATION_V1",
      decision: "RECONCILE",
      residualQty,
      protectFilledQty: input.filledQty,
      allowNewEntry: false,
      allowResidualIntent: residualQty > 0 && input.pendingQty === 0,
      reasonCodes: ["PARTIAL_FILL_RECONCILIATION_REQUIRED"],
      failClosed: true,
    };
  }

  if (input.brokerStatus === "PENDING" || input.brokerStatus === "OPEN") {
    return {
      version: "BROKER_ORDER_RECONCILIATION_V1",
      decision: "RECONCILE",
      residualQty,
      protectFilledQty: input.filledQty,
      allowNewEntry: false,
      allowResidualIntent: false,
      reasonCodes: ["ORDER_STILL_WORKING"],
      failClosed: true,
    };
  }

  if (input.brokerStatus === "CANCELLED" || input.brokerStatus === "REJECTED") {
    return {
      version: "BROKER_ORDER_RECONCILIATION_V1",
      decision: input.filledQty > 0 ? "RECONCILE" : "OK",
      residualQty,
      protectFilledQty: input.filledQty,
      allowNewEntry: input.filledQty === 0,
      allowResidualIntent: false,
      reasonCodes: [input.filledQty > 0 ? "TERMINAL_STATUS_WITH_PARTIAL_FILL" : "TERMINAL_STATUS_NO_FILL"],
      failClosed: true,
    };
  }

  return {
    version: "BROKER_ORDER_RECONCILIATION_V1",
    decision: "HALT",
    residualQty,
    protectFilledQty: input.filledQty,
    allowNewEntry: false,
    allowResidualIntent: false,
    reasonCodes: ["UNHANDLED_ORDER_STATE"],
    failClosed: true,
  };
}
