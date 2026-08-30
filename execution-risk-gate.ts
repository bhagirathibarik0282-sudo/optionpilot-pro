// Live-execution safety foundation.
// This module has no broker/network side effects. It only decides whether an order may proceed.

export type ExecutionRiskDecision = "ALLOW" | "BLOCK";

export interface ExecutionCapitalPolicy {
  maxCapitalPerTrade: number;
}

export interface ExecutionCapitalInput {
  symbol: string;
  plannedCapital: number;
  policy: ExecutionCapitalPolicy;
}

export interface ExecutionCapitalGateResult {
  version: "EXECUTION_CAPITAL_GATE_V1";
  decision: ExecutionRiskDecision;
  reasonCodes: string[];
  symbol: string | null;
  plannedCapital: number | null;
  maxCapitalPerTrade: number | null;
  failClosed: true;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function evaluateExecutionCapitalGate(
  input: ExecutionCapitalInput,
): ExecutionCapitalGateResult {
  const reasonCodes: string[] = [];
  const symbol = typeof input?.symbol === "string" && input.symbol.trim().length > 0
    ? input.symbol.trim().toUpperCase()
    : null;
  const plannedCapital = finitePositive(input?.plannedCapital) ? input.plannedCapital : null;
  const maxCapitalPerTrade = finitePositive(input?.policy?.maxCapitalPerTrade)
    ? input.policy.maxCapitalPerTrade
    : null;

  if (!symbol) reasonCodes.push("INVALID_SYMBOL");
  if (plannedCapital == null) reasonCodes.push("INVALID_PLANNED_CAPITAL");
  if (maxCapitalPerTrade == null) reasonCodes.push("INVALID_MAX_CAPITAL_PER_TRADE");

  if (reasonCodes.length === 0 && plannedCapital! > maxCapitalPerTrade!) {
    reasonCodes.push("CAPITAL_PER_TRADE_LIMIT_EXCEEDED");
  }

  return {
    version: "EXECUTION_CAPITAL_GATE_V1",
    decision: reasonCodes.length === 0 ? "ALLOW" : "BLOCK",
    reasonCodes: reasonCodes.length === 0 ? ["CAPITAL_GATE_PASSED"] : reasonCodes,
    symbol,
    plannedCapital,
    maxCapitalPerTrade,
    failClosed: true,
  };
}
