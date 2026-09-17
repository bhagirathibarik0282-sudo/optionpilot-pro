import type { H1CanonicalLiveBusinessRuntimeCoordinatorResult } from "./h1-canonical-live-business-runtime-coordinator.js";
import type { H1GoldLiveRuntimeBridgeResult } from "./h1-gold-live-runtime-bridge-v1.js";
import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";
import type { H1GoldChaseResearchBootstrapResult } from "./h1-gold-chase-research-bootstrap-v1.js";
import {
  auditH1GoldChaseRuntimeAttachment,
  type H1GoldChaseRuntimeAttachmentGateInput,
  type H1GoldChaseRuntimeAttachmentGateResult,
} from "./h1-gold-chase-runtime-attachment-gate-v1.js";
import type {
  H1GoldChaseExactServiceLineageRequest,
  H1GoldChaseExactServiceLineageResolver,
} from "./h1-gold-chase-exact-service-shadow-hook-v1.js";
import type { H1GoldChaseSameProcessAttachInput } from "./h1-gold-chase-same-process-shadow-runtime-v1.js";

export const H1_GOLD_CHASE_EXACT_LINEAGE_RESOLVER_V1 =
  "H1_GOLD_CHASE_EXACT_LINEAGE_RESOLVER_V1" as const;

export interface H1GoldChaseExactLineagePublication {
  packet: LiveGateEvidencePacket;
  canonicalRuntime: H1CanonicalLiveBusinessRuntimeCoordinatorResult;
  goldBridge: H1GoldLiveRuntimeBridgeResult;
  bootstrap: H1GoldChaseResearchBootstrapResult;
}

export interface H1GoldChaseExactLineagePublishResult {
  version: typeof H1_GOLD_CHASE_EXACT_LINEAGE_RESOLVER_V1;
  state: "PUBLISHED" | "BLOCKED";
  ready: boolean;
  gate: H1GoldChaseRuntimeAttachmentGateResult;
  blockers: string[];
  oneShot: true;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "EXACT_PACKET_OBJECT_KEYED_ONE_SHOT_VERIFIED_LINEAGE_NO_RECONSTRUCTION_NO_INFERENCE";
}

type Audit = (input: H1GoldChaseRuntimeAttachmentGateInput) => H1GoldChaseRuntimeAttachmentGateResult;

const SAFETY = Object.freeze({
  oneShot: true as const,
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  failClosed: true as const,
  semantics: "EXACT_PACKET_OBJECT_KEYED_ONE_SHOT_VERIFIED_LINEAGE_NO_RECONSTRUCTION_NO_INFERENCE" as const,
});

function blockedGate(blockers: string[]): H1GoldChaseRuntimeAttachmentGateResult {
  return {
    version: "H1_GOLD_CHASE_RUNTIME_ATTACHMENT_GATE_V1",
    state: "BLOCKED",
    ready: false,
    candidateKey: null,
    decisionId: null,
    blockers: [...new Set(blockers)],
    requiresSameProcessRegistry: true,
    startsRuntime: false,
    schedulesSampling: false,
    persistsSamples: false,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
    semantics: "PROVES_APPROVED_SAME_PROCESS_BOOTSTRAP_SOURCE_BEFORE_SHADOW_RUNTIME_ATTACHMENT",
  };
}

/**
 * Same-process handoff for already-produced and already-approved lineage only.
 *
 * WeakMap identity makes a copied/reconstructed packet unresolvable. Publication
 * is accepted only after the existing attachment gate approves the complete
 * canonical -> Gold bridge -> bootstrap lineage. Resolution consumes the entry,
 * preventing replay. This module does not build evidence or start a collector.
 */
export class H1GoldChaseExactLineageResolver {
  private readonly byPacket = new WeakMap<LiveGateEvidencePacket, H1GoldChaseSameProcessAttachInput>();

  constructor(
    private readonly processIdentity = "h1-exact-shadow-live-service",
    private readonly audit: Audit = auditH1GoldChaseRuntimeAttachment,
  ) {}

  publish(input: H1GoldChaseExactLineagePublication): H1GoldChaseExactLineagePublishResult {
    const identity = this.processIdentity.trim();
    const duplicate = Boolean(input?.packet && this.byPacket.has(input.packet));
    let gate: H1GoldChaseRuntimeAttachmentGateResult;
    try {
      gate = this.audit({
        ...input,
        registryProcessIdentity: identity,
        collectorProcessIdentity: identity,
      });
    } catch {
      gate = blockedGate(["LINEAGE_ATTACHMENT_AUDIT_EXCEPTION"]);
    }
    const extraBlockers = [
      ...(!identity ? ["RUNTIME_PROCESS_IDENTITY_REQUIRED"] : []),
      ...(duplicate ? ["LINEAGE_ALREADY_PUBLISHED_FOR_PACKET"] : []),
    ];
    const ready = Boolean(
      identity
      && input?.packet
      && !duplicate
      && gate.ready
      && gate.state === "READY_FOR_SAME_PROCESS_SHADOW_ATTACHMENT",
    );
    if (ready) this.byPacket.set(input.packet, input);
    return {
      version: H1_GOLD_CHASE_EXACT_LINEAGE_RESOLVER_V1,
      state: ready ? "PUBLISHED" : "BLOCKED",
      ready,
      gate,
      blockers: ready ? [] : [...new Set([...gate.blockers, ...extraBlockers])],
      ...SAFETY,
    };
  }

  resolve(request: H1GoldChaseExactServiceLineageRequest): H1GoldChaseSameProcessAttachInput | null {
    const packet = request?.packet;
    if (!packet) return null;
    const input = this.byPacket.get(packet) ?? null;
    if (!input) return null;
    this.byPacket.delete(packet);
    return input.packet === packet ? input : null;
  }

  resolver(): H1GoldChaseExactServiceLineageResolver {
    return (request) => this.resolve(request);
  }
}
