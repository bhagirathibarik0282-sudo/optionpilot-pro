import type { HistoricalProbabilityResult } from "./probability-engine.js";
import type { MarketRegimeResult } from "./market-regime-engine.js";
import { assessStrategyReadiness, type StrategyReadinessResult } from "./strategy-readiness-engine.js";
import { assessRiskReadiness, type RiskReadinessInput, type RiskReadinessResult } from "./risk-readiness-engine.js";
import { assessDecisionReadiness, type DecisionReadinessResult } from "./decision-readiness-engine.js";

export interface ResearchEngineChainInput {
  probability: HistoricalProbabilityResult;
  marketRegime: MarketRegimeResult;
  contractIdentityReady: boolean;
  dataQualityReady: boolean;
  evidenceFresh: boolean;
  signalIdentityReady: boolean;
  risk: Omit<RiskReadinessInput, "strategyStatus">;
}

export interface ResearchEngineChainResult {
  probability: HistoricalProbabilityResult;
  marketRegime: MarketRegimeResult;
  strategy: StrategyReadinessResult;
  risk: RiskReadinessResult;
  decision: DecisionReadinessResult;
  semantics: "RESEARCH_SHADOW_CHAIN_ONLY";
  ruleVersion: "RESEARCH_ENGINE_CHAIN_V1";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

/** Shadow/research-only composition of Phase 9 engines. */
export function runResearchEngineChain(input: ResearchEngineChainInput): ResearchEngineChainResult {
  const strategy = assessStrategyReadiness({
    regime: input.marketRegime.regime,
    probabilityStatus: input.probability.status,
    contractIdentityReady: input.contractIdentityReady,
    dataQualityReady: input.dataQualityReady,
  });

  const risk = assessRiskReadiness({ ...input.risk, strategyStatus: strategy.status });

  const decision = assessDecisionReadiness({
    probabilityStatus: input.probability.status,
    regime: input.marketRegime.regime,
    strategyStatus: strategy.status,
    riskStatus: risk.status,
    evidenceFresh: input.evidenceFresh,
    signalIdentityReady: input.signalIdentityReady,
  });

  return {
    probability: input.probability,
    marketRegime: input.marketRegime,
    strategy,
    risk,
    decision,
    semantics: "RESEARCH_SHADOW_CHAIN_ONLY",
    ruleVersion: "RESEARCH_ENGINE_CHAIN_V1",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}
