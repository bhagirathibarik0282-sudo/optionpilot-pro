// Final fail-closed authorization boundary before any broker execution adapter.
// V1 is intentionally SHADOW-ONLY: it can authorize simulation, never a live broker call.

export type BrokerExecutionAuthorizationDecision = "AUTHORIZE_SIMULATION" | "BLOCK";

export interface BrokerExecutionAuthorizationInput {
  mode: "SHADOW" | "LIVE";
  orderBuildDecision: "BUILD" | "BLOCK";
  executionRiskDecision: "ALLOW" | "BLOCK";
  killSwitchDecision: "ALLOW" | "BLOCK";
  idempotencyDecision: "ALLOW" | "BLOCK";
  exactContractBound: boolean;
  evidencePersistenceConfirmed: boolean;
  brokerSessionReady: boolean;
}

export interface BrokerExecutionAuthorizationResult {
  version: "BROKER_EXECUTION_AUTHORIZATION_V1";
  decision: BrokerExecutionAuthorizationDecision;
  reasonCodes: string[];
  failClosed: true;
  shadowOnly: true;
  placesOrder: false;
}

export function authorizeBrokerExecution(
  input: BrokerExecutionAuthorizationInput,
): BrokerExecutionAuthorizationResult {
  const reasons: string[] = [];

  if (!(input?.mode === "SHADOW" || input?.mode === "LIVE")) reasons.push("INVALID_EXECUTION_MODE");
  if (input?.mode === "LIVE") reasons.push("LIVE_EXECUTION_NOT_ENABLED_IN_V1");
  if (input?.orderBuildDecision !== "BUILD") reasons.push("ORDER_INTENT_NOT_BUILT");
  if (input?.executionRiskDecision !== "ALLOW") reasons.push("EXECUTION_RISK_GATE_NOT_PASSED");
  if (input?.killSwitchDecision !== "ALLOW") reasons.push("KILL_SWITCH_NOT_CLEAR");
  if (input?.idempotencyDecision !== "ALLOW") reasons.push("IDEMPOTENCY_GATE_NOT_PASSED");
  if (input?.exactContractBound !== true) reasons.push("EXACT_CONTRACT_NOT_BOUND");
  if (input?.evidencePersistenceConfirmed !== true) reasons.push("EVIDENCE_PERSISTENCE_NOT_CONFIRMED");
  if (input?.brokerSessionReady !== true) reasons.push("BROKER_SESSION_NOT_READY");

  if (reasons.length > 0) {
    return {
      version: "BROKER_EXECUTION_AUTHORIZATION_V1",
      decision: "BLOCK",
      reasonCodes: reasons,
      failClosed: true,
      shadowOnly: true,
      placesOrder: false,
    };
  }

  return {
    version: "BROKER_EXECUTION_AUTHORIZATION_V1",
    decision: "AUTHORIZE_SIMULATION",
    reasonCodes: ["SHADOW_EXECUTION_AUTHORIZED"],
    failClosed: true,
    shadowOnly: true,
    placesOrder: false,
  };
}
