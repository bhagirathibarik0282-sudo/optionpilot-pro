import type { CanonicalOneRoofMarketSnapshot } from "./canonical-one-roof-market-snapshot.js";
import type { H1CanonicalLiveBusinessRuntimeCoordinatorResult } from "./h1-canonical-live-business-runtime-coordinator.js";
import type { H1GoldExactFamilySignal, H1GoldEvidenceAdapterInput } from "./h1-gold-evidence-adapter-v1.js";
import type { H1GoldHorizonCompleteResult } from "./h1-gold-horizon-complete-producer-v1.js";
import type { H1GoldLiveRuntimeBridgeResult } from "./h1-gold-live-runtime-bridge-v1.js";
import type { H1GoldPeerConflictAbsentResult } from "./h1-gold-peer-conflict-absent-producer-v1.js";
import {
  bootstrapH1GoldChaseResearch,
  type H1GoldChaseResearchBootstrapResult,
} from "./h1-gold-chase-research-bootstrap-v1.js";
import type { H1GoldChasePremiumPoint } from "./h1-gold-chase-observation-v1.js";
import {
  H1GoldChaseExactLineageResolver,
  type H1GoldChaseExactLineagePublishResult,
} from "./h1-gold-chase-exact-lineage-resolver-v1.js";
import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";

export const H1_GOLD_CHASE_EXACT_LINEAGE_PUBLISHER_V1 =
  "H1_GOLD_CHASE_EXACT_LINEAGE_PUBLISHER_V1" as const;

export interface H1GoldChaseExactLineagePublisherInput {
  packet: LiveGateEvidencePacket;
  canonicalSnapshot: CanonicalOneRoofMarketSnapshot;
  canonicalRuntime: H1CanonicalLiveBusinessRuntimeCoordinatorResult;
  goldBridge: H1GoldLiveRuntimeBridgeResult;
  peerConflictAbsent: H1GoldPeerConflictAbsentResult;
  horizonComplete: H1GoldHorizonCompleteResult;
  premiumPoints: H1GoldChasePremiumPoint[];
  spread?: number | null;
  estimatedSlippage?: number | null;
}

export interface H1GoldChaseExactLineagePublisherResult {
  version: typeof H1_GOLD_CHASE_EXACT_LINEAGE_PUBLISHER_V1;
  state: "PUBLISHED" | "BLOCKED";
  ready: boolean;
  bootstrap: H1GoldChaseResearchBootstrapResult | null;
  publication: H1GoldChaseExactLineagePublishResult | null;
  blockers: string[];
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  calculatesThresholds: false;
  failClosed: true;
  semantics: "APPROVED_EXACT_PRODUCER_OUTPUTS_TO_ONE_SHOT_LINEAGE_NO_ALIAS_NO_INFERENCE";
}

const SAFETY = Object.freeze({
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  calculatesThresholds: false as const,
  failClosed: true as const,
  semantics: "APPROVED_EXACT_PRODUCER_OUTPUTS_TO_ONE_SHOT_LINEAGE_NO_ALIAS_NO_INFERENCE" as const,
});

function signal(
  state: "PASS" | "MISSING",
  source: string,
  snapshotId: string,
  observedAt: string,
  reasons: string[],
): H1GoldExactFamilySignal {
  return { state, source, snapshotId, observedAt, provenance: "LIVE_RUNTIME_EXACT", reasonCodes: reasons };
}

function exactPpdPass(packet: LiveGateEvidencePacket): boolean {
  const id = packet?.identity;
  const ppd = packet?.ppdSupport;
  return Boolean(id && ppd
    && ppd.source === "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION"
    && ppd.provenance === "LIVE_RUNTIME_EXACT"
    && ppd.symbol === id.symbol && ppd.expiryDate === id.expiryDate && ppd.strike === id.strike
    && ppd.candidateSide === id.side && ppd.observedAt === id.observedAt
    && ppd.allRequiredWindowsReady === true && ppd.candidateConfirmed === true
    && ppd.supportingOnly === true && ppd.standaloneTrigger === false
    && ppd.windows.length === 3
    && [3, 6, 15].every((minutes) => ppd.windows.some((window) =>
      window.windowMinutes === minutes && window.usable === true && window.candidateControlledExpansion === true)));
}

