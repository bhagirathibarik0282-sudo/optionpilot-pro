import type { CanonicalOneRoofMarketSnapshot } from "./canonical-one-roof-market-snapshot.js";
import type { CanonicalBusinessMissionOrchestratorInput } from "./canonical-business-mission-orchestrator.js";
import {
  runH1CanonicalLiveBusinessRuntime,
  type H1CanonicalLiveBusinessRuntimeCoordinatorResult,
} from "./h1-canonical-live-business-runtime-coordinator.js";
import type { H1ExactCoreFamilySignalInput } from "./h1-exact-core-family-signal-adapter.js";
import type { H1ExactLiveSpotDirectionResult } from "./h1-exact-live-spot-direction-provider.js";
import {
  buildH1GoldLiveRuntimeBridge,
  type H1GoldLiveRuntimeBridgeResult,
} from "./h1-gold-live-runtime-bridge-v1.js";
import {
  buildH1GoldPeerConflictAbsent,
  type H1GoldPeerConflictAbsentResult,
} from "./h1-gold-peer-conflict-absent-producer-v1.js";
import {
  loadAndBuildH1GoldHorizonComplete,
  type H1GoldHorizonCompleteResult,
} from "./h1-gold-horizon-complete-producer-v1.js";
import type { H1GoldChasePremiumPoint } from "./h1-gold-chase-observation-v1.js";
import type { H1GoldChaseExactLineagePublisherInput } from "./h1-gold-chase-exact-lineage-publisher-v1.js";
import type { H1GoldChaseReadOnlyLineageRequest } from "./h1-gold-chase-readonly-lineage-adapter-v1.js";
import type {
  H1LiveSevenFamilyFacts,
  H1LiveSevenFamilyPolicy,
} from "./h1-live-seven-family-directional-producer.js";

export const H1_GOLD_CANONICAL_APPROVED_PRODUCER_V1 =
  "H1_GOLD_CANONICAL_APPROVED_PRODUCER_V1" as const;

export interface H1GoldCanonicalProducerFacts {
  canonicalSnapshot: CanonicalOneRoofMarketSnapshot;
  coreFamilySignals: H1ExactCoreFamilySignalInput[];
  directionSource: H1ExactLiveSpotDirectionResult;
  peerDirectionSources: H1ExactLiveSpotDirectionResult[];
  sevenFamilyFacts: H1LiveSevenFamilyFacts;
  sevenFamilyPolicy: H1LiveSevenFamilyPolicy;
  sourceManifestHash: string;
  missionInput: Omit<CanonicalBusinessMissionOrchestratorInput, "familySignals">;
  premiumPoints: H1GoldChasePremiumPoint[];
  spread?: number | null;
  estimatedSlippage?: number | null;
}

export type H1GoldCanonicalFactsSource = (
  request: H1GoldChaseReadOnlyLineageRequest,
) => H1GoldCanonicalProducerFacts | null | Promise<H1GoldCanonicalProducerFacts | null>;

export interface H1GoldCanonicalApprovedProducerStatus {
  version: typeof H1_GOLD_CANONICAL_APPROVED_PRODUCER_V1;
  state: "READY" | "BLOCKED";
  ready: boolean;
  observedAt: string | null;
  candidateKey: string | null;
  blockers: string[];
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "EXACT_CANONICAL_BUILDERS_ONLY_NO_ALIAS_NO_INFERENCE_NO_THRESHOLD";
}

type RuntimeBuilder = typeof runH1CanonicalLiveBusinessRuntime;
type GoldBuilder = typeof buildH1GoldLiveRuntimeBridge;
type PeerBuilder = typeof buildH1GoldPeerConflictAbsent;
type HorizonBuilder = typeof loadAndBuildH1GoldHorizonComplete;

export interface H1GoldCanonicalApprovedProducerDeps {
  runtimeBuilder?: RuntimeBuilder;
  goldBuilder?: GoldBuilder;
  peerBuilder?: PeerBuilder;
  horizonBuilder?: HorizonBuilder;
}

const SAFETY = Object.freeze({
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  failClosed: true as const,
  semantics: "EXACT_CANONICAL_BUILDERS_ONLY_NO_ALIAS_NO_INFERENCE_NO_THRESHOLD" as const,
});

function status(
  ready: boolean,
  observedAt: string | null,
  candidateKey: string | null,
  blockers: string[],
): H1GoldCanonicalApprovedProducerStatus {
  return {
    version: H1_GOLD_CANONICAL_APPROVED_PRODUCER_V1,
    state: ready ? "READY" : "BLOCKED",
    ready,
    observedAt,
    candidateKey: ready ? candidateKey : null,
    blockers: ready ? [] : [...new Set(blockers.filter(Boolean))],
    ...SAFETY,
  };
}

export class H1GoldCanonicalApprovedProducer {
  private readonly runtimeBuilder: RuntimeBuilder;
  private readonly goldBuilder: GoldBuilder;
  private readonly peerBuilder: PeerBuilder;
  private readonly horizonBuilder: HorizonBuilder;
  private latest = status(false, null, null, ["NO_LIVE_CANONICAL_REQUEST_OBSERVED"]);

