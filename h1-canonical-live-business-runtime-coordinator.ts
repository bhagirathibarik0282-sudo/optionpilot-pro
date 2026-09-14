import { adaptH1ExactCoreFamilySignals, type H1ExactCoreFamilySignalAdapterResult, type H1ExactCoreFamilySignalInput } from "./h1-exact-core-family-signal-adapter.js";
import { produceH1LiveSevenDirectionalFamilies, type H1LiveSevenFamilyDirectionalProducerResult, type H1LiveSevenFamilyFacts, type H1LiveSevenFamilyPolicy } from "./h1-live-seven-family-directional-producer.js";
import { attestH1RemainingDirectionalFamilies, type H1RemainingFamilyDirectionalAttestorResult } from "./h1-remaining-family-directional-attestor.js";
import { runCanonicalLiveTenFamilyMissionChain, type CanonicalLiveTenFamilyMissionChainResult } from "./canonical-live-ten-family-mission-chain.js";
import type { CanonicalBusinessMissionOrchestratorInput } from "./canonical-business-mission-orchestrator.js";
import type { H1ExactLiveSpotDirectionResult } from "./h1-exact-live-spot-direction-provider.js";
import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";

export const H1_CANONICAL_LIVE_BUSINESS_RUNTIME_COORDINATOR_V1 = "H1_CANONICAL_LIVE_BUSINESS_RUNTIME_COORDINATOR_V1" as const;

export interface H1CanonicalLiveBusinessRuntimeCoordinatorResult {
  version: typeof H1_CANONICAL_LIVE_BUSINESS_RUNTIME_COORDINATOR_V1;
  ready: boolean;
  stage: "INPUT" | "CORE_3" | "PRODUCER_7" | "ATTESTOR_7" | "MISSION_10" | "READY_FOR_TELEGRAM_TRANSPORT";
  core: H1ExactCoreFamilySignalAdapterResult | null;
  producer: H1LiveSevenFamilyDirectionalProducerResult | null;
  attestor: H1RemainingFamilyDirectionalAttestorResult | null;
  missionChain: CanonicalLiveTenFamilyMissionChainResult | null;
  blockers: string[];
  sendsTelegram: false;
  createsOrders: false;
  affectsExecution: false;
  failClosed: true;
}

const safety = { sendsTelegram: false as const, createsOrders: false as const, affectsExecution: false as const, failClosed: true as const };

function result(
  stage: H1CanonicalLiveBusinessRuntimeCoordinatorResult["stage"],
  blockers: string[],
  parts: Partial<Pick<H1CanonicalLiveBusinessRuntimeCoordinatorResult, "core" | "producer" | "attestor" | "missionChain">> = {},
): H1CanonicalLiveBusinessRuntimeCoordinatorResult {
  return {
    version: H1_CANONICAL_LIVE_BUSINESS_RUNTIME_COORDINATOR_V1,
    ready: stage === "READY_FOR_TELEGRAM_TRANSPORT",
    stage,
    core: parts.core ?? null,
    producer: parts.producer ?? null,
    attestor: parts.attestor ?? null,
    missionChain: parts.missionChain ?? null,
    blockers: [...new Set(blockers)],
    ...safety,
  };
}

/** Single fail-closed call from exact assembled live facts to Telegram transport readiness. */
export function runH1CanonicalLiveBusinessRuntime(input: {
  packet: LiveGateEvidencePacket;
  coreFamilySignals: H1ExactCoreFamilySignalInput[];
  directionSource: H1ExactLiveSpotDirectionResult;
  sevenFamilyFacts: H1LiveSevenFamilyFacts;
  sevenFamilyPolicy: H1LiveSevenFamilyPolicy;
  sourceManifestHash: string;
  missionInput: Omit<CanonicalBusinessMissionOrchestratorInput, "familySignals">;
  maxAgeMs?: number;
}): H1CanonicalLiveBusinessRuntimeCoordinatorResult {
  if (!input?.packet?.identity || !input.missionInput || input.packet.identity.symbol !== input.missionInput.source?.snapshot?.symbol) {
    return result("INPUT", ["RUNTIME_IDENTITY_OR_SOURCE_INVALID"]);
  }
  const nowMs = input.missionInput.nowMs;
  const core = adaptH1ExactCoreFamilySignals({
    packet: input.packet,
    familySignals: input.coreFamilySignals,
    sourceManifestHash: input.sourceManifestHash,
    nowMs,
    maxAgeMs: input.maxAgeMs,
  });
  if (!core.ready) return result("CORE_3", core.blockers, { core });

  const producer = produceH1LiveSevenDirectionalFamilies({
    symbol: input.packet.identity.symbol,
    directionSource: input.directionSource,
    facts: input.sevenFamilyFacts,
    policy: input.sevenFamilyPolicy,
    sourceManifestHash: input.sourceManifestHash,
    nowMs,
  });
  if (!producer.ready) return result("PRODUCER_7", producer.blockers, { core, producer });

  const attestor = attestH1RemainingDirectionalFamilies({
    symbol: input.packet.identity.symbol,
    selectedOptionSide: input.packet.identity.side,
    directionSource: input.directionSource,
    evidence: producer.evidence,
    sourceManifestHash: input.sourceManifestHash,
    nowMs,
    maxAgeMs: input.maxAgeMs,
  });
  if (!attestor.ready) return result("ATTESTOR_7", attestor.blockers, { core, producer, attestor });

  const missionChain = runCanonicalLiveTenFamilyMissionChain({
    core,
    directional: attestor,
    missionInput: input.missionInput,
    sourceManifestHash: input.sourceManifestHash,
    maxSignalAgeMs: input.maxAgeMs,
  });
  if (!missionChain.ready) return result("MISSION_10", missionChain.blockers, { core, producer, attestor, missionChain });

  return result("READY_FOR_TELEGRAM_TRANSPORT", [], { core, producer, attestor, missionChain });
}