function exactExecutionPass(packet: LiveGateEvidencePacket): boolean {
  const id = packet?.identity;
  if (!id) return false;
  const names = ["capitalFit", "liquidityOk", "spreadOk", "currentOrNearExpiryUsable"] as const;
  const required = id.dte >= 5 && id.dte <= 7 ? [...names, "fallbackDteApproved" as const] : names;
  return required.every((name) => {
    const gate = packet.gates?.[name];
    return gate?.value === true && gate.provenance === "LIVE_RUNTIME_EXACT" && gate.observedAt === id.observedAt;
  });
}

function blocked(
  blockers: string[],
  bootstrap: H1GoldChaseResearchBootstrapResult | null = null,
  publication: H1GoldChaseExactLineagePublishResult | null = null,
): H1GoldChaseExactLineagePublisherResult {
  return {
    version: H1_GOLD_CHASE_EXACT_LINEAGE_PUBLISHER_V1,
    state: "BLOCKED",
    ready: false,
    bootstrap,
    publication,
    blockers: [...new Set(blockers)],
    ...SAFETY,
  };
}

/** Converts approved producer results into the existing research bootstrap and resolver. */
export class H1GoldChaseExactLineagePublisher {
  constructor(private readonly resolver: H1GoldChaseExactLineageResolver) {}

