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

/**
 * Authority-preserving adapter for the existing execution candidate selector.
 *
 * Important semantics:
 * - It never re-selects or re-ranks a contract.
 * - CE/PE is retained only as option contract side; it is never interpreted as
 *   BUYER/SELLER business role.
 * - A packet exists only when EXECUTION_CANDIDATE_SELECTOR_V2 returns SELECT.
 * - This preparation layer has no Telegram or execution authority by itself.
 */
export function buildCanonicalBuyerCandidatePacket(
  input: ExecutionCandidateInput,
): CanonicalBuyerCandidatePacketResult {
  const selector = selectExecutionCandidate(input);

  if (selector.decision !== "SELECT" || !selector.candidateKey || selector.premiumLtp == null) {
    return {
      decision: "BLOCK",
      packet: null,
      selector,
      reasonCodes: selector.reasonCodes,
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
