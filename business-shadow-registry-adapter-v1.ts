import type { CanonicalOneRoofMarketSnapshot } from "./canonical-one-roof-market-snapshot.js";
import type { CandidateRankingEvidence } from "./candidate-ranking-shadow.js";
import { collectH1LiveSelectorDecisions } from "./h1-live-selector-registry.js";
import {
  buildBusinessShadowLiveBridge,
  type BusinessShadowLiveBridgeResult,
  type ShadowMetricEnvelope,
} from "./business-shadow-live-bridge-v1.js";

export const BUSINESS_SHADOW_REGISTRY_ADAPTER_V1 = "BUSINESS_SHADOW_REGISTRY_ADAPTER_V1" as const;

export interface BusinessShadowRegistryAdapterInput {
  snapshot: CanonicalOneRoofMarketSnapshot;
  nowIso: string;
  metrics: ShadowMetricEnvelope[];
  evidenceByCandidateKey: Record<string, CandidateRankingEvidence>;
  /** Optional sole-authority candidate key supplied by upstream. Never inferred here. */
  selectedCandidateKey?: string | null;
  marketState?: string | null;
  sellerStressState?: string | null;
  opportunityStage?: string | null;
  maxAgeMs?: number;
}

export interface BusinessShadowRegistryAdapterResult {
  version: typeof BUSINESS_SHADOW_REGISTRY_ADAPTER_V1;
  ready: boolean;
  registryAssembledCount: number;
  registryBlockedCount: number;
  matchedSymbolCandidateCount: number;
  selectedCandidateKeySource: "UPSTREAM_ONLY" | "NONE";
  bridge: BusinessShadowLiveBridgeResult | null;
  blockers: string[];
  readOnly: true;
  shadowOnly: true;
  affectsVerdict: false;
  affectsStars: false;
  affectsCandidateAuthority: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  failClosed: true;
}

const SAFETY = {
  readOnly: true as const,
  shadowOnly: true as const,
  affectsVerdict: false as const,
  affectsStars: false as const,
  affectsCandidateAuthority: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  createsOrders: false as const,
  failClosed: true as const,
};

function fail(blockers: string[], assembled = 0, blocked = 0): BusinessShadowRegistryAdapterResult {
  return {
    version: BUSINESS_SHADOW_REGISTRY_ADAPTER_V1,
    ready: false,
    registryAssembledCount: assembled,
    registryBlockedCount: blocked,
    matchedSymbolCandidateCount: 0,
    selectedCandidateKeySource: "NONE",
    bridge: null,
    blockers: [...new Set(blockers)],
    ...SAFETY,
  };
}

/**
 * Read-only adapter from the existing exact-live H1 selector registry into the
 * already-authority-free business shadow bridge. It never invents an official
 * candidate and never manufactures ranking evidence.
 */
export function buildBusinessShadowFromH1Registry(
  input: BusinessShadowRegistryAdapterInput,
): BusinessShadowRegistryAdapterResult {
  if (!input?.snapshot || input.snapshot.version !== "CANONICAL_ONE_ROOF_MARKET_SNAPSHOT_V2") {
    return fail(["CANONICAL_SNAPSHOT_REQUIRED"]);
  }
  if (typeof input.nowIso !== "string" || !Number.isFinite(Date.parse(input.nowIso))) {
    return fail(["VALID_NOW_ISO_REQUIRED"]);
  }
  if (!input.evidenceByCandidateKey || typeof input.evidenceByCandidateKey !== "object" || Array.isArray(input.evidenceByCandidateKey)) {
    return fail(["EVIDENCE_BY_CANDIDATE_KEY_REQUIRED"]);
  }

  const registry = collectH1LiveSelectorDecisions(input.nowIso, input.maxAgeMs ?? 90_000);
  if (!registry.eligibleForLiveH1Marking || registry.rejected.length > 0 || registry.producerRejected.length > 0) {
    return fail(
      [
        "H1_LIVE_SELECTOR_REGISTRY_NOT_READY",
        ...registry.rejected.flatMap((x) => x.blockers.map((b) => `REGISTRY_${b}`)),
        ...registry.producerRejected.map((x) => `REGISTRY_${x.reason}`),
      ],
      registry.assembledCount,
      registry.blockedCount,
    );
  }

  const evaluations = registry.evaluations.filter((x) => x.candidate.symbol === input.snapshot.symbol);
  if (evaluations.length === 0) {
    return fail(["NO_LIVE_REGISTRY_CANDIDATES_FOR_SNAPSHOT_SYMBOL"], registry.assembledCount, registry.blockedCount);
  }

  const candidateRankingInputs = evaluations.map((evaluation) => {
    const key = evaluation.selector.candidateKey;
    return {
      candidate: evaluation.candidate,
      evidence: key ? (input.evidenceByCandidateKey[key] ?? {}) : {},
    };
  });

  const selectedCandidateKey = input.selectedCandidateKey ?? null;
  if (selectedCandidateKey != null) {
    const suppliedByUpstream = evaluations.some((x) => x.selector.candidateKey === selectedCandidateKey);
    if (!suppliedByUpstream) {
      return fail(["UPSTREAM_SELECTED_CANDIDATE_NOT_IN_LIVE_REGISTRY"], registry.assembledCount, registry.blockedCount);
    }
  }

  const bridge = buildBusinessShadowLiveBridge({
    snapshot: input.snapshot,
    decisionId: `REGISTRY:${input.snapshot.snapshotId}:${input.nowIso}`,
    selectedCandidateKey,
    candidateRankingInputs,
    metrics: input.metrics,
    marketState: input.marketState,
    sellerStressState: input.sellerStressState,
    opportunityStage: input.opportunityStage,
  });

  return {
    version: BUSINESS_SHADOW_REGISTRY_ADAPTER_V1,
    ready: bridge.ready,
    registryAssembledCount: registry.assembledCount,
    registryBlockedCount: registry.blockedCount,
    matchedSymbolCandidateCount: evaluations.length,
    selectedCandidateKeySource: selectedCandidateKey == null ? "NONE" : "UPSTREAM_ONLY",
    bridge,
    blockers: bridge.ready ? [] : [...bridge.blockers],
    ...SAFETY,
  };
}
