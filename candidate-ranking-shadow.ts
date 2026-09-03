import { selectExecutionCandidate, type ExecutionCandidateInput } from "./execution-candidate-selector.js";
import type { HistoricalCandidateQualitySnapshot } from "./h1-candidate-quality.js";

export interface CandidateRankingEvidence {
  temporalConfidencePct?: number | null;
  premiumEfficiencyPct?: number | null;
  liquidityQualityPct?: number | null;
  crossDteAgreementPct?: number | null;
  historicalQuality?: HistoricalCandidateQualitySnapshot | null;
}

export interface CandidateRankingInput {
  candidate: ExecutionCandidateInput;
  evidence: CandidateRankingEvidence;
}

export interface RankedCandidate {
  candidateKey: string | null;
  eligible: boolean;
  score: number;
  rank: number | null;
  reasons: string[];
}

export interface CandidateRankingSnapshot {
  ranked: RankedCandidate[];
  bestCandidateKey: string | null;
  ruleVersion: "CANDIDATE_RANKING_SHADOW_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

function clampPct(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null;
}

function historicalQualityPct(quality: HistoricalCandidateQualitySnapshot | null | undefined): number | null {
  if (!quality) return null;
  if (quality.grade === "A_PLUS") return 100;
  if (quality.grade === "A") return 80;
  if (quality.grade === "B") return 60;
  if (quality.grade === "REJECT") return 0;
  return null;
}

function weightedScore(evidence: CandidateRankingEvidence): { score: number; reasons: string[] } {
  const components = [
    ["TEMPORAL", clampPct(evidence.temporalConfidencePct), 0.30],
    ["PREMIUM", clampPct(evidence.premiumEfficiencyPct), 0.25],
    ["LIQUIDITY", clampPct(evidence.liquidityQualityPct), 0.20],
    ["CROSS_DTE", clampPct(evidence.crossDteAgreementPct), 0.15],
    ["HISTORICAL", historicalQualityPct(evidence.historicalQuality), 0.10],
  ] as const;

  let weighted = 0;
  let weightUsed = 0;
  const reasons: string[] = [];

  for (const [name, value, weight] of components) {
    if (value == null) {
      reasons.push(`${name}_EVIDENCE_UNAVAILABLE`);
      continue;
    }
    weighted += value * weight;
    weightUsed += weight;
  }

  if (weightUsed < 0.50) reasons.push("RANKING_EVIDENCE_BELOW_50_PERCENT_WEIGHT");
  const score = weightUsed === 0 ? 0 : Math.round((weighted / weightUsed) * 10) / 10;
  return { score, reasons };
}

/**
 * Research-only ranking layer. It never overrides execution-candidate-selector.
 * A candidate blocked by the hard selector is always ineligible here.
 */
export function rankCandidateSet(inputs: CandidateRankingInput[]): CandidateRankingSnapshot {
  const ranked = inputs.map<RankedCandidate>((input) => {
    const hard = selectExecutionCandidate(input.candidate);
    if (hard.decision !== "SELECT" || !hard.candidateKey) {
      return {
        candidateKey: null,
        eligible: false,
        score: 0,
        rank: null,
        reasons: ["HARD_SELECTOR_BLOCK", ...hard.reasonCodes],
      };
    }

    const { score, reasons } = weightedScore(input.evidence);
    const historicalRejected = input.evidence.historicalQuality?.grade === "REJECT";
    const insufficientEvidence = reasons.includes("RANKING_EVIDENCE_BELOW_50_PERCENT_WEIGHT");

    return {
      candidateKey: hard.candidateKey,
      eligible: !historicalRejected && !insufficientEvidence,
      score: historicalRejected || insufficientEvidence ? 0 : score,
      rank: null,
      reasons: [
        "HARD_SELECTOR_PASS",
        ...(historicalRejected ? ["HISTORICAL_QUALITY_REJECT"] : []),
        ...reasons,
      ],
    };
  });

  const eligible = ranked
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.eligible)
    .sort((a, b) => b.item.score - a.item.score || String(a.item.candidateKey).localeCompare(String(b.item.candidateKey)));

  eligible.forEach(({ item }, i) => {
    item.rank = i + 1;
  });

  return {
    ranked,
    bestCandidateKey: eligible[0]?.item.candidateKey ?? null,
    ruleVersion: "CANDIDATE_RANKING_SHADOW_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
