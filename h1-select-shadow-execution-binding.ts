import { authorizeBrokerExecution, type BrokerExecutionAuthorizationInput, type BrokerExecutionAuthorizationResult } from "./broker-execution-authorization.js";
import type { H1ForwardCandidateDecisionInput } from "./h1-forward-candidate-decision-binding.js";

export interface H1SelectShadowExecutionBindingInput {
  selectorDecision: H1ForwardCandidateDecisionInput;
  authorizationEvidence: Omit<BrokerExecutionAuthorizationInput, "mode">;
}

export interface H1SelectShadowExecutionBindingResult {
  version: "H1_SELECT_SHADOW_EXECUTION_BINDING_V1";
  candidateKey: string | null;
  selectorDecision: "SELECT" | "BLOCK";
  authorization: BrokerExecutionAuthorizationResult;
  failClosed: true;
  shadowOnly: true;
  placesOrder: false;
}

function candidateKeyOf(input: H1ForwardCandidateDecisionInput): string | null {
  if (!input?.symbol || !input.expiry || !Number.isFinite(input.strike) || input.strike <= 0 || (input.side !== "CE" && input.side !== "PE")) return null;
  return `${input.symbol.toUpperCase()}|${input.expiry}|${input.strike}|${input.side}`;
}

export function bindH1SelectToShadowExecution(
  input: H1SelectShadowExecutionBindingInput,
): H1SelectShadowExecutionBindingResult {
  const candidateKey = candidateKeyOf(input?.selectorDecision);
  const selectorDecision = input?.selectorDecision?.decision === "SELECT" ? "SELECT" : "BLOCK";

  const evidence = input?.authorizationEvidence;
  const authorization = selectorDecision === "SELECT" && candidateKey && evidence
    ? authorizeBrokerExecution({ mode: "SHADOW", ...evidence })
    : {
        version: "BROKER_EXECUTION_AUTHORIZATION_V1" as const,
        decision: "BLOCK" as const,
        reasonCodes: [selectorDecision !== "SELECT" ? "SELECTOR_DECISION_NOT_SELECT" : "INVALID_SELECTOR_IDENTITY"],
        failClosed: true as const,
        shadowOnly: true as const,
        placesOrder: false as const,
      };

  return {
    version: "H1_SELECT_SHADOW_EXECUTION_BINDING_V1",
    candidateKey,
    selectorDecision,
    authorization,
    failClosed: true,
    shadowOnly: true,
    placesOrder: false,
  };
}