  publish(input: H1GoldChaseExactLineagePublisherInput): H1GoldChaseExactLineagePublisherResult {
    const id = input?.packet?.identity;
    if (!id || (id.symbol !== "NIFTY" && id.symbol !== "SENSEX") || (id.side !== "CE" && id.side !== "PE")) {
      return blocked(["EXACT_GOLD_TARGET_PACKET_REQUIRED"]);
    }
    const snapshotId = input?.canonicalSnapshot?.snapshotId?.trim() || "MISSING_CANONICAL_SNAPSHOT";
    const canonicalCandidateKey = `${id.symbol}:${id.side}:${id.strike}:${id.expiryDate}:DTE${id.dte}:${id.moneyness}`;
    const canonicalMission = input?.canonicalRuntime?.missionChain?.mission;
    const lineageBlockers: string[] = [];
    if (
      input?.canonicalSnapshot?.symbol !== id.symbol
      || input.canonicalSnapshot.asOfMs !== Date.parse(id.observedAt)
    ) lineageBlockers.push("CANONICAL_SNAPSHOT_PACKET_IDENTITY_OR_TIMESTAMP_MISMATCH");
    if (
      input?.canonicalRuntime?.version !== "H1_CANONICAL_LIVE_BUSINESS_RUNTIME_COORDINATOR_V1"
      || input.canonicalRuntime.ready !== true
      || input.canonicalRuntime.stage !== "READY_FOR_TELEGRAM_TRANSPORT"
      || canonicalMission?.ready !== true
      || canonicalMission.snapshotId !== snapshotId
      || canonicalMission.candidateKey !== canonicalCandidateKey
    ) lineageBlockers.push("CANONICAL_RUNTIME_CANDIDATE_LINEAGE_MISMATCH");
    if (
      input?.goldBridge?.version !== "H1_GOLD_LIVE_RUNTIME_BRIDGE_V1"
      || input.goldBridge.ready !== true
      || input.goldBridge.symbol !== id.symbol
      || input.goldBridge.side !== id.side
      || input.goldBridge.observedAt !== id.observedAt
      || input.goldBridge.mappedCoreFamilyCount !== 4
      || input.goldBridge.blockers.length !== 0
    ) lineageBlockers.push("APPROVED_GOLD_LIVE_BRIDGE_LINEAGE_MISMATCH");
    if (
      input?.peerConflictAbsent?.symbol !== id.symbol
      || input.peerConflictAbsent.side !== id.side
      || input.peerConflictAbsent.observedAt !== id.observedAt
      || input.peerConflictAbsent.signal.snapshotId !== snapshotId
      || input.peerConflictAbsent.signal.observedAt !== id.observedAt
      || input.peerConflictAbsent.signal.state !== input.peerConflictAbsent.state
    ) lineageBlockers.push("PEER_CONFLICT_LINEAGE_MISMATCH");
    if (
      input?.horizonComplete?.symbol !== id.symbol
      || input.horizonComplete.observedAt !== id.observedAt
      || input.horizonComplete.signal.snapshotId !== snapshotId
      || input.horizonComplete.signal.observedAt !== id.observedAt
      || input.horizonComplete.signal.state !== input.horizonComplete.state
    ) lineageBlockers.push("HORIZON_COMPLETE_LINEAGE_MISMATCH");
    if (lineageBlockers.length > 0) return blocked(lineageBlockers);

    const ppdPass = exactPpdPass(input.packet);
    const executionPass = exactExecutionPass(input.packet);
    const chasePhase = signal("MISSING", "CHASE_POLICY_RESEARCH_PENDING", snapshotId, id.observedAt, ["NO_APPROVED_GOLD_PRODUCER_FOR_FAMILY"]);
    const goldEvidence: H1GoldEvidenceAdapterInput = {
      symbol: id.symbol,
      side: id.side,
      observedAt: id.observedAt,
      canonicalSnapshot: input.canonicalSnapshot,
      dataIntegrity: input.goldBridge.dataIntegrity,
      premiumPair: signal(ppdPass ? "PASS" : "MISSING", "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION", snapshotId, id.observedAt, ppdPass ? ["EXACT_CONTROLLED_EXPANSION_CONFIRMED"] : ["APPROVED_PREMIUM_PAIR_EVIDENCE_REQUIRED"]),
      spotStructure: input.goldBridge.spotStructure,
      targetFuturesPositioning: input.goldBridge.targetFuturesPositioning,
      leaderPositioning: input.goldBridge.leaderPositioning,
      peerConflictAbsent: input.peerConflictAbsent.signal,
      chainRepositioning: input.goldBridge.chainRepositioning,
      executionQuality: signal(executionPass ? "PASS" : "MISSING", "H1_LIVE_CAPITAL_LIQUIDITY_DTE_GATES_V1", snapshotId, id.observedAt, executionPass ? ["EXACT_EXECUTION_GATES_PASS"] : ["EXACT_EXECUTION_GATE_EVIDENCE_REQUIRED"]),
      chasePhase,
      horizonComplete: input.horizonComplete.signal,
    };

    const bootstrap = bootstrapH1GoldChaseResearch({
      goldEvidence,
      contract: { expiry: id.expiryDate, strike: id.strike, optionType: id.side, dte: id.dte },
      premiumPoints: input.premiumPoints,
      spread: input.spread,
      estimatedSlippage: input.estimatedSlippage,
    });
    if (!bootstrap.ready || bootstrap.state !== "READY_FOR_FORWARD_COLLECTION") {
      return blocked(["SAFE_RESEARCH_BOOTSTRAP_NOT_READY", ...bootstrap.blockers], bootstrap);
    }

    const publication = this.resolver.publish({
      packet: input.packet,
      canonicalRuntime: input.canonicalRuntime,
      goldBridge: input.goldBridge,
      bootstrap,
    });
    if (!publication.ready) return blocked(publication.blockers, bootstrap, publication);
    return {
      version: H1_GOLD_CHASE_EXACT_LINEAGE_PUBLISHER_V1,
      state: "PUBLISHED",
      ready: true,
      bootstrap,
      publication,
      blockers: [],
      ...SAFETY,
    };
  }
}
