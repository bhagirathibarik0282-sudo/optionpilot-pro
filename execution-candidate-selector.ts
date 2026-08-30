// Execution candidate selection gate.
// This module never places broker orders. It promotes only a validated option contract candidate.

export type ExecutionCandidateDecision = "SELECT" | "BLOCK";
export type ExecutionCandidateSide = "CE" | "PE";
export type ExecutionCandidateMoneyness = "ATM" | "ITM1";

export interface ExecutionCandidateInput {
  symbol: "NIFTY" | "SENSEX" | "BANKNIFTY";
  side: ExecutionCandidateSide;
  strike: number;
  expiryDate: string;
  dte: number;
  moneyness: ExecutionCandidateMoneyness;
  liquidityOk: boolean;
  spreadOk: boolean;
  premiumResponseConfirmed: boolean;
  deltaGammaResponseConfirmed: boolean;
  thetaIvBurdenAcceptable: boolean;
  multiExpiryConflictAbsent: boolean;
  currentOrNearExpiryUsable: boolean;
  higherDteUsable: boolean;
}

export interface ExecutionCandidateResult {
  version: "EXECUTION_CANDIDATE_SELECTOR_V1";
  decision: ExecutionCandidateDecision;
  reasonCodes: string[];
  candidateKey: string | null;
  failClosed: true;
}

function validPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validContract(input: ExecutionCandidateInput): boolean {
  return validPositive(input?.strike) &&
    Number.isInteger(input?.dte) && input.dte >= 0 &&
    typeof input?.expiryDate === "string" && input.expiryDate.trim().length > 0;
}

export function selectExecutionCandidate(input: ExecutionCandidateInput): ExecutionCandidateResult {
  const reasonCodes: string[] = [];

  if (!validContract(input)) reasonCodes.push("INVALID_CONTRACT_IDENTITY");
  if (!(input?.moneyness === "ATM" || input?.moneyness === "ITM1")) reasonCodes.push("UNSUPPORTED_MONEYNESS");
  if (input?.liquidityOk !== true) reasonCodes.push("LIQUIDITY_GATE_FAILED");
  if (input?.spreadOk !== true) reasonCodes.push("SPREAD_GATE_FAILED");
  if (input?.premiumResponseConfirmed !== true) reasonCodes.push("PREMIUM_RESPONSE_NOT_CONFIRMED");
  if (input?.deltaGammaResponseConfirmed !== true) reasonCodes.push("DELTA_GAMMA_RESPONSE_NOT_CONFIRMED");
  if (input?.thetaIvBurdenAcceptable !== true) reasonCodes.push("THETA_IV_BURDEN_UNACCEPTABLE");
  if (input?.multiExpiryConflictAbsent !== true) reasonCodes.push("MULTI_EXPIRY_CONFLICT_PRESENT");

  if (input?.symbol === "NIFTY" || input?.symbol === "SENSEX") {
    if (input.currentOrNearExpiryUsable !== true) reasonCodes.push("NEAR_EXPIRY_NOT_USABLE");
  } else if (input?.symbol === "BANKNIFTY") {
    if (input.higherDteUsable !== true) reasonCodes.push("HIGHER_DTE_NOT_USABLE");
  } else {
    reasonCodes.push("UNSUPPORTED_SYMBOL");
  }

  const decision: ExecutionCandidateDecision = reasonCodes.length === 0 ? "SELECT" : "BLOCK";
  const candidateKey = decision === "SELECT"
    ? `${input.symbol}:${input.side}:${input.strike}:${input.expiryDate}:DTE${input.dte}:${input.moneyness}`
    : null;

  return {
    version: "EXECUTION_CANDIDATE_SELECTOR_V1",
    decision,
    reasonCodes: decision === "SELECT" ? ["EXECUTION_CANDIDATE_SELECTED"] : reasonCodes,
    candidateKey,
    failClosed: true,
  };
}
