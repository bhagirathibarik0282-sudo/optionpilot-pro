import { runResearchEngineChain, type ResearchEngineChainInput } from "./research-engine-chain.js";

export interface ResearchEngineChainHttpResult {
  ok: boolean;
  mode: "RESEARCH_MODE";
  productionImpact: "NONE";
  result?: ReturnType<typeof runResearchEngineChain>;
  reason?: "INVALID_RESEARCH_ENGINE_CHAIN_INPUT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validProbability(value: Record<string, unknown>): boolean {
  if (value.status !== "READY" && value.status !== "DATA_UNAVAILABLE") return false;
  if (value.semantics !== "TARGET_BEFORE_STOP_OBSERVED_ONLY" || value.ruleVersion !== "PROBABILITY_ENGINE_V1") return false;
  const integers = [value.sampleCount, value.resolvedSamples, value.wins, value.losses, value.censored];
  if (!integers.every((n) => Number.isInteger(n) && (n as number) >= 0)) return false;
  if ((value.wins as number) + (value.losses as number) !== value.resolvedSamples) return false;
  if ((value.resolvedSamples as number) + (value.censored as number) !== value.sampleCount) return false;
  if (value.status === "READY") {
    if (!isFiniteNumber(value.winRatePct) || value.winRatePct < 0 || value.winRatePct > 100) return false;
    if ((value.resolvedSamples as number) <= 0) return false;
    const expected = ((value.wins as number) / (value.resolvedSamples as number)) * 100;
    if (Math.abs(value.winRatePct - expected) > 1e-9) return false;
  } else if (value.winRatePct !== null) return false;
  return typeof value.reason === "string" && value.reason.length > 0;
}

function validMarketRegime(value: Record<string, unknown>): boolean {
  const regimes = new Set(["TRENDING_UP", "TRENDING_DOWN", "RANGE", "HIGH_VOLATILITY", "TRANSITION", "UNKNOWN"]);
  if (!regimes.has(String(value.regime))) return false;
  if (typeof value.ready !== "boolean") return false;
  if (value.semantics !== "VALIDATED_EVIDENCE_ONLY" || value.ruleVersion !== "MARKET_REGIME_ENGINE_V1") return false;
  if (value.affectsVerdict !== false || value.affectsTelegram !== false || value.affectsExecution !== false) return false;
  if ((value.regime === "UNKNOWN" && value.ready !== false) || (value.regime !== "UNKNOWN" && value.ready !== true)) return false;
  return typeof value.reason === "string" && value.reason.length > 0;
}

function validRisk(value: Record<string, unknown>): boolean {
  const nullableFinite = (v: unknown) => v === null || isFiniteNumber(v);
  if (!nullableFinite(value.entry) || !nullableFinite(value.stop) || !nullableFinite(value.capital) || !nullableFinite(value.maxAllowedPlannedStopLossPct)) return false;
  if (!(value.quantity === null || (Number.isInteger(value.quantity) && (value.quantity as number) > 0))) return false;
  return true;
}

/**
 * Runtime adapter only. It accepts an explicit caller-supplied research payload,
 * performs no DB writes and invents no missing inputs. Invalid/missing payloads
 * fail closed instead of being defaulted into a research-ready state.
 */
export function evaluateResearchEngineChainHttp(body: unknown): ResearchEngineChainHttpResult {
  if (!isRecord(body) || !isRecord(body.probability) || !isRecord(body.marketRegime) || !isRecord(body.risk)) {
    return { ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "INVALID_RESEARCH_ENGINE_CHAIN_INPUT" };
  }

  const requiredBooleans = [
    body.contractIdentityReady,
    body.dataQualityReady,
    body.evidenceFresh,
    body.signalIdentityReady,
  ];
  if (!requiredBooleans.every((value) => typeof value === "boolean")) {
    return { ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "INVALID_RESEARCH_ENGINE_CHAIN_INPUT" };
  }

  if (!validProbability(body.probability) || !validMarketRegime(body.marketRegime) || !validRisk(body.risk)) {
    return { ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "INVALID_RESEARCH_ENGINE_CHAIN_INPUT" };
  }

  try {
    const result = runResearchEngineChain(body as unknown as ResearchEngineChainInput);
    return { ok: true, mode: "RESEARCH_MODE", productionImpact: "NONE", result };
  } catch {
    return { ok: false, mode: "RESEARCH_MODE", productionImpact: "NONE", reason: "INVALID_RESEARCH_ENGINE_CHAIN_INPUT" };
  }
}

export function researchEngineChainRuntimeStatus() {
  return {
    ok: true,
    mode: "RESEARCH_MODE" as const,
    productionImpact: "NONE" as const,
    mounted: true,
    semantics: "RESEARCH_SHADOW_CHAIN_ONLY" as const,
    affectsVerdict: false as const,
    affectsTelegram: false as const,
    affectsExecution: false as const,
    ruleVersion: "RESEARCH_ENGINE_CHAIN_V1" as const,
  };
}
