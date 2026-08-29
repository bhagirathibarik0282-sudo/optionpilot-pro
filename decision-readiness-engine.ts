import type { HistoricalSupportStatus } from "./probability-engine.js";
import type { MarketRegime } from "./market-regime-engine.js";
import type { StrategyReadiness } from "./strategy-readiness-engine.js";
import type { RiskReadinessStatus } from "./risk-readiness-engine.js";

export type DecisionReadinessStatus = "READY_FOR_RESEARCH_REVIEW" | "NOT_READY";

export interface DecisionReadinessInput {
  probabilityStatus: HistoricalSupportStatus;
  regime: MarketRegime;
  strategyStatus: StrategyReadiness;
  riskStatus: RiskReadinessStatus;
  evidenceFresh: boolean;
  signalIdentityReady: boolean;
}

export interface DecisionReadinessResult {
  status: DecisionReadinessStatus;
  reason: string;
  semantics: "RESEARCH_DECISION_READINESS_ONLY";
  ruleVersion: "DECISION_READINESS_ENGINE_V1";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

/**
 * Research-only final prerequisite gate. This module does not emit BUY/SELL,
 * choose CE/PE, select a contract, set entry/SL/targets, size a position, or
 * place/send any order/message. It only confirms that upstream research
 * prerequisites are simultaneously present and internally stable.
 */
export function assessDecisionReadiness(input: DecisionReadinessInput): DecisionReadinessResult {
  const base = {
    semantics: "RESEARCH_DECISION_READINESS_ONLY" as const,
    ruleVersion: "DECISION_READINESS_ENGINE_V1" as const,
    affectsVerdict: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
  };

  if (!input.evidenceFresh) return { ...base, status: "NOT_READY", reason: "EVIDENCE_NOT_FRESH" };
  if (!input.signalIdentityReady) return { ...base, status: "NOT_READY", reason: "SIGNAL_IDENTITY_NOT_READY" };
  if (input.probabilityStatus !== "READY") return { ...base, status: "NOT_READY", reason: "HISTORICAL_SUPPORT_UNAVAILABLE" };
  if (input.regime === "UNKNOWN" || input.regime === "TRANSITION") {
    return { ...base, status: "NOT_READY", reason: "REGIME_NOT_STABLE" };
  }
  if (input.strategyStatus !== "READY_FOR_RESEARCH") {
    return { ...base, status: "NOT_READY", reason: "STRATEGY_NOT_READY" };
  }
  if (input.riskStatus !== "READY_FOR_RESEARCH") {
    return { ...base, status: "NOT_READY", reason: "RISK_NOT_READY" };
  }

  return { ...base, status: "READY_FOR_RESEARCH_REVIEW", reason: "ALL_RESEARCH_PREREQUISITES_PRESENT" };
}
