import { assembleLiveExecutionCandidateInput, type LiveGateEvidencePacket } from "./h1-live-gate-evidence-assembler.js";
import {
  produceH1LiveSelectorDecisions,
  type H1LiveSelectorEvaluation,
} from "./h1-live-selector-decision-producer.js";
import type { H1ForwardCandidateDecisionInput } from "./h1-forward-candidate-decision-binding.js";

export interface H1LiveSelectorPipelineInput {
  provenance: "LIVE_RUNTIME_EXACT";
  nowIso: string;
  maxAgeMs?: number;
  packets: LiveGateEvidencePacket[];
}

export interface H1LiveSelectorPipelineResult {
  version: "H1_LIVE_SELECTOR_PIPELINE_V1";
  eligibleForLiveH1Marking: boolean;
  decisions: H1ForwardCandidateDecisionInput[];
  evaluations: H1LiveSelectorEvaluation[];
  assembledCount: number;
  blockedCount: number;
  rejected: { index: number; blockers: string[] }[];
  producerRejected: { index: number; reason: string }[];
  failClosed: true;
  semantics: "LIVE_EXACT_ASSEMBLY_THEN_DETERMINISTIC_SELECTOR_ONLY";
}

export function runH1LiveSelectorPipeline(input: unknown): H1LiveSelectorPipelineResult {
  const base = {
    version: "H1_LIVE_SELECTOR_PIPELINE_V1" as const,
    failClosed: true as const,
    semantics: "LIVE_EXACT_ASSEMBLY_THEN_DETERMINISTIC_SELECTOR_ONLY" as const,
  };

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...base, eligibleForLiveH1Marking: false, decisions: [], evaluations: [], assembledCount: 0, blockedCount: 0, rejected: [{ index: -1, blockers: ["INVALID_PIPELINE_INPUT"] }], producerRejected: [] };
  }
  const raw = input as Record<string, unknown>;
  if (raw.provenance !== "LIVE_RUNTIME_EXACT" || typeof raw.nowIso !== "string" || !Array.isArray(raw.packets)) {
    return { ...base, eligibleForLiveH1Marking: false, decisions: [], evaluations: [], assembledCount: 0, blockedCount: 0, rejected: [{ index: -1, blockers: ["LIVE_RUNTIME_EXACT_PIPELINE_INPUT_REQUIRED"] }], producerRejected: [] };
  }

  const maxAgeMs = typeof raw.maxAgeMs === "number" && Number.isFinite(raw.maxAgeMs) && raw.maxAgeMs > 0 ? raw.maxAgeMs : 90_000;
  const candidates: unknown[] = [];
  const rejected: { index: number; blockers: string[] }[] = [];

  raw.packets.forEach((packet, index) => {
    const assembled = assembleLiveExecutionCandidateInput(packet as LiveGateEvidencePacket, raw.nowIso as string, maxAgeMs);
    if (!assembled.ready || !assembled.candidate) {
      rejected.push({ index, blockers: [...assembled.blockers] });
      return;
    }
    candidates.push(assembled.candidate);
  });

  const produced = produceH1LiveSelectorDecisions({ provenance: "LIVE_RUNTIME_EXACT", candidates });
  const eligible = produced.eligibleForLiveH1Marking && produced.rejected.length === 0;

  return {
    ...base,
    eligibleForLiveH1Marking: eligible,
    decisions: eligible ? produced.decisions : [],
    evaluations: eligible ? produced.evaluations : [],
    assembledCount: candidates.length,
    blockedCount: rejected.length,
    rejected,
    producerRejected: [...produced.rejected],
  };
}
