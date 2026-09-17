import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";
import type { H1CanonicalLiveBusinessRuntimeCoordinatorResult } from "./h1-canonical-live-business-runtime-coordinator.js";
import type { H1GoldLiveRuntimeBridgeResult } from "./h1-gold-live-runtime-bridge-v1.js";
import type { H1GoldChaseResearchBootstrapResult } from "./h1-gold-chase-research-bootstrap-v1.js";

export const H1_GOLD_CHASE_RUNTIME_ATTACHMENT_GATE_V1 = "H1_GOLD_CHASE_RUNTIME_ATTACHMENT_GATE_V1" as const;

export interface H1GoldChaseRuntimeAttachmentGateInput {
  registryProcessIdentity: string;
  collectorProcessIdentity: string;
  packet: LiveGateEvidencePacket | null;
  canonicalRuntime: H1CanonicalLiveBusinessRuntimeCoordinatorResult | null;
  goldBridge: H1GoldLiveRuntimeBridgeResult | null;
  bootstrap: H1GoldChaseResearchBootstrapResult | null;
}

export interface H1GoldChaseRuntimeAttachmentGateResult {
  version: typeof H1_GOLD_CHASE_RUNTIME_ATTACHMENT_GATE_V1;
  state: "READY_FOR_SAME_PROCESS_SHADOW_ATTACHMENT" | "BLOCKED";
  ready: boolean;
  candidateKey: string | null;
  decisionId: string | null;
  blockers: string[];
  requiresSameProcessRegistry: true;
  startsRuntime: false;
  schedulesSampling: false;
  persistsSamples: false;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "PROVES_APPROVED_SAME_PROCESS_BOOTSTRAP_SOURCE_BEFORE_SHADOW_RUNTIME_ATTACHMENT";
}

const SAFETY = Object.freeze({
  requiresSameProcessRegistry: true as const,
  startsRuntime: false as const,
  schedulesSampling: false as const,
  persistsSamples: false as const,
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  failClosed: true as const,
  semantics: "PROVES_APPROVED_SAME_PROCESS_BOOTSTRAP_SOURCE_BEFORE_SHADOW_RUNTIME_ATTACHMENT" as const,
});

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalCandidateKey(packet: LiveGateEvidencePacket | null): string | null {
  const identity = packet?.identity;
  if (!identity || (identity.symbol !== "NIFTY" && identity.symbol !== "SENSEX")) return null;
  if ((identity.side !== "CE" && identity.side !== "PE") || !identity.expiryDate || !Number.isFinite(identity.strike)) return null;
  return `${identity.symbol}|${identity.expiryDate}|${identity.strike}|${identity.side}`;
}

/**
 * Read-only gate before any live collector attachment.
 *
 * The selector registry is process-local. A collector launched as another
 * package.json background process cannot observe its exact-live packets. This
 * gate therefore requires the registry producer and collector hook to declare
 * the same runtime process identity, then verifies the complete approved
 * canonical -> Gold bridge -> research bootstrap lineage. It never starts a
 * timer, registers a session, persists a sample or changes production output.
 */
