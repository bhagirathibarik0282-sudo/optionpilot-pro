import {
  selectExecutionCandidate,
  type ExecutionCandidateInput,
  type ExecutionCandidateResult,
} from "./execution-candidate-selector.js";
import type { H1ForwardCandidateDecisionInput } from "./h1-forward-candidate-decision-binding.js";

export type H1LiveSelectorInputProvenance = "LIVE_RUNTIME_EXACT";

export interface H1LiveSelectorProducerInput {
  provenance: H1LiveSelectorInputProvenance;
  candidates: unknown[];
}

export interface H1LiveSelectorEvaluation {
  candidate: ExecutionCandidateInput;
  selector: ExecutionCandidateResult;
}

export interface H1LiveSelectorProducerResult {
  version: "H1_LIVE_SELECTOR_DECISION_PRODUCER_V1";
  sourceClass: "LIVE_DETERMINISTIC_EXACT" | "UNAVAILABLE";
  eligibleForLiveH1Marking: boolean;
  decisions: H1ForwardCandidateDecisionInput[];
  evaluations: H1LiveSelectorEvaluation[];
  rejected: { index: number; reason: string }[];
  failClosed: true;
  semantics: "EXACT_EXECUTION_SELECTOR_INPUTS_ONLY_NO_SHADOW_OR_INFERENCE";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function strictBoolean(value: unknown): value is boolean {
  return value === true || value === false;
}

function normalizeCandidate(raw: unknown): ExecutionCandidateInput | null {
  if (!isRecord(raw)) return null;
  const symbol = raw.symbol;
  const side = raw.side;
  const moneyness = raw.moneyness;
  const strike = raw.strike;
  const dte = raw.dte;
  const premiumLtp = raw.premiumLtp;

  if (symbol !== "NIFTY" && symbol !== "SENSEX" && symbol !== "BANKNIFTY") return null;
  if (side !== "CE" && side !== "PE") return null;
  if (moneyness !== "ATM" && moneyness !== "ITM1") return null;
  if (typeof strike !== "number" || !Number.isFinite(strike) || strike <= 0) return null;
  if (!Number.isInteger(dte) || (dte as number) < 0) return null;
  if (!validDateOnly(raw.expiryDate)) return null;
  if (typeof premiumLtp !== "number" || !Number.isFinite(premiumLtp) || premiumLtp <= 0) return null;

  const requiredBooleanKeys = [
    "capitalFit",
    "liquidityOk",
    "spreadOk",
    "premiumResponseConfirmed",
    "deltaGammaResponseConfirmed",
    "thetaIvBurdenAcceptable",
    "multiExpiryConflictAbsent",
    "currentOrNearExpiryUsable",
    "higherDteUsable",
  ] as const;
  if (!requiredBooleanKeys.every((key) => strictBoolean(raw[key]))) return null;
  if (raw.fallbackDteApproved !== undefined && !strictBoolean(raw.fallbackDteApproved)) return null;

  return {
    symbol,
    side,
    strike,
    expiryDate: raw.expiryDate,
    dte: dte as number,
    moneyness,
    premiumLtp,
    capitalFit: raw.capitalFit as boolean,
    liquidityOk: raw.liquidityOk as boolean,
    spreadOk: raw.spreadOk as boolean,
    premiumResponseConfirmed: raw.premiumResponseConfirmed as boolean,
    deltaGammaResponseConfirmed: raw.deltaGammaResponseConfirmed as boolean,
    thetaIvBurdenAcceptable: raw.thetaIvBurdenAcceptable as boolean,
    multiExpiryConflictAbsent: raw.multiExpiryConflictAbsent as boolean,
    currentOrNearExpiryUsable: raw.currentOrNearExpiryUsable as boolean,
    higherDteUsable: raw.higherDteUsable as boolean,
    fallbackDteApproved: raw.fallbackDteApproved as boolean | undefined,
  };
}

function gatesOf(input: ExecutionCandidateInput): Record<string, boolean | null> {
  return {
    capitalFit: input.capitalFit,
    liquidityOk: input.liquidityOk,
    spreadOk: input.spreadOk,
    premiumResponseConfirmed: input.premiumResponseConfirmed,
    deltaGammaResponseConfirmed: input.deltaGammaResponseConfirmed,
    thetaIvBurdenAcceptable: input.thetaIvBurdenAcceptable,
    multiExpiryConflictAbsent: input.multiExpiryConflictAbsent,
    currentOrNearExpiryUsable: input.currentOrNearExpiryUsable,
    higherDteUsable: input.higherDteUsable,
    fallbackDteApproved: input.fallbackDteApproved ?? null,
  };
}

export function produceH1LiveSelectorDecisions(input: unknown): H1LiveSelectorProducerResult {
  const base = {
    version: "H1_LIVE_SELECTOR_DECISION_PRODUCER_V1" as const,
    failClosed: true as const,
    semantics: "EXACT_EXECUTION_SELECTOR_INPUTS_ONLY_NO_SHADOW_OR_INFERENCE" as const,
  };

  if (!isRecord(input) || input.provenance !== "LIVE_RUNTIME_EXACT" || !Array.isArray(input.candidates)) {
    return {
      ...base,
      sourceClass: "UNAVAILABLE",
      eligibleForLiveH1Marking: false,
      decisions: [],
      evaluations: [],
      rejected: [{ index: -1, reason: "LIVE_RUNTIME_EXACT_INPUT_REQUIRED" }],
    };
  }

  const decisions: H1ForwardCandidateDecisionInput[] = [];
  const evaluations: H1LiveSelectorEvaluation[] = [];
  const rejected: { index: number; reason: string }[] = [];

  input.candidates.forEach((raw, index) => {
    const candidate = normalizeCandidate(raw);
    if (!candidate) {
      rejected.push({ index, reason: "INVALID_OR_INCOMPLETE_EXECUTION_CANDIDATE_INPUT" });
      return;
    }
    const selector = selectExecutionCandidate(candidate);
    evaluations.push({ candidate, selector });
    decisions.push({
      symbol: candidate.symbol,
      expiry: candidate.expiryDate,
      strike: candidate.strike,
      side: candidate.side,
      decision: selector.decision,
      reasonCodes: [...selector.reasonCodes],
      gates: gatesOf(candidate),
      selectorVersion: selector.version,
    });
  });

  return {
    ...base,
    sourceClass: "LIVE_DETERMINISTIC_EXACT",
    eligibleForLiveH1Marking: true,
    decisions,
    evaluations,
    rejected,
  };
}
