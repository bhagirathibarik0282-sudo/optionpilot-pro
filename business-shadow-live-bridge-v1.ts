import type { CanonicalOneRoofMarketSnapshot } from "./canonical-one-roof-market-snapshot.js";
import { rankCandidateSet, type CandidateRankingInput, type CandidateRankingSnapshot } from "./candidate-ranking-shadow.js";
import { createBusinessForwardJournal, type BusinessForwardJournalRecord } from "./business-forward-journal-v1.js";

export const BUSINESS_SHADOW_LIVE_BRIDGE_V1 = "BUSINESS_SHADOW_LIVE_BRIDGE_V1" as const;

export interface ShadowMetricEnvelope {
  version: string;
  ready: boolean;
  semantics: "RESEARCH_SHADOW_ONLY";
  affectsVerdict: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

export interface BusinessShadowLiveBridgeInput {
  snapshot: CanonicalOneRoofMarketSnapshot;
  decisionId: string;
  selectedCandidateKey: string | null;
  candidateRankingInputs: CandidateRankingInput[];
  metrics: ShadowMetricEnvelope[];
  marketState?: string | null;
  sellerStressState?: string | null;
  opportunityStage?: string | null;
}

export interface BusinessShadowLiveBridgeResult {
  version: typeof BUSINESS_SHADOW_LIVE_BRIDGE_V1;
  ready: boolean;
  snapshotId: string | null;
  symbol: CanonicalOneRoofMarketSnapshot["symbol"] | null;
  ranking: CandidateRankingSnapshot | null;
  journal: BusinessForwardJournalRecord | null;
  blockers: string[];
  rawPayloadHeuristicsUsed: false;
  affectsVerdict: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

const SAFETY = {
  rawPayloadHeuristicsUsed: false as const,
  affectsVerdict: false as const,
  affectsStars: false as const,
  affectsCandidateAuthority: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  createsOrders: false as const,
  failClosed: true as const,
};

function fail(blockers: string[]): BusinessShadowLiveBridgeResult {
  return {
    version: BUSINESS_SHADOW_LIVE_BRIDGE_V1,
    ready: false,
    snapshotId: null,
    symbol: null,
    ranking: null,
    journal: null,
    blockers: [...new Set(blockers)],
    ...SAFETY,
  };
}

function metricSafe(metric: ShadowMetricEnvelope): boolean {
  return Boolean(
    metric
    && typeof metric.version === "string"
    && metric.version.length > 0
    && metric.ready === true
    && metric.semantics === "RESEARCH_SHADOW_ONLY"
    && metric.affectsVerdict === false
    && metric.affectsStars === false
    && metric.affectsCandidateAuthority === false
    && metric.affectsTelegram === false
    && metric.affectsExecution === false
    && metric.createsOrders === false
    && metric.failClosed === true,
  );
}

/**
 * Authority-preserving live bridge for research only.
 * It never reads opaque component payloads, never computes live facts from them,
 * and never creates a second candidate authority.
 */
export function buildBusinessShadowLiveBridge(input: BusinessShadowLiveBridgeInput): BusinessShadowLiveBridgeResult {
  const snapshot = input?.snapshot;
  if (
    !snapshot
    || snapshot.version !== "CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2"
    || snapshot.readyForStrictFiltering !== true
    || snapshot.qualityState !== "VERIFIED"
    || snapshot.newEntryGate !== "ALLOW_NEW_ENTRIES"
    || snapshot.failClosed !== true
    || snapshot.createsOrders !== false
    || snapshot.affectsExecution !== false
    || snapshot.aiMayOverride !== false
  ) {
    return fail(["CANONICAL_VERIFIED_SNAPSHOT_REQUIRED"]);
  }

  if (!input.decisionId?.trim()) return fail(["DECISION_ID_REQUIRED"]);
  if (!Array.isArray(input.candidateRankingInputs) || input.candidateRankingInputs.length === 0) {
    return fail(["CANDIDATE_RANKING_INPUTS_REQUIRED"]);
  }
  if (!Array.isArray(input.metrics) || input.metrics.length === 0) return fail(["SHADOW_METRICS_REQUIRED"]);
  if (input.metrics.some((metric) => !metricSafe(metric))) return fail(["SHADOW_METRIC_AUTHORITY_BOUNDARY_INVALID"]);

  const ranking = rankCandidateSet(input.candidateRankingInputs);
  if (
    ranking.semantics !== "RESEARCH_SHADOW_ONLY"
    || ranking.affectsVerdict !== false
    || ranking.affectsTelegram !== false
    || ranking.affectsExecution !== false
    || ranking.createsOrders !== false
    || ranking.aiMayOverride !== false
  ) {
    return fail(["SHADOW_RANKING_AUTHORITY_BOUNDARY_INVALID"]);
  }

  const eligibleCandidates = input.candidateRankingInputs.flatMap((row) => {
    const ranked = ranking.ranked.find((r) => r.candidateKey && r.candidateKey === [
      row.candidate.symbol,
      row.candidate.side,
      row.candidate.strike,
      row.candidate.expiryDate,
      `DTE${row.candidate.dte}`,
      row.candidate.moneyness,
    ].join(":"));
    if (!ranked?.candidateKey) return [];
    return [{
      candidateKey: ranked.candidateKey,
      symbol: row.candidate.symbol,
      optionSide: row.candidate.side,
      strike: row.candidate.strike,
      expiryDate: row.candidate.expiryDate,
      dte: row.candidate.dte,
      premiumLtp: row.candidate.premiumLtp,
    }];
  });

  if (eligibleCandidates.length === 0) return fail(["NO_HARD_SELECTOR_ELIGIBLE_CANDIDATES"]);
  if (input.selectedCandidateKey != null && !eligibleCandidates.some((c) => c.candidateKey === input.selectedCandidateKey)) {
    return fail(["SELECTED_CANDIDATE_NOT_IN_HARD_ELIGIBLE_SET"]);
  }

  const journalResult = createBusinessForwardJournal({
    decisionId: input.decisionId,
    snapshotId: snapshot.snapshotId,
    observedAtMs: snapshot.asOfMs,
    selectedCandidateKey: input.selectedCandidateKey,
    eligibleCandidates,
    marketState: input.marketState ?? null,
    sellerStressState: input.sellerStressState ?? null,
    opportunityStage: input.opportunityStage ?? null,
  });

  if (!journalResult.ready || !journalResult.record) {
    return fail(["FORWARD_JOURNAL_NOT_READY", ...journalResult.blockers]);
  }

  return {
    version: BUSINESS_SHADOW_LIVE_BRIDGE_V1,
    ready: true,
    snapshotId: snapshot.snapshotId,
    symbol: snapshot.symbol,
    ranking,
    journal: journalResult.record,
    blockers: [],
    ...SAFETY,
  };
}
