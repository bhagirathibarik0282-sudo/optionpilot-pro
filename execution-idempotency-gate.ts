export type ExecutionIntentState = "NONE" | "PENDING" | "ACCEPTED" | "FILLED" | "CANCELLED" | "REJECTED";
export type IdempotencyDecision = "ALLOW" | "BLOCK";

export interface ExecutionIdempotencyInput {
  tradeDate: string;
  sessionKey: string;
  signalFingerprint: string;
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  side: "CE" | "PE";
  strike: number;
  expiryDate: string;
  existingState: ExecutionIntentState;
  freshSignalConfirmed: boolean;
  explicitRetryAllowed: boolean;
}

export interface ExecutionIdempotencyResult {
  version: "EXECUTION_IDEMPOTENCY_GATE_V1";
  decision: IdempotencyDecision;
  idempotencyKey: string | null;
  reasonCodes: string[];
  failClosed: true;
}

function nonEmpty(v: string): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function validPositive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

export function buildExecutionIdempotencyKey(input: ExecutionIdempotencyInput): string | null {
  if (!nonEmpty(input?.tradeDate) || !nonEmpty(input?.sessionKey) || !nonEmpty(input?.signalFingerprint) ||
      !nonEmpty(input?.expiryDate) || !validPositive(input?.strike)) return null;
  return [
    "EXEC",
    input.tradeDate,
    input.sessionKey,
    input.signalFingerprint,
    input.symbol,
    input.side,
    String(input.strike),
    input.expiryDate,
  ].join(":");
}

export function evaluateExecutionIdempotencyGate(input: ExecutionIdempotencyInput): ExecutionIdempotencyResult {
  const reasons: string[] = [];
  const key = buildExecutionIdempotencyKey(input);
  if (!key) reasons.push("INVALID_IDEMPOTENCY_IDENTITY");

  if (!["NONE","PENDING","ACCEPTED","FILLED","CANCELLED","REJECTED"].includes(input?.existingState)) {
    reasons.push("INVALID_EXISTING_STATE");
  }

  if (input?.existingState === "PENDING") reasons.push("DUPLICATE_PENDING_INTENT");
  if (input?.existingState === "ACCEPTED") reasons.push("DUPLICATE_ACCEPTED_INTENT");
  if (input?.existingState === "FILLED") reasons.push("DUPLICATE_FILLED_INTENT");

  if (input?.existingState === "CANCELLED" || input?.existingState === "REJECTED") {
    if (input.freshSignalConfirmed !== true) reasons.push("RETRY_REQUIRES_FRESH_SIGNAL");
    if (input.explicitRetryAllowed !== true) reasons.push("RETRY_NOT_EXPLICITLY_ALLOWED");
  }

  if (input?.existingState === "NONE") {
    if (input.freshSignalConfirmed !== true) reasons.push("FRESH_SIGNAL_REQUIRED");
  }

  return {
    version: "EXECUTION_IDEMPOTENCY_GATE_V1",
    decision: reasons.length === 0 ? "ALLOW" : "BLOCK",
    idempotencyKey: key,
    reasonCodes: reasons.length === 0 ? ["IDEMPOTENCY_GATE_PASSED"] : reasons,
    failClosed: true,
  };
}
