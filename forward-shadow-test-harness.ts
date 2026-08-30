export type ForwardShadowStatus = "READY" | "BLOCKED";

export interface ForwardShadowInput {
  marketOpen: boolean;
  liveDataFresh: boolean;
  brokerSessionHealthy: boolean;
  candidateReady: boolean;
  quantumAugmentationReady: boolean;
  hardRiskGatePassed: boolean;
  liquidityGatePassed: boolean;
  idempotencyPassed: boolean;
  killSwitchClear: boolean;
  runnerLogicRequired?: boolean;
  indexSpecificRunnerReady?: boolean;
}

export interface ForwardShadowDecision {
  status: ForwardShadowStatus;
  shadowOnly: true;
  brokerOrderAllowed: false;
  recordDecision: boolean;
  reason: string;
  runnerPathVerified: boolean;
}

export function evaluateForwardShadowTest(input: ForwardShadowInput): ForwardShadowDecision {
  const blocked = (reason: string, recordDecision: boolean, runnerPathVerified = false): ForwardShadowDecision => ({
    status: "BLOCKED",
    shadowOnly: true,
    brokerOrderAllowed: false,
    recordDecision,
    reason,
    runnerPathVerified,
  });

  if (!input.marketOpen) return blocked("MARKET_CLOSED", false);
  if (!input.liveDataFresh) return blocked("LIVE_DATA_NOT_FRESH", true);
  if (!input.brokerSessionHealthy) return blocked("BROKER_SESSION_UNHEALTHY", true);
  if (!input.candidateReady) return blocked("NO_VALID_CANDIDATE", true);
  if (!input.quantumAugmentationReady) return blocked("QUANTUM_AUGMENTATION_UNAVAILABLE", true);
  if (!input.hardRiskGatePassed) return blocked("HARD_RISK_GATE_BLOCK", true);
  if (!input.liquidityGatePassed) return blocked("LIQUIDITY_GATE_BLOCK", true);
  if (!input.idempotencyPassed) return blocked("IDEMPOTENCY_BLOCK", true);
  if (!input.killSwitchClear) return blocked("KILL_SWITCH_ACTIVE", true);

  const runnerLogicRequired = input.runnerLogicRequired ?? false;
  const indexSpecificRunnerReady = input.indexSpecificRunnerReady ?? false;
  if (runnerLogicRequired && !indexSpecificRunnerReady) return blocked("INDEX_SPECIFIC_RUNNER_NOT_READY", true);

  return {
    status: "READY",
    shadowOnly: true,
    brokerOrderAllowed: false,
    recordDecision: true,
    reason: runnerLogicRequired ? "FORWARD_SHADOW_SIGNAL_AND_RUNNER_READY" : "FORWARD_SHADOW_SIGNAL_READY",
    runnerPathVerified: !runnerLogicRequired || indexSpecificRunnerReady,
  };
}
