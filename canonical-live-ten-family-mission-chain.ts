import { CanonicalLiveFamilySignalRegistry, type CanonicalLiveFamilySignalCollection } from "./canonical-live-family-signal-registry.js";
import { runCanonicalBusinessMission, type CanonicalBusinessMissionOrchestratorInput, type CanonicalBusinessMissionOrchestratorResult } from "./canonical-business-mission-orchestrator.js";
import type { H1ExactCoreFamilySignalAdapterResult } from "./h1-exact-core-family-signal-adapter.js";
import type { H1RemainingFamilyDirectionalAttestorResult } from "./h1-remaining-family-directional-attestor.js";

export const CANONICAL_LIVE_TEN_FAMILY_MISSION_CHAIN_V1 = "CANONICAL_LIVE_TEN_FAMILY_MISSION_CHAIN_V1" as const;

export interface CanonicalLiveTenFamilyMissionChainResult {
  version: typeof CANONICAL_LIVE_TEN_FAMILY_MISSION_CHAIN_V1;
  ready: boolean;
  stage: "INPUT" | "CORE_3" | "DIRECTIONAL_7" | "REGISTRY_10" | "MISSION" | "READY_FOR_TELEGRAM_TRANSPORT";
  collection: CanonicalLiveFamilySignalCollection | null;
  mission: CanonicalBusinessMissionOrchestratorResult | null;
  blockers: string[];
  familyCount: number;
  sendsTelegram: false;
  createsOrders: false;
  affectsExecution: false;
  failClosed: true;
}

const safety = {
  sendsTelegram: false as const,
  createsOrders: false as const,
  affectsExecution: false as const,
  failClosed: true as const,
};

function blocked(
  stage: CanonicalLiveTenFamilyMissionChainResult["stage"],
  blockers: string[],
  collection: CanonicalLiveFamilySignalCollection | null = null,
  mission: CanonicalBusinessMissionOrchestratorResult | null = null,
): CanonicalLiveTenFamilyMissionChainResult {
  return {
    version: CANONICAL_LIVE_TEN_FAMILY_MISSION_CHAIN_V1,
    ready: false,
    stage,
    collection,
    mission,
    blockers: [...new Set(blockers)],
    familyCount: collection?.verifiedFamilyCount ?? 0,
    ...safety,
  };
}

/**
 * Transactional composition boundary: all ten envelopes are validated in an isolated
 * registry before the canonical mission runs. No partially-published global registry
 * state survives a failed attempt.
 */
export function runCanonicalLiveTenFamilyMissionChain(input: {
  core: H1ExactCoreFamilySignalAdapterResult;
  directional: H1RemainingFamilyDirectionalAttestorResult;
  missionInput: Omit<CanonicalBusinessMissionOrchestratorInput, "familySignals">;
  sourceManifestHash: string;
  maxSignalAgeMs?: number;
}): CanonicalLiveTenFamilyMissionChainResult {
  if (
    !input
    || typeof input.sourceManifestHash !== "string"
    || !input.sourceManifestHash.trim()
    || !input.missionInput
    || !Number.isFinite(input.missionInput.nowMs)
    || input.missionInput.nowMs <= 0
  ) return blocked("INPUT", ["INVALID_TEN_FAMILY_CHAIN_INPUT"]);

  if (!input.core?.ready || input.core.envelopes.length !== 3) {
    return blocked("CORE_3", ["EXACT_CORE_THREE_NOT_READY", ...(input.core?.blockers ?? [])]);
  }
  if (!input.directional?.ready || input.directional.envelopes.length !== 7) {
    return blocked("DIRECTIONAL_7", ["EXACT_DIRECTIONAL_SEVEN_NOT_READY", ...(input.directional?.blockers ?? [])]);
  }

  const all = [...input.core.envelopes, ...input.directional.envelopes];
  const symbols = new Set(all.map((row) => row.symbol));
  const sourceSymbol = input.missionInput.source?.snapshot?.symbol;
  if (symbols.size !== 1 || !sourceSymbol || !symbols.has(sourceSymbol)) {
    return blocked("REGISTRY_10", ["TEN_FAMILY_SYMBOL_OR_SOURCE_MISMATCH"]);
  }

  const registry = new CanonicalLiveFamilySignalRegistry();
  const publicationBlockers: string[] = [];
  for (const envelope of all) {
    const result = registry.publish(envelope);
    if (!result.accepted) publicationBlockers.push(`${result.family ?? "UNKNOWN"}:${result.reason}`);
  }
  if (publicationBlockers.length > 0) return blocked("REGISTRY_10", publicationBlockers);

  const collection = registry.collect(
    sourceSymbol,
    input.sourceManifestHash,
    input.missionInput.nowMs,
    input.maxSignalAgeMs,
  );
  if (!collection.ready || collection.signals.length !== 10) {
    return blocked("REGISTRY_10", ["EXACT_TEN_FAMILY_COLLECTION_NOT_READY", ...collection.blockers], collection);
  }

  const mission = runCanonicalBusinessMission({
    ...input.missionInput,
    familySignals: collection.signals,
  });
  if (!mission.ready) return blocked("MISSION", mission.blockers, collection, mission);

  return {
    version: CANONICAL_LIVE_TEN_FAMILY_MISSION_CHAIN_V1,
    ready: true,
    stage: "READY_FOR_TELEGRAM_TRANSPORT",
    collection,
    mission,
    blockers: [],
    familyCount: 10,
    ...safety,
  };
}