  constructor(
    private readonly factsSource: H1GoldCanonicalFactsSource,
    deps: H1GoldCanonicalApprovedProducerDeps = {},
  ) {
    this.runtimeBuilder = deps.runtimeBuilder ?? runH1CanonicalLiveBusinessRuntime;
    this.goldBuilder = deps.goldBuilder ?? buildH1GoldLiveRuntimeBridge;
    this.peerBuilder = deps.peerBuilder ?? buildH1GoldPeerConflictAbsent;
    this.horizonBuilder = deps.horizonBuilder ?? loadAndBuildH1GoldHorizonComplete;
  }

  latestStatus(): H1GoldCanonicalApprovedProducerStatus {
    return { ...this.latest, blockers: [...this.latest.blockers] };
  }

  async produce(request: H1GoldChaseReadOnlyLineageRequest): Promise<H1GoldChaseExactLineagePublisherInput | null> {
    const id = request?.packet?.identity;
    if (!id || (id.symbol !== "NIFTY" && id.symbol !== "SENSEX") || (id.side !== "CE" && id.side !== "PE")) {
      this.latest = status(false, id?.observedAt ?? null, null, ["EXACT_GOLD_PACKET_REQUIRED"]);
      return null;
    }
    let facts: H1GoldCanonicalProducerFacts | null;
    try {
      facts = await this.factsSource(request);
    } catch {
      facts = null;
    }
    if (!facts) {
      this.latest = status(false, id.observedAt, null, ["LIVE_CANONICAL_FACTS_NOT_READY"]);
      return null;
    }
    if (
      facts.canonicalSnapshot.symbol !== id.symbol
      || facts.canonicalSnapshot.asOfMs !== Date.parse(id.observedAt)
      || facts.missionInput.source?.snapshot !== facts.canonicalSnapshot
      || facts.missionInput.nowMs !== facts.canonicalSnapshot.asOfMs
    ) {
      this.latest = status(false, id.observedAt, null, ["CANONICAL_FACTS_PACKET_IDENTITY_OR_TIMESTAMP_MISMATCH"]);
      return null;
    }

    let canonicalRuntime: H1CanonicalLiveBusinessRuntimeCoordinatorResult;
    let goldBridge: H1GoldLiveRuntimeBridgeResult;
    let peerConflictAbsent: H1GoldPeerConflictAbsentResult;
    let horizonComplete: H1GoldHorizonCompleteResult;
    try {
      canonicalRuntime = this.runtimeBuilder({
        packet: request.packet,
        coreFamilySignals: facts.coreFamilySignals,
        directionSource: facts.directionSource,
        sevenFamilyFacts: facts.sevenFamilyFacts,
        sevenFamilyPolicy: facts.sevenFamilyPolicy,
        sourceManifestHash: facts.sourceManifestHash,
        missionInput: facts.missionInput,
      });
      goldBridge = this.goldBuilder({
        symbol: id.symbol,
        side: id.side,
        observedAt: id.observedAt,
        canonicalSnapshot: facts.canonicalSnapshot,
        directionSource: facts.directionSource,
        sevenFamilyProducer: canonicalRuntime.producer!,
        sourceManifestHash: facts.sourceManifestHash,
      });
      peerConflictAbsent = this.peerBuilder({
        symbol: id.symbol,
        side: id.side,
        observedAt: id.observedAt,
        canonicalSnapshot: facts.canonicalSnapshot,
        targetDirectionSource: facts.directionSource,
        peerDirectionSources: facts.peerDirectionSources,
      });
      horizonComplete = await this.horizonBuilder({
        symbol: id.symbol,
        observedAt: id.observedAt,
        canonicalSnapshot: facts.canonicalSnapshot,
      });
    } catch {
      this.latest = status(false, id.observedAt, null, ["APPROVED_CANONICAL_BUILDER_EXCEPTION"]);
      return null;
    }

    const blockers = [
      ...(!canonicalRuntime.ready ? ["CANONICAL_RUNTIME_NOT_READY", ...canonicalRuntime.blockers] : []),
      ...(!goldBridge.ready ? ["GOLD_BRIDGE_NOT_READY", ...goldBridge.blockers] : []),
      ...(!peerConflictAbsent.ready ? ["PEER_CONFLICT_PRODUCER_NOT_READY", ...peerConflictAbsent.blockers] : []),
      ...(!horizonComplete.ready ? ["HORIZON_COMPLETE_NOT_READY", ...horizonComplete.blockers] : []),
    ];
    if (blockers.length > 0) {
      this.latest = status(false, id.observedAt, null, blockers);
      return null;
    }

    const candidateKey = canonicalRuntime.missionChain?.mission?.candidateKey ?? null;
    if (!candidateKey) {
      this.latest = status(false, id.observedAt, null, ["CANONICAL_MISSION_CANDIDATE_KEY_REQUIRED"]);
      return null;
    }
    this.latest = status(true, id.observedAt, candidateKey, []);
    return {
      packet: request.packet,
      canonicalSnapshot: facts.canonicalSnapshot,
      canonicalRuntime,
      goldBridge,
      peerConflictAbsent,
      horizonComplete,
      premiumPoints: facts.premiumPoints,
      spread: facts.spread,
      estimatedSlippage: facts.estimatedSlippage,
    };
  }
}
