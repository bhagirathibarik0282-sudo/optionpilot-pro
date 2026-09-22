import { runH1LiveSelectorPipeline, type H1LiveSelectorPipelineResult } from "./h1-live-selector-pipeline.js";
import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";
import {
  buildH1LivePpdSupport,
  clearH1LivePpdHistory,
  recordH1LivePpdQuote,
} from "./h1-live-ppd-support-v1.js";
import { bindH1SelectToShadowExecution, type H1SelectShadowExecutionBindingResult } from "./h1-select-shadow-execution-binding.js";
import {
  clearH1ShadowExecutionEvidenceRegistry,
  getH1ShadowExecutionEvidence,
  type H1ShadowExecutionEvidence,
} from "./h1-shadow-execution-evidence-registry.js";
import { canonicalBusinessRuntimeRegistry } from "./canonical-business-runtime-registry.js";
import { dbInsert } from "./db.js";

export const H1_LIVE_SELECTOR_REGISTRY_VERSION = "H1_LIVE_SELECTOR_REGISTRY_V1" as const;
export const H1_LIVE_GATE_EVIDENCE_PERSIST_KIND = "H1_LIVE_GATE_EVIDENCE_PACKET_V1" as const;
export const H1_SELECT_SHADOW_RUNTIME_AUDIT_KIND = "H1_SELECT_SHADOW_RUNTIME_AUDIT_V1" as const;

type RegistryEntry = {
  key: string;
  packet: LiveGateEvidencePacket;
  publishedAtMs: number;
};

const entries = new Map<string, RegistryEntry>();

