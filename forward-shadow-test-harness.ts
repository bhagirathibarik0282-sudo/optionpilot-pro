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
}

export interface ForwardShadowDecision {
  status: ForwardShadowStatus;
  shadowOnly: true;
  brokerOrderAllowed: false;
  recordDecision: boolean;
  reason: string;
}

export function evaluateForwardShadowTest(input: ForwardShadowInput): ForwardShadowDecision {
  if (!input.marketOpen) return { status: "BLOCKED", shadowOnly: true, brokerOrderAllowed: false, recordDecision: false, reason: "MARKET_CLOSED" };
  if (!input.liveDataFresh) return { status: "BLOCKED", shadowOnly: true, brokerOrderAllowed: false, recordDecision: true, reason: "LIVE_DATA_NOT_FRESH" };
  if (!input.brokerSessionHealthy) return { status: "BLOCKED", shadowOnly: true, brokerOrderAllowed: false, recordDecision: true, reason: "BROKER_SESSION_UNHEALTHY" };
  if (!input.candidateReady) return { status: "BLOCKED", shadowOnly: true, brokerOrderAllowed: false, recordDecision: true, reason: "NO_VALID_CANDIDATE" };
  if (!input.quantumAugmentationReady) return { status: "BLOCKED", shadowOnly: true, brokerOrderAllowed: false, recordDecision: true, reason: "QUANTUM_AUGMENTATION_UNAVAILABLE" };
  if (!input.hardRiskGatePassed) return { status: "BLOCKED", shadowOnly: true, brokerOrderAllowed: false, recordDecision: true, reason: "HARD_RISK_GATE_BLOCK" };
  if (!input.liquidityGatePassed) return { status: "BLOCKED", shadowOnly: true, brokerOrderAllowed: false, recordDecision: true, reason: "LIQUIDITY_GATE_BLOCK" };
  if (!input.idempotencyPassed) return { status: "BLOCKED", shadowOnly: true, brokerOrderAllowed: false, recordDecision: true, reason: "IDEMPOTENCY_BLOCK" };
  if (!input.killSwitchClear) return { status: "BLOCKED", shadowOnly: true, brokerOrderAllowed: false, recordDecision: true, reason: "KILL_SWITCH_ACTIVE" };

  return { status: "READY", shadowOnly: true, brokerOrderAllowed: false, recordDecision: true, reason: "FORWARD_SHADOW_SIGNAL_READY" };
}