export function auditH1GoldChaseRuntimeAttachment(
  input: H1GoldChaseRuntimeAttachmentGateInput,
): H1GoldChaseRuntimeAttachmentGateResult {
  const blockers: string[] = [];
  const registryProcessIdentity = input?.registryProcessIdentity?.trim();
  const collectorProcessIdentity = input?.collectorProcessIdentity?.trim();

  if (!nonEmpty(registryProcessIdentity) || !nonEmpty(collectorProcessIdentity)) {
    blockers.push("RUNTIME_PROCESS_IDENTITY_REQUIRED");
  } else if (registryProcessIdentity !== collectorProcessIdentity) {
    blockers.push("PROCESS_LOCAL_SELECTOR_REGISTRY_NOT_SHARED");
  }

  const packet = input?.packet;
  const identity = packet?.identity;
  const candidateKey = canonicalCandidateKey(packet);
  if (!identity || !candidateKey || identity.provenance !== "LIVE_RUNTIME_EXACT") {
    blockers.push("EXACT_LIVE_CANDIDATE_PACKET_REQUIRED");
  }

  const ppd = packet?.ppdSupport;
  if (
    !ppd ||
    ppd.source !== "H1_LIVE_PPD_3M_6M_15M_CONTROLLED_EXPANSION" ||
    ppd.provenance !== "LIVE_RUNTIME_EXACT" ||
    ppd.allRequiredWindowsReady !== true ||
    ppd.candidateConfirmed !== true ||
    ppd.windows.length !== 3 ||
    ![3, 6, 15].every((minutes) => ppd.windows.some((window) =>
      window.windowMinutes === minutes &&
      window.usable === true &&
      window.candidateControlledExpansion === true
    )) ||
    ppd.supportingOnly !== true ||
    ppd.standaloneTrigger !== false
  ) blockers.push("APPROVED_PREMIUM_PAIR_EVIDENCE_REQUIRED");

  if (identity && ppd && (
    ppd.symbol !== identity.symbol ||
    ppd.expiryDate !== identity.expiryDate ||
    ppd.strike !== identity.strike ||
    ppd.candidateSide !== identity.side ||
    ppd.observedAt !== identity.observedAt
  )) blockers.push("PREMIUM_PAIR_IDENTITY_OR_TIMESTAMP_MISMATCH");

  const executionGateNames: Array<"capitalFit" | "liquidityOk" | "spreadOk" | "currentOrNearExpiryUsable" | "fallbackDteApproved"> = [
    "capitalFit", "liquidityOk", "spreadOk", "currentOrNearExpiryUsable",
  ];
  if (identity && identity.dte >= 5 && identity.dte <= 7) executionGateNames.push("fallbackDteApproved");
  for (const gateName of executionGateNames) {
    const gate = packet?.gates?.[gateName];
    if (!gate || gate.value !== true || gate.provenance !== "LIVE_RUNTIME_EXACT" || gate.observedAt !== identity?.observedAt) {
      blockers.push(`EXECUTION_GATE_NOT_EXACT_PASS:${gateName}`);
    }
  }

  const canonicalRuntime = input?.canonicalRuntime;
  if (
    !canonicalRuntime ||
    canonicalRuntime.version !== "H1_CANONICAL_LIVE_BUSINESS_RUNTIME_COORDINATOR_V1" ||
    canonicalRuntime.ready !== true ||
    canonicalRuntime.stage !== "READY_FOR_TELEGRAM_TRANSPORT" ||
    canonicalRuntime.sendsTelegram !== false ||
    canonicalRuntime.createsOrders !== false ||
    canonicalRuntime.affectsExecution !== false ||
    canonicalRuntime.failClosed !== true
  ) blockers.push("CANONICAL_LIVE_RUNTIME_NOT_READY");

  const goldBridge = input?.goldBridge;
  if (
    !goldBridge ||
    goldBridge.version !== "H1_GOLD_LIVE_RUNTIME_BRIDGE_V1" ||
    goldBridge.ready !== true ||
    goldBridge.mappedCoreFamilyCount !== 4 ||
    goldBridge.productionImpact !== "NONE" ||
    goldBridge.affectsSelector !== false ||
    goldBridge.affectsTelegram !== false ||
    goldBridge.affectsExecution !== false ||
    goldBridge.grantsPromotionAuthority !== false ||
    goldBridge.createsOrders !== false ||
    goldBridge.failClosed !== true
  ) blockers.push("APPROVED_GOLD_LIVE_BRIDGE_NOT_READY");

  if (identity && goldBridge && (
    goldBridge.symbol !== identity.symbol ||
    goldBridge.side !== identity.side ||
    goldBridge.observedAt !== identity.observedAt
  )) blockers.push("GOLD_BRIDGE_IDENTITY_OR_TIMESTAMP_MISMATCH");

  const bootstrap = input?.bootstrap;
  const adaptedFamilies = bootstrap?.adapted?.families;
  if (
    !bootstrap ||
    bootstrap.version !== "H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1" ||
    bootstrap.state !== "READY_FOR_FORWARD_COLLECTION" ||
    bootstrap.ready !== true ||
    !bootstrap.observationInput ||
    !bootstrap.journal ||
    bootstrap.adapted?.canonicalRootValid !== true ||
    adaptedFamilies?.dataIntegrity !== "PASS" ||
    adaptedFamilies?.premiumPair !== "PASS" ||
    adaptedFamilies?.executionQuality !== "PASS" ||
    bootstrap.shadowCandidate?.state !== "GOLDEN_SHADOW_CANDIDATE" ||
    bootstrap.observation?.state !== "OBSERVABLE" ||
    bootstrap.observation?.readyForForwardCalibration !== true ||
    bootstrap.strictGoldRequired !== false ||
    bootstrap.chasePolicyDefined !== false ||
    bootstrap.outcomeClassificationPolicyDefined !== false ||
    bootstrap.sampleSufficiencyPolicyDefined !== false ||
    bootstrap.productionImpact !== "NONE" ||
    bootstrap.affectsGoldEligibility !== false ||
    bootstrap.affectsSelector !== false ||
    bootstrap.affectsTelegram !== false ||
    bootstrap.affectsExecution !== false ||
    bootstrap.grantsPromotionAuthority !== false ||
    bootstrap.createsOrders !== false ||
    bootstrap.failClosed !== true
  ) blockers.push("SAFE_RESEARCH_BOOTSTRAP_NOT_READY");

  if (bootstrap && candidateKey && (
    bootstrap.candidateKey !== candidateKey ||
    bootstrap.journal?.anchor?.selectedCandidateKey !== candidateKey ||
    bootstrap.journal?.anchor?.decisionId !== bootstrap.decisionId
  )) blockers.push("BOOTSTRAP_FROZEN_IDENTITY_MISMATCH");

  const finalBlockers = unique(blockers);
  return {
    version: H1_GOLD_CHASE_RUNTIME_ATTACHMENT_GATE_V1,
    state: finalBlockers.length === 0 ? "READY_FOR_SAME_PROCESS_SHADOW_ATTACHMENT" : "BLOCKED",
    ready: finalBlockers.length === 0,
    candidateKey,
    decisionId: bootstrap?.decisionId ?? null,
    blockers: finalBlockers,
    ...SAFETY,
  };
}
