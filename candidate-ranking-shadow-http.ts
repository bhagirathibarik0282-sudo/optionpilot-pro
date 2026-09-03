import { rankCandidateSet, type CandidateRankingInput } from "./candidate-ranking-shadow.js";

export interface CandidateRankingShadowHttpResult {
  ok: boolean;
  mode: "READ_ONLY_CANDIDATE_RANKING_SHADOW_V1";
  productionImpact: "NONE";
  candidateCount: number;
  result: ReturnType<typeof rankCandidateSet> | null;
  reason?: string;
  safety: {
    readOnly: true;
    databaseWrites: false;
    telegramWrites: false;
    executionAuthority: false;
    createsOrders: false;
  };
}

function safety(): CandidateRankingShadowHttpResult["safety"] {
  return {
    readOnly: true,
    databaseWrites: false,
    telegramWrites: false,
    executionAuthority: false,
    createsOrders: false,
  };
}

export function evaluateCandidateRankingShadowHttp(body: unknown): CandidateRankingShadowHttpResult {
  if (!body || typeof body !== "object" || !Array.isArray((body as { candidates?: unknown }).candidates)) {
    return {
      ok: false,
      mode: "READ_ONLY_CANDIDATE_RANKING_SHADOW_V1",
      productionImpact: "NONE",
      candidateCount: 0,
      result: null,
      reason: "CANDIDATE_ARRAY_REQUIRED",
      safety: safety(),
    };
  }

  const candidates = (body as { candidates: unknown[] }).candidates;
  if (candidates.length < 1 || candidates.length > 50) {
    return {
      ok: false,
      mode: "READ_ONLY_CANDIDATE_RANKING_SHADOW_V1",
      productionImpact: "NONE",
      candidateCount: candidates.length,
      result: null,
      reason: "CANDIDATE_COUNT_OUT_OF_RANGE_1_50",
      safety: safety(),
    };
  }

  try {
    const result = rankCandidateSet(candidates as CandidateRankingInput[]);
    return {
      ok: true,
      mode: "READ_ONLY_CANDIDATE_RANKING_SHADOW_V1",
      productionImpact: "NONE",
      candidateCount: candidates.length,
      result,
      safety: safety(),
    };
  } catch {
    return {
      ok: false,
      mode: "READ_ONLY_CANDIDATE_RANKING_SHADOW_V1",
      productionImpact: "NONE",
      candidateCount: candidates.length,
      result: null,
      reason: "CANDIDATE_RANKING_EVALUATION_FAILED",
      safety: safety(),
    };
  }
}

export function candidateRankingShadowRuntimeStatus() {
  return {
    ok: true,
    mode: "READ_ONLY_CANDIDATE_RANKING_SHADOW_V1" as const,
    productionImpact: "NONE" as const,
    ready: true,
    sourceBinding: "CALLER_SUPPLIED_CANDIDATE_POOL" as const,
    maxCandidates: 50,
    safety: safety(),
  };
}