function validIso(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function packetKey(packet: LiveGateEvidencePacket): string | null {
  const id = packet?.identity;
  if (!id || id.provenance !== "LIVE_RUNTIME_EXACT") return null;
  if (!id.symbol || !id.expiryDate || !id.side || !Number.isFinite(id.strike)) return null;
  return `${id.symbol}|${id.expiryDate}|${id.strike}|${id.side}`;
}

function samePair(a: LiveGateEvidencePacket, b: LiveGateEvidencePacket): boolean {
  return a.identity.symbol === b.identity.symbol
    && a.identity.expiryDate === b.identity.expiryDate
    && a.identity.strike === b.identity.strike;
}

function refreshPpdSupportForPair(packet: LiveGateEvidencePacket): void {
  for (const entry of entries.values()) {
    if (!samePair(entry.packet, packet)) continue;
    const support = buildH1LivePpdSupport(entry.packet.identity);
    // Preserve the exact same-ingest packet object so downstream shadow-only
    // lineage checks can bind PPD evidence without accepting a reconstructed copy.
    if (support) entry.packet.ppdSupport = support;
  }
}

function unavailableExecutionEvidence(): H1ShadowExecutionEvidence {
  return {
    orderBuildDecision: "BLOCK",
    executionRiskDecision: "BLOCK",
    killSwitchDecision: "BLOCK",
    idempotencyDecision: "BLOCK",
    exactContractBound: false,
    evidencePersistenceConfirmed: false,
    brokerSessionReady: false,
  };
}

function auditShadowRuntimeBindings(result: H1LiveSelectorPipelineResult, observedAt: string): void {
  for (const decision of result.decisions) {
    const canonicalConsumer = canonicalBusinessRuntimeRegistry.read(decision.symbol);
    const verifiedEvidence = getH1ShadowExecutionEvidence(
      canonicalConsumer?.decisionId ?? null,
      canonicalConsumer?.candidateKey ?? null,
      observedAt,
    );
    const binding: H1SelectShadowExecutionBindingResult = bindH1SelectToShadowExecution({
      selectorDecision: decision,
      canonicalConsumer,
      authorizationEvidence: verifiedEvidence ?? unavailableExecutionEvidence(),
    });

    void dbInsert(H1_SELECT_SHADOW_RUNTIME_AUDIT_KIND, {
      version: H1_SELECT_SHADOW_RUNTIME_AUDIT_KIND,
      observedAt,
      selectorPipelineVersion: result.version,
      decisionId: binding.decisionId,
      candidateKey: binding.candidateKey,
      selectorDecision: binding.selectorDecision,
      authorizationDecision: binding.authorization.decision,
      authorizationReasonCodes: [...binding.authorization.reasonCodes],
      executionEvidenceState: verifiedEvidence ? "VERIFIED_CURRENT_CANDIDATE_EVIDENCE" : "UNAVAILABLE_FAIL_CLOSED",
      failClosed: true,
      shadowOnly: true,
      placesOrder: false,
      productionImpact: "NONE",
    });
  }
}

export type H1LiveGateEvidencePublisher = (packet: LiveGateEvidencePacket) => { accepted: boolean; reason: string };

function persistGateEvidencePacket(
  packet: LiveGateEvidencePacket,
  key: string,
  selectorSupportingEvidence: boolean,
  calibrationOnly: boolean,
): void {
  void dbInsert(H1_LIVE_GATE_EVIDENCE_PERSIST_KIND, {
    version: H1_LIVE_GATE_EVIDENCE_PERSIST_KIND,
    key,
    publishedAt: packet.identity.observedAt,
    identity: { ...packet.identity },
    gates: Object.fromEntries(Object.entries(packet.gates ?? {}).map(([gate, evidence]) => [gate, evidence ? { ...evidence } : evidence])),
    responseMetrics: packet.responseMetrics ? { ...packet.responseMetrics } : null,
    capitalLiquidityEvidence: packet.capitalLiquidityEvidence ? { ...packet.capitalLiquidityEvidence } : null,
    policyDiagnostics: packet.policyDiagnostics ? {
      premiumDeltaGamma: {
        ...packet.policyDiagnostics.premiumDeltaGamma,
        reasonCodes: [...packet.policyDiagnostics.premiumDeltaGamma.reasonCodes],
      },
      thetaIv: {
        ...packet.policyDiagnostics.thetaIv,
        reasonCodes: [...packet.policyDiagnostics.thetaIv.reasonCodes],
      },
      observedAt: packet.policyDiagnostics.observedAt,
      provenance: packet.policyDiagnostics.provenance,
    } : null,
    ppdSupport: packet.ppdSupport ? {
      ...packet.ppdSupport,
      windows: packet.ppdSupport.windows.map((window) => ({ ...window })),
      reasonCodes: [...packet.ppdSupport.reasonCodes],
    } : null,
    productionImpact: selectorSupportingEvidence ? "SELECTOR_SUPPORTING_EVIDENCE" : "NONE",
    readOnlyEvidencePersistence: true,
    calibrationOnly,
    policyAuthority: calibrationOnly ? "NONE" : "SELECTOR_PATH",
    affectsSelector: selectorSupportingEvidence,
    affectsTelegram: selectorSupportingEvidence,
    affectsVerdict: false,
    affectsExecution: false,
    ppdStandaloneTrigger: false,
  });
}

export const persistH1LiveGateEvidenceCalibrationOnly: H1LiveGateEvidencePublisher = (packet) => {
  const key = packetKey(packet);
  const publishedAtMs = validIso(packet?.identity?.observedAt);
  if (!key || publishedAtMs === null) return { accepted: false, reason: "INVALID_LIVE_GATE_PACKET" };
  persistGateEvidencePacket(packet, key, false, true);
  return { accepted: true, reason: "LIVE_GATE_PACKET_PERSISTED_CALIBRATION_ONLY" };
};

export function publishH1LiveGateEvidence(packet: LiveGateEvidencePacket): { accepted: boolean; reason: string } {
  const key = packetKey(packet);
  const publishedAtMs = validIso(packet?.identity?.observedAt);
  if (!key || publishedAtMs === null) return { accepted: false, reason: "INVALID_LIVE_GATE_PACKET" };

  recordH1LivePpdQuote(packet.identity);
  entries.set(key, { key, packet, publishedAtMs });
  refreshPpdSupportForPair(packet);
  const enrichedPacket = entries.get(key)?.packet ?? packet;
  const ppdCanSupportSelector = enrichedPacket.ppdSupport?.candidateConfirmed === true;

  persistGateEvidencePacket(enrichedPacket, key, ppdCanSupportSelector, false);
  return { accepted: true, reason: "LIVE_GATE_PACKET_ACCEPTED" };
}

export function collectH1LiveSelectorDecisions(nowIso: string, maxAgeMs = 90_000): H1LiveSelectorPipelineResult {
  const nowMs = validIso(nowIso);
  if (nowMs === null) {
    const result = runH1LiveSelectorPipeline({ provenance: "LIVE_RUNTIME_EXACT", nowIso, maxAgeMs, packets: [] });
    auditShadowRuntimeBindings(result, nowIso);
    return result;
  }

  const packets: LiveGateEvidencePacket[] = [];
  for (const [key, entry] of entries) {
    const age = nowMs - entry.publishedAtMs;
    if (age < 0 || age > maxAgeMs) {
      entries.delete(key);
      continue;
    }
    packets.push(entry.packet);
  }

  const result = runH1LiveSelectorPipeline({
    provenance: "LIVE_RUNTIME_EXACT",
    nowIso,
    maxAgeMs,
    packets,
  });
  auditShadowRuntimeBindings(result, nowIso);
  return result;
}

export function collectH1LiveResponseMetrics(nowIso: string, maxAgeMs = 90_000) {
  const nowMs = validIso(nowIso);
  if (nowMs === null) return [];
  const out = [];
  for (const [key, entry] of entries) {
    const age = nowMs - entry.publishedAtMs;
    if (age < 0 || age > maxAgeMs) continue;
    const metrics = entry.packet.responseMetrics;
    if (!metrics || metrics.provenance !== "LIVE_RUNTIME_EXACT") continue;
    out.push({ key, identity: { ...entry.packet.identity }, metrics: { ...metrics } });
  }
  return out;
}

export function collectH1LiveGateEvidenceAudit(nowIso: string, maxAgeMs = 90_000) {
  const nowMs = validIso(nowIso);
  if (nowMs === null) return [];
  const targetGates = ["premiumResponseConfirmed", "deltaGammaResponseConfirmed", "thetaIvBurdenAcceptable"] as const;
  const out = [];
  for (const [key, entry] of entries) {
    const ageMs = nowMs - entry.publishedAtMs;
    if (ageMs < 0 || ageMs > maxAgeMs) continue;
    const gateEvidence = Object.fromEntries(targetGates.map((gate) => {
      const evidence = entry.packet.gates?.[gate];
      return [gate, evidence ? {
        value: evidence.value,
        source: evidence.source,
        observedAt: evidence.observedAt,
        provenance: evidence.provenance,
      } : null];
    }));
    const metrics = entry.packet.responseMetrics;
    const policyDiagnostics = entry.packet.policyDiagnostics;
    const ppdSupport = entry.packet.ppdSupport;
    out.push({
      key,
      ageMs,
      identity: { ...entry.packet.identity },
      gates: gateEvidence,
      responseMetrics: metrics ? { ...metrics } : null,
      capitalLiquidityEvidence: entry.packet.capitalLiquidityEvidence ? { ...entry.packet.capitalLiquidityEvidence } : null,
      policyDiagnostics: policyDiagnostics ? {
        premiumDeltaGamma: {
          ...policyDiagnostics.premiumDeltaGamma,
          reasonCodes: [...policyDiagnostics.premiumDeltaGamma.reasonCodes],
        },
        thetaIv: {
          ...policyDiagnostics.thetaIv,
          reasonCodes: [...policyDiagnostics.thetaIv.reasonCodes],
        },
        observedAt: policyDiagnostics.observedAt,
        provenance: policyDiagnostics.provenance,
      } : null,
      ppdSupport: ppdSupport ? {
        ...ppdSupport,
        windows: ppdSupport.windows.map((window) => ({ ...window })),
        reasonCodes: [...ppdSupport.reasonCodes],
      } : null,
    });
  }
  return out;
}

export function clearH1LiveSelectorRegistry(): void {
  entries.clear();
  clearH1LivePpdHistory();
  clearH1ShadowExecutionEvidenceRegistry();
}

export function getH1LiveSelectorRegistrySize(): number {
  return entries.size;
}
