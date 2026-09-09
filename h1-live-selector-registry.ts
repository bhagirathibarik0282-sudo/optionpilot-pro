import { runH1LiveSelectorPipeline, type H1LiveSelectorPipelineResult } from "./h1-live-selector-pipeline.js";
import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";
import { bindH1SelectToShadowExecution, type H1SelectShadowExecutionBindingResult } from "./h1-select-shadow-execution-binding.js";
import {
  clearH1ShadowExecutionEvidenceRegistry,
  getH1ShadowExecutionEvidence,
  type H1ShadowExecutionEvidence,
} from "./h1-shadow-execution-evidence-registry.js";
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

function selectorCandidateKey(decision: H1LiveSelectorPipelineResult["decisions"][number]): string | null {
  if (!decision?.symbol || !decision.expiry || !Number.isFinite(decision.strike) || (decision.side !== "CE" && decision.side !== "PE")) return null;
  return `${decision.symbol.toUpperCase()}|${decision.expiry}|${decision.strike}|${decision.side}`;
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
    const candidateKey = selectorCandidateKey(decision);
    const verifiedEvidence = getH1ShadowExecutionEvidence(candidateKey, observedAt);
    const binding: H1SelectShadowExecutionBindingResult = bindH1SelectToShadowExecution({
      selectorDecision: decision,
      authorizationEvidence: verifiedEvidence ?? unavailableExecutionEvidence(),
    });

    void dbInsert(H1_SELECT_SHADOW_RUNTIME_AUDIT_KIND, {
      version: H1_SELECT_SHADOW_RUNTIME_AUDIT_KIND,
      observedAt,
      selectorPipelineVersion: result.version,
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

export function publishH1LiveGateEvidence(packet: LiveGateEvidencePacket): { accepted: boolean; reason: string } {
  const key = packetKey(packet);
  const publishedAtMs = validIso(packet?.identity?.observedAt);
  if (!key || publishedAtMs === null) return { accepted: false, reason: "INVALID_LIVE_GATE_PACKET" };
  entries.set(key, { key, packet, publishedAtMs });
  void dbInsert(H1_LIVE_GATE_EVIDENCE_PERSIST_KIND, {
    version: H1_LIVE_GATE_EVIDENCE_PERSIST_KIND,
    key,
    publishedAt: packet.identity.observedAt,
    identity: { ...packet.identity },
    gates: Object.fromEntries(Object.entries(packet.gates ?? {}).map(([gate, evidence]) => [gate, evidence ? { ...evidence } : evidence])),
    responseMetrics: packet.responseMetrics ? { ...packet.responseMetrics } : null,
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
    productionImpact: "NONE",
    readOnlyEvidencePersistence: true,
    affectsSelector: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  });
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
    out.push({
      key,
      ageMs,
      identity: { ...entry.packet.identity },
      gates: gateEvidence,
      responseMetrics: metrics ? { ...metrics } : null,
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
    });
  }
  return out;
}

export function clearH1LiveSelectorRegistry(): void {
  entries.clear();
  clearH1ShadowExecutionEvidenceRegistry();
}

export function getH1LiveSelectorRegistrySize(): number {
  return entries.size;
}
