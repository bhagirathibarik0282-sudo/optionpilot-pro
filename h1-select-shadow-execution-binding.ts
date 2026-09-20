import { authorizeBrokerExecution, type BrokerExecutionAuthorizationInput, type BrokerExecutionAuthorizationResult } from "./broker-execution-authorization.js";
import type { CanonicalBusinessConsumerResult } from "./canonical-business-consumer.js";
import type { H1ForwardCandidateDecisionInput } from "./h1-forward-candidate-decision-binding.js";

export interface H1SelectShadowExecutionBindingInput {
  selectorDecision: H1ForwardCandidateDecisionInput;
  canonicalConsumer: CanonicalBusinessConsumerResult | null;
  authorizationEvidence: Omit<BrokerExecutionAuthorizationInput, "mode">;
}

export interface H1SelectShadowExecutionBindingResult {
  version: "H1_SELECT_SHADOW_EXECUTION_BINDING_V1";
  decisionId: string | null;
  candidateKey: string | null;
  selectorDecision: "SELECT" | "BLOCK";
  authorization: BrokerExecutionAuthorizationResult;
  failClosed: true;
  shadowOnly: true;
  placesOrder: false;
}

function canonicalIdentityMatches(
  selector: H1ForwardCandidateDecisionInput,
  consumer: CanonicalBusinessConsumerResult,
): boolean {
  const candidate = consumer.buyerCandidate;
  return Boolean(
    candidate
    && consumer.candidateKey === candidate.candidateKey
    && consumer.decisionId === candidate.decisionId
    && selector.symbol.toUpperCase() === candidate.symbol
    && selector.expiry === candidate.expiryDate
    && selector.strike === candidate.strike
    && selector.side === candidate.optionSide
  );
}

export function bindH1SelectToShadowExecution(
  input: H1SelectShadowExecutionBindingInput,
): H1SelectShadowExecutionBindingResult {
  const selectorDecision = input?.selectorDecision?.decision === "SELECT" ? "SELECT" : "BLOCK";
  const consumer = input?.canonicalConsumer;
  const candidateKey = consumer?.candidateKey ?? null;
  const decisionId = consumer?.decisionId ?? null;
  const boundaryReasons: string[] = [];
  if (selectorDecision !== "SELECT") boundaryReasons.push("SELECTOR_DECISION_NOT_SELECT");
  if (!consumer?.buyerCandidate || !candidateKey) boundaryReasons.push("CANONICAL_BUSINESS_CANDIDATE_REQUIRED");
  if (consumer?.buyerCandidate && (!decisionId || decisionId !== consumer.buyerCandidate.decisionId)) {
    boundaryReasons.push("CANONICAL_DECISION_IDENTITY_REQUIRED");
  }
  if (selectorDecision === "SELECT" && input.selectorDecision.selectorVersion !== "EXECUTION_CANDIDATE_SELECTOR_V2") {
    boundaryReasons.push("AUTHORITATIVE_SELECTOR_VERSION_REQUIRED");
  }
  if (consumer && !canonicalIdentityMatches(input.selectorDecision, consumer)) {
    boundaryReasons.push("CANONICAL_SELECTOR_IDENTITY_MISMATCH");
  }

  const evidence = input?.authorizationEvidence;
  const authorization = boundaryReasons.length === 0 && evidence
    ? authorizeBrokerExecution({ mode: "SHADOW", ...evidence })
    : {
        version: "BROKER_EXECUTION_AUTHORIZATION_V1" as const,
        decision: "BLOCK" as const,
        reasonCodes: boundaryReasons.length > 0 ? [...new Set(boundaryReasons)] : ["SHADOW_EXECUTION_EVIDENCE_REQUIRED"],
        failClosed: true as const,
        shadowOnly: true as const,
        placesOrder: false as const,
      };

  return {
    version: "H1_SELECT_SHADOW_EXECUTION_BINDING_V1",
    decisionId,
    candidateKey,
    selectorDecision,
    authorization,
    failClosed: true,
    shadowOnly: true,
    placesOrder: false,
  };
}
