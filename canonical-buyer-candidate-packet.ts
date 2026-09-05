import {
  selectExecutionCandidate,
  type ExecutionCandidateInput,
  type ExecutionCandidateResult,
} from "./execution-candidate-selector.js";

export interface CanonicalBuyerCandidatePacket {
  version: "CANONICAL_BUYER_CANDIDATE_PACKET_V1";
  role: "OPTION_BUYER";
  status: "READY";
  candidateKey: string;
  sourceAuthority: "EXECUTION_CANDIDATE_SELECTOR_V2";
  symbol: ExecutionCandidateInput["symbol"];
  optionSide: ExecutionCandidateInput["side"];
  strike: number;
  expiryDate: string;
  dte: number;
  moneyness: ExecutionCandidateInput["moneyness"];
  premiumLtp: number;
  dteBucket: ExecutionCandidateResult["dteBucket"];
  selectorReasonCodes: readonly string[];
  failClosed: true;
  affectsTelegram: false;
  affectsExecution: false;
  aiMayOverride: false;
}

export interface CanonicalBuyerCandidatePacketResult {
  decision: "READY" | "BLOCK";
  packet: CanonicalBuyerCandidatePacket | null;
  selector: ExecutionCandidateResult;
  reasonCodes: readonly string[];
  failClosed: true;
}

function expectedCandidateKey(input: ExecutionCandidateInput): string {
  return `${input.symbol}:${input.side}:${input.strike}:${input.expiryDate}:DTE${input.dte}:${input.moneyness}`;
}

/**
 * Builds the canonical packet from an already-evaluated authoritative selector
 * result. This is the preferred path when a live producer has already called
 * EXECUTION_CANDIDATE_SELECTOR_V2, because it prevents selector re-execution.
 */
export function buildCanonicalBuyerCandidatePacketFromSelection(
  input: ExecutionCandidateInput,
  selector: ExecutionCandidateResult,
): CanonicalBuyerCandidatePacketResult {
  const identityMatches = selector.candidateKey === expectedCandidateKey(input);
  if (
    selector.version !== "EXECUTION_CANDIDATE_SELECTOR_V2" ||
    selector.decision !== "SELECT" ||
    !selector.candidateKey ||
    selector.premiumLtp == null ||
    !identityMatches
  ) {
    return {
      decision: "BLOCK",
      packet: null,
      selector,
      reasonCodes: identityMatches ? selector.reasonCodes : [...selector.reasonCodes, "CANONICAL_SELECTOR_IDENTITY_MISMATCH"],
      failClosed: true,
    };
  }

  const packet: CanonicalBuyerCandidatePacket = {
    version: "CANONICAL_BUYER_CANDIDATE_PACKET_V1",
    role: "OPTION_BUYER",
    status: "READY",
    candidateKey: selector.candidateKey,
    sourceAuthority: "EXECUTION_CANDIDATE_SELECTOR_V2",
    symbol: input.symbol,
    optionSide: input.side,
    strike: input.strike,
    expiryDate: input.expiryDate,
    dte: input.dte,
    moneyness: input.moneyness,
    premiumLtp: selector.premiumLtp,
    dteBucket: selector.dteBucket,
    selectorReasonCodes: selector.reasonCodes,
    failClosed: true,
    affectsTelegram: false,
    affectsExecution: false,
    aiMayOverride: false,
  };

  return {
    decision: "READY",
    packet,
    selector,
    reasonCodes: selector.reasonCodes,
    failClosed: true,
  };
}

/**
 * Authority-preserving adapter for callers that do not already hold the hard
 * selector result. It calls the hard selector once, then delegates to the
 * pre-evaluated path above.
 */
export function buildCanonicalBuyerCandidatePacket(
  input: ExecutionCandidateInput,
): CanonicalBuyerCandidatePacketResult {
  const selector = selectExecutionCandidate(input);
  return buildCanonicalBuyerCandidatePacketFromSelection(input, selector);
}
