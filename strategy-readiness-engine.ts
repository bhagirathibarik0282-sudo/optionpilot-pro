import type { MarketRegime } from "./market-regime-engine.js";
import type { HistoricalSupportStatus } from "./probability-engine.js";

export type StrategyReadiness = "READY_FOR_RESEARCH" | "NOT_READY";

export interface StrategyReadinessInput {
  regime: MarketRegime;
  probabilityStatus: HistoricalSupportStatus;
  contractIdentityReady: boolean;
  dataQualityReady: boolean;
}

export interface StrategyReadinessResult {
  status: StrategyReadiness;
  reason: string;
  semantics: "RESEARCH_READINESS_ONLY";
  ruleVersion: "STRATEGY_READINESS_ENGINE_V1";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

/**
 * Research-only readiness gate for the future Strategy Engine.
 * It does not select a trade structure, direction, contract, or order.
 */
export function assessStrategyReadiness(input: StrategyReadinessInput): StrategyReadinessResult {
  const base = {
    semantics: "RESEARCH_READINESS_ONLY" as const,
    ruleVersion: "STRATEGY_READINESS_ENGINE_V1" as const,
    affectsVerdict: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
  };

  if (!input.dataQualityReady) return { ...base, status: "NOT_READY", reason: "DATA_QUALITY_NOT_READY" };
  if (!input.contractIdentityReady) return { ...base, status: "NOT_READY", reason: "CONTRACT_IDENTITY_NOT_READY" };
  if (input.probabilityStatus !== "READY") return { ...base, status: "NOT_READY", reason: "HISTORICAL_SUPPORT_UNAVAILABLE" };
  if (input.regime === "UNKNOWN" || input.regime === "TRANSITION") return { ...base, status: "NOT_READY", reason: "REGIME_NOT_STABLE" };

  return { ...base, status: "READY_FOR_RESEARCH", reason: "RESEARCH_PREREQUISITES_PRESENT" };
}
