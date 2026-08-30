export type KillSwitchDecision = "RUN" | "HALT_NEW_ENTRIES" | "EMERGENCY_EXIT_INTENT";

export interface KillSwitchInput {
  manualKillSwitch: boolean;
  dailyHardLossBreached: boolean;
  marketDataHealthy: boolean;
  brokerConnectionHealthy: boolean;
  orderStateKnown: boolean;
  riskStateHealthy: boolean;
  hasOpenPosition: boolean;
}

export interface KillSwitchResult {
  version: "EXECUTION_KILL_SWITCH_V1";
  decision: KillSwitchDecision;
  newEntriesAllowed: boolean;
  emergencyExitRequired: boolean;
  reasonCodes: string[];
  failClosed: true;
  brokerOrderPlaced: false;
}

export function evaluateExecutionKillSwitch(input: KillSwitchInput): KillSwitchResult {
  const reasons: string[] = [];

  if (input?.manualKillSwitch !== false && input?.manualKillSwitch !== true) reasons.push("INVALID_MANUAL_KILL_STATE");
  if (input?.dailyHardLossBreached !== false && input?.dailyHardLossBreached !== true) reasons.push("INVALID_DAILY_LOSS_STATE");
  if (input?.marketDataHealthy !== false && input?.marketDataHealthy !== true) reasons.push("INVALID_MARKET_DATA_STATE");
  if (input?.brokerConnectionHealthy !== false && input?.brokerConnectionHealthy !== true) reasons.push("INVALID_BROKER_CONNECTION_STATE");
  if (input?.orderStateKnown !== false && input?.orderStateKnown !== true) reasons.push("INVALID_ORDER_STATE");
  if (input?.riskStateHealthy !== false && input?.riskStateHealthy !== true) reasons.push("INVALID_RISK_STATE");
  if (input?.hasOpenPosition !== false && input?.hasOpenPosition !== true) reasons.push("INVALID_POSITION_STATE");

  if (reasons.length === 0) {
    if (input.manualKillSwitch) reasons.push("MANUAL_KILL_SWITCH_ACTIVE");
    if (input.dailyHardLossBreached) reasons.push("DAILY_HARD_LOSS_BREACHED");
    if (!input.marketDataHealthy) reasons.push("MARKET_DATA_UNHEALTHY");
    if (!input.brokerConnectionHealthy) reasons.push("BROKER_CONNECTION_UNHEALTHY");
    if (!input.orderStateKnown) reasons.push("ORDER_STATE_UNKNOWN");
    if (!input.riskStateHealthy) reasons.push("RISK_STATE_UNHEALTHY");
  }

  const triggered = reasons.length > 0;
  const emergencyExitRequired = triggered && input?.hasOpenPosition === true;

  return {
    version: "EXECUTION_KILL_SWITCH_V1",
    decision: !triggered ? "RUN" : emergencyExitRequired ? "EMERGENCY_EXIT_INTENT" : "HALT_NEW_ENTRIES",
    newEntriesAllowed: !triggered,
    emergencyExitRequired,
    reasonCodes: !triggered ? ["KILL_SWITCH_CLEAR"] : reasons,
    failClosed: true,
    brokerOrderPlaced: false,
  };
}
