import type { ShadowContractIdentity } from "./live-shadow-market-binding.js";
import { validateShadowContractIdentity } from "./live-shadow-market-binding.js";

export type ExitReason = "EMERGENCY" | "HARD_SL" | "STRUCTURE_FAILURE" | "RUNNER_TSL" | "NORMAL";
export type ExitIntentState = "NONE" | "REQUESTED" | "PENDING" | "PARTIAL" | "COMPLETE" | "CANCELLED" | "REJECTED" | "HALT";
export type ExitIntentDecision = "CREATE_INTENT" | "REUSE_INTENT" | "ESCALATE_EXISTING" | "RECONCILE" | "COMPLETE" | "BLOCK";

export interface ExitIntentInput {
  tradeId: string;
  contract: ShadowContractIdentity;
  existingState: ExitIntentState;
  existingReason: ExitReason | null;
  requestedReason: ExitReason;
  authoritativeOpenQty: number;
  confirmedExitQty: number;
  stateFresh: boolean;
  identityConsistent: boolean;
}

export interface ExitIntentResult {
  version: "EXIT_INTENT_STATE_V1";
  decision: ExitIntentDecision;
  nextState: ExitIntentState;
  exitIdempotencyKey: string | null;
  effectiveReason: ExitReason | null;
  requestedExitQty: number;
  residualQty: number | null;
  duplicateBlocked: boolean;
  newEntriesAllowed: false;
  placesOrder: false;
  shadowOnly: true;
  failClosed: true;
  reasonCodes: string[];
}

const priority: Record<ExitReason, number> = {
  NORMAL: 1,
  RUNNER_TSL: 2,
  STRUCTURE_FAILURE: 3,
  HARD_SL: 4,
  EMERGENCY: 5,
};

function nonEmpty(v: string): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function validQty(v: number): boolean {
  return Number.isInteger(v) && v >= 0;
}

export function buildExitIdempotencyKey(tradeId: string, contract: ShadowContractIdentity): string | null {
  if (!nonEmpty(tradeId) || !validateShadowContractIdentity(contract)) return null;
  const token = contract.instrumentToken == null ? "NO_TOKEN" : String(contract.instrumentToken).trim();
  return ["EXIT", tradeId.trim(), contract.index, contract.optionType, String(contract.strike), contract.expiry, token].join(":");
}

export function evaluateExitIntentState(input: ExitIntentInput): ExitIntentResult {
  const key = buildExitIdempotencyKey(input?.tradeId, input?.contract);
  const reasons: string[] = [];

  if (!key) reasons.push("INVALID_EXIT_IDENTITY");
  if (!validQty(input?.authoritativeOpenQty) || !validQty(input?.confirmedExitQty)) reasons.push("INVALID_EXIT_QUANTITY_STATE");
  if (input?.stateFresh !== true) reasons.push("EXIT_STATE_STALE");
  if (input?.identityConsistent !== true) reasons.push("EXIT_CONTRACT_IDENTITY_MISMATCH");
  if (!["NONE","REQUESTED","PENDING","PARTIAL","COMPLETE","CANCELLED","REJECTED","HALT"].includes(input?.existingState)) reasons.push("INVALID_EXIT_STATE");
  if (!["EMERGENCY","HARD_SL","STRUCTURE_FAILURE","RUNNER_TSL","NORMAL"].includes(input?.requestedReason)) reasons.push("INVALID_EXIT_REASON");
  if (input?.existingReason !== null && !["EMERGENCY","HARD_SL","STRUCTURE_FAILURE","RUNNER_TSL","NORMAL"].includes(input?.existingReason as string)) reasons.push("INVALID_EXISTING_EXIT_REASON");

  const base = (
    decision: ExitIntentDecision,
    nextState: ExitIntentState,
    reasonCodes: string[],
    effectiveReason: ExitReason | null,
    requestedExitQty = 0,
    residualQty: number | null = null,
    duplicateBlocked = false,
  ): ExitIntentResult => ({
    version: "EXIT_INTENT_STATE_V1",
    decision,
    nextState,
    exitIdempotencyKey: key,
    effectiveReason,
    requestedExitQty,
    residualQty,
    duplicateBlocked,
    newEntriesAllowed: false,
    placesOrder: false,
    shadowOnly: true,
    failClosed: true,
    reasonCodes,
  });

  if (reasons.length) return base("BLOCK", "HALT", reasons, input?.existingReason ?? null, 0, null, true);

  // authoritativeOpenQty is already the current remaining open position from the
  // position-truth layer. confirmedExitQty is audit context and must not be
  // subtracted again, otherwise partial exits are double-counted.
  const residualQty = input.authoritativeOpenQty;

  if (residualQty === 0) {
    return base("COMPLETE", "COMPLETE", ["NO_OPEN_POSITION_EXIT_COMPLETE"], input.existingReason ?? input.requestedReason, 0, 0);
  }

  if (input.existingState === "COMPLETE") {
    return base("BLOCK", "HALT", ["EXIT_ALREADY_COMPLETE_BUT_OPEN_QTY_REMAINS"], input.existingReason, 0, residualQty, true);
  }

  if (input.existingState === "HALT") {
    return base("BLOCK", "HALT", ["EXIT_STATE_ALREADY_HALTED"], input.existingReason, 0, residualQty, true);
  }

  if (input.existingState === "CANCELLED" || input.existingState === "REJECTED") {
    return base("RECONCILE", input.existingState, ["TERMINAL_EXIT_STATE_REQUIRES_FILL_RECONCILIATION"], input.existingReason ?? input.requestedReason, 0, residualQty);
  }

  if (input.existingState === "NONE") {
    return base("CREATE_INTENT", "REQUESTED", ["EXIT_INTENT_CREATED"], input.requestedReason, residualQty, residualQty);
  }

  const currentReason = input.existingReason ?? input.requestedReason;
  const requestedHigher = priority[input.requestedReason] > priority[currentReason];

  if (requestedHigher) {
    return base("ESCALATE_EXISTING", input.existingState, ["EXIT_INTENT_PRIORITY_ESCALATED"], input.requestedReason, 0, residualQty);
  }

  if (input.existingState === "PARTIAL") {
    return base("REUSE_INTENT", "PARTIAL", ["PARTIAL_EXIT_RESIDUAL_REUSED"], currentReason, residualQty, residualQty, true);
  }

  if (input.existingState === "REQUESTED" || input.existingState === "PENDING") {
    return base("REUSE_INTENT", input.existingState, ["DUPLICATE_EXIT_INTENT_BLOCKED_REUSE_EXISTING"], currentReason, 0, residualQty, true);
  }

  return base("BLOCK", "HALT", ["UNHANDLED_EXIT_STATE"], currentReason, 0, residualQty, true);
}
