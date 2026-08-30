import { validateShadowContractIdentity, type ShadowContractIdentity } from "./live-shadow-market-binding.js";

export type PositionTruthDecision = "MATCH" | "RECONCILE" | "CRITICAL_UNMANAGED_POSITION" | "HALT";

export interface PositionTruthReconcilerInput {
  executionMode: "SHADOW" | "LIVE";
  contract: ShadowContractIdentity;
  identityConsistent: boolean;
  stateFresh: boolean;
  authoritativeFilledQty: number;
  authoritativeExitedQty: number;
  ledgerRemainingQty: number;
  evidenceRemainingQty: number;
}

export interface PositionTruthReconcilerResult {
  version: "POSITION_TRUTH_RECONCILER_V1";
  decision: PositionTruthDecision;
  authoritativeOpenQty: number | null;
  protectQty: number;
  newEntriesAllowed: boolean;
  blindExitAllowed: false;
  brokerOrderAllowed: false;
  reasonCodes: string[];
  failClosed: true;
}

function validQty(v: number): boolean {
  return Number.isInteger(v) && v >= 0;
}

export function reconcilePositionTruth(input: PositionTruthReconcilerInput): PositionTruthReconcilerResult {
  const reasons: string[] = [];

  if (input?.executionMode !== "SHADOW" && input?.executionMode !== "LIVE") reasons.push("INVALID_EXECUTION_MODE");
  if (!validateShadowContractIdentity(input?.contract)) reasons.push("INVALID_CONTRACT_IDENTITY");
  if (input?.identityConsistent !== true) reasons.push("CONTRACT_IDENTITY_MISMATCH");
  if (input?.stateFresh !== true) reasons.push("AUTHORITATIVE_POSITION_STATE_STALE");
  if (!validQty(input?.authoritativeFilledQty) || !validQty(input?.authoritativeExitedQty) || !validQty(input?.ledgerRemainingQty) || !validQty(input?.evidenceRemainingQty)) {
    reasons.push("INVALID_POSITION_QUANTITY_STATE");
  }
  if (validQty(input?.authoritativeFilledQty) && validQty(input?.authoritativeExitedQty) && input.authoritativeExitedQty > input.authoritativeFilledQty) {
    reasons.push("EXITED_QTY_EXCEEDS_FILLED_QTY");
  }

  if (reasons.length > 0) {
    const fallbackProtectQty = validQty(input?.authoritativeFilledQty) && validQty(input?.authoritativeExitedQty) && input.authoritativeExitedQty <= input.authoritativeFilledQty
      ? input.authoritativeFilledQty - input.authoritativeExitedQty
      : 0;
    return {
      version: "POSITION_TRUTH_RECONCILER_V1",
      decision: "HALT",
      authoritativeOpenQty: null,
      protectQty: fallbackProtectQty,
      newEntriesAllowed: false,
      blindExitAllowed: false,
      brokerOrderAllowed: false,
      reasonCodes: reasons,
      failClosed: true,
    };
  }

  const authoritativeOpenQty = input.authoritativeFilledQty - input.authoritativeExitedQty;

  if (authoritativeOpenQty > 0 && input.ledgerRemainingQty === 0 && input.evidenceRemainingQty === 0) {
    return {
      version: "POSITION_TRUTH_RECONCILER_V1",
      decision: "CRITICAL_UNMANAGED_POSITION",
      authoritativeOpenQty,
      protectQty: authoritativeOpenQty,
      newEntriesAllowed: false,
      blindExitAllowed: false,
      brokerOrderAllowed: false,
      reasonCodes: ["AUTHORITATIVE_OPEN_POSITION_MISSING_IN_INTERNAL_STATE"],
      failClosed: true,
    };
  }

  if (input.ledgerRemainingQty !== authoritativeOpenQty || input.evidenceRemainingQty !== authoritativeOpenQty) {
    return {
      version: "POSITION_TRUTH_RECONCILER_V1",
      decision: "RECONCILE",
      authoritativeOpenQty,
      protectQty: authoritativeOpenQty,
      newEntriesAllowed: false,
      blindExitAllowed: false,
      brokerOrderAllowed: false,
      reasonCodes: authoritativeOpenQty === 0
        ? ["INTERNAL_POSITION_EXISTS_AFTER_AUTHORITATIVE_ZERO"]
        : ["POSITION_QUANTITY_MISMATCH_RECONCILIATION_REQUIRED"],
      failClosed: true,
    };
  }

  return {
    version: "POSITION_TRUTH_RECONCILER_V1",
    decision: "MATCH",
    authoritativeOpenQty,
    protectQty: authoritativeOpenQty,
    newEntriesAllowed: authoritativeOpenQty === 0,
    blindExitAllowed: false,
    brokerOrderAllowed: false,
    reasonCodes: [authoritativeOpenQty === 0 ? "POSITION_TRUTH_MATCHED_FLAT" : "POSITION_TRUTH_MATCHED_OPEN"],
    failClosed: true,
  };
}
