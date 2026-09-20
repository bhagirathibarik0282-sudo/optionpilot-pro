import { authorizeBrokerExecution, type BrokerExecutionAuthorizationInput, type BrokerExecutionAuthorizationResult } from "./broker-execution-authorization.js";
import { bindCanonicalExecutionLevelPlan } from "./canonical-execution-level-plan-binding.js";
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
  const baseAuthorization: BrokerExecutionAuthorizationResult = boundaryReasons.length === 0 && evidence
    ? authorizeBrokerExecution({ mode: "SHADOW", ...evidence })
    : {
        version: "BROKER_EXECUTION_AUTHORIZATION_V1",
        decision: "BLOCK",
        reasonCodes: boundaryReasons.length > 0 ? [...new Set(boundaryReasons)] : ["SHADOW_EXECUTION_EVIDENCE_REQUIRED"],
        failClosed: true,
        shadowOnly: true,
        placesOrder: false,
      };

  // PR #583: the live selector -> shadow path must remain fail-closed until a
  // canonical, candidate-bound entry + invalidation evidence producer exists.
  // This makes the level boundary part of the already-active shadow binding
  // instead of leaving it as a disconnected helper.
  const levelBoundary = boundaryReasons.length === 0
    ? bindCanonicalExecutionLevelPlan({ consumer: consumer ?? null })
    : null;

  const authorization: BrokerExecutionAuthorizationResult = levelBoundary?.decision === "BLOCK"
    ? {
        version: "BROKER_EXECUTION_AUTHORIZATION_V1",
        decision: "BLOCK",
        reasonCodes: [...new Set([
          ...(baseAuthorization.decision === "BLOCK" ? baseAuthorization.reasonCodes : []),
          ...levelBoundary.blockers,
        ])],
        failClosed: true,
        shadowOnly: true,
        placesOrder: false,
      }
    : baseAuthorization;

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
