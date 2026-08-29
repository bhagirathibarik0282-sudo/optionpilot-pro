import type { StrategyReadiness } from "./strategy-readiness-engine.js";

export type RiskReadinessStatus = "READY_FOR_RESEARCH" | "NOT_READY";

export interface RiskReadinessInput {
  strategyStatus: StrategyReadiness;
  entry: number | null;
  stop: number | null;
  quantity: number | null;
  capital: number | null;
  maxAllowedLossPct: number | null;
}

export interface RiskReadinessResult {
  status: RiskReadinessStatus;
  reason: string;
  riskPerUnit: number | null;
  maxLossAmount: number | null;
  maxLossPct: number | null;
  semantics: "RESEARCH_RISK_VALIDATION_ONLY";
  ruleVersion: "RISK_READINESS_ENGINE_V1";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

function finitePositive(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Research-only risk validation. It never chooses a risk limit, position size,
 * trade, contract or order. The maximum acceptable loss percentage is supplied
 * by the caller and is never invented by this module.
 */
export function assessRiskReadiness(input: RiskReadinessInput): RiskReadinessResult {
  const base = {
    semantics: "RESEARCH_RISK_VALIDATION_ONLY" as const,
    ruleVersion: "RISK_READINESS_ENGINE_V1" as const,
    affectsVerdict: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
  };

  const unavailable = (reason: string): RiskReadinessResult => ({
    ...base,
    status: "NOT_READY",
    reason,
    riskPerUnit: null,
    maxLossAmount: null,
    maxLossPct: null,
  });

  if (input.strategyStatus !== "READY_FOR_RESEARCH") return unavailable("STRATEGY_NOT_READY");
  if (!finitePositive(input.entry)) return unavailable("ENTRY_INVALID");
  if (!finitePositive(input.stop)) return unavailable("STOP_INVALID");
  if (input.stop >= input.entry) return unavailable("STOP_NOT_BELOW_ENTRY_FOR_LONG_PREMIUM");
  if (!Number.isInteger(input.quantity) || !finitePositive(input.quantity)) return unavailable("QUANTITY_INVALID");
  if (!finitePositive(input.capital)) return unavailable("CAPITAL_INVALID");
  if (!finitePositive(input.maxAllowedLossPct) || input.maxAllowedLossPct > 100) return unavailable("RISK_LIMIT_INVALID");

  const riskPerUnit = input.entry - input.stop;
  const maxLossAmount = riskPerUnit * input.quantity;
  const maxLossPct = (maxLossAmount / input.capital) * 100;

  if (![riskPerUnit, maxLossAmount, maxLossPct].every(Number.isFinite)) return unavailable("RISK_CALCULATION_INVALID");

  if (maxLossPct > input.maxAllowedLossPct) {
    return {
      ...base,
      status: "NOT_READY",
      reason: "CALLER_RISK_LIMIT_EXCEEDED",
      riskPerUnit,
      maxLossAmount,
      maxLossPct,
    };
  }

  return {
    ...base,
    status: "READY_FOR_RESEARCH",
    reason: "CALLER_RISK_LIMIT_SATISFIED",
    riskPerUnit,
    maxLossAmount,
    maxLossPct,
  };
}
