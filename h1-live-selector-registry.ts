import { runH1LiveSelectorPipeline, type H1LiveSelectorPipelineResult } from "./h1-live-selector-pipeline.js";
import type { LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";

export const H1_LIVE_SELECTOR_REGISTRY_VERSION = "H1_LIVE_SELECTOR_REGISTRY_V1" as const;

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

export function publishH1LiveGateEvidence(packet: LiveGateEvidencePacket): { accepted: boolean; reason: string } {
  const key = packetKey(packet);
  const publishedAtMs = validIso(packet?.identity?.observedAt);
  if (!key || publishedAtMs === null) return { accepted: false, reason: "INVALID_LIVE_GATE_PACKET" };
  entries.set(key, { key, packet, publishedAtMs });
  return { accepted: true, reason: "LIVE_GATE_PACKET_ACCEPTED" };
}

export function collectH1LiveSelectorDecisions(nowIso: string, maxAgeMs = 90_000): H1LiveSelectorPipelineResult {
  const nowMs = validIso(nowIso);
  if (nowMs === null) {
    return runH1LiveSelectorPipeline({ provenance: "LIVE_RUNTIME_EXACT", nowIso, maxAgeMs, packets: [] });
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

  return runH1LiveSelectorPipeline({
    provenance: "LIVE_RUNTIME_EXACT",
    nowIso,
    maxAgeMs,
    packets,
  });
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
}

export function getH1LiveSelectorRegistrySize(): number {
  return entries.size;
}
