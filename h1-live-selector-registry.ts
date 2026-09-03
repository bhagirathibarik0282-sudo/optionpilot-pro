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

export function clearH1LiveSelectorRegistry(): void {
  entries.clear();
}

export function getH1LiveSelectorRegistrySize(): number {
  return entries.size;
}
