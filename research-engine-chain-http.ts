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
