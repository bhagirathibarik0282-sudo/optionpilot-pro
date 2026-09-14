import { buildCanonicalBusinessEvidenceInputs } from "./canonical-business-evidence-input-adapter.js";
import {
  scoreCanonicalBusinessEvidence,
  type CanonicalBusinessDeterministicScoringResult,
} from "./canonical-business-deterministic-scoring.js";
import {
  promoteCanonicalBusinessCandidate,
  type CanonicalBusinessCandidateMissionResult,
} from "./canonical-business-candidate-mission.js";
import type { CanonicalLiveShadowSnapshotSourceResult } from "./canonical-live-shadow-snapshot-source.js";
import {
  produceCanonicalNormalizedFamilySupport,
  type CanonicalDeterministicFamilySignal,
  type CanonicalNormalizedFamilySupportResult,
} from "./canonical-normalized-family-support-producer.js";
import type { BusinessHorizon } from "./business-buyer-seller-layer.js";
import type { H1LiveSelectorEvaluation } from "./h1-live-selector-decision-producer.js";

export const CANONICAL_BUSINESS_MISSION_ORCHESTRATOR_V1 = "CANONICAL_BUSINESS_MISSION_ORCHESTRATOR_V1" as const;

export interface CanonicalBusinessMissionOrchestratorInput {
  provenance: "LIVE_CANONICAL_MISSION_ORCHESTRATOR_V1";
  decisionId: string;
  nowMs: number;
  maxAgeMs?: number;
  telegramHorizon: BusinessHorizon;
  source: CanonicalLiveShadowSnapshotSourceResult;
  familySignals: CanonicalDeterministicFamilySignal[];
  evaluations: H1LiveSelectorEvaluation[];
}

export interface CanonicalBusinessMissionOrchestratorResult {
  version: typeof CANONICAL_BUSINESS_MISSION_ORCHESTRATOR_V1;
  ready: boolean;
  stage: "INPUT" | "EVIDENCE_ADAPTER" | "NORMALIZATION" | "SCORING" | "MISSION_GATE" | "READY_FOR_TELEGRAM_TRANSPORT";
  snapshotId: string | null;
  decisionId: string | null;
  candidateKey: string | null;
  blockers: string[];
  normalization: CanonicalNormalizedFamilySupportResult | null;
  scoring: CanonicalBusinessDeterministicScoringResult | null;
  mission: CanonicalBusinessCandidateMissionResult | null;
  publishesCanonicalCandidate: boolean;
  sendsTelegram: false;
  createsOrders: false;
  affectsExecution: false;
  aiMayOverride: false;
  failClosed: true;
}

const SAFETY = {
  sendsTelegram: false as const,
  createsOrders: false as const,
  affectsExecution: false as const,
  aiMayOverride: false as const,
  failClosed: true as const,
};

function result(
  stage: CanonicalBusinessMissionOrchestratorResult["stage"],
  blockers: string[],
  input?: {
    snapshotId?: string | null;
    decisionId?: string | null;
    normalization?: CanonicalNormalizedFamilySupportResult | null;
    scoring?: CanonicalBusinessDeterministicScoringResult | null;
    mission?: CanonicalBusinessCandidateMissionResult | null;
  },
): CanonicalBusinessMissionOrchestratorResult {
  const mission = input?.mission ?? null;
  const ready = stage === "READY_FOR_TELEGRAM_TRANSPORT" && mission?.ready === true;
  return {
    version: CANONICAL_BUSINESS_MISSION_ORCHESTRATOR_V1,
    ready,
    stage,
    snapshotId: ready ? (input?.snapshotId ?? null) : null,
    decisionId: ready ? (input?.decisionId ?? null) : null,
    candidateKey: ready ? (mission?.candidateKey ?? null) : null,
    blockers: [...new Set(blockers)],
    normalization: input?.normalization ?? null,
    scoring: input?.scoring ?? null,
    mission,
    publishesCanonicalCandidate: ready,
    ...SAFETY,
  };
}

/**
 * One strict deterministic path from an already-assembled canonical live
 * snapshot to the shared Dashboard/Telegram candidate registry.
 *
 * This orchestrator never reads opaque payloads, invents a family direction,
 * ranks contracts, sends Telegram, or creates broker orders. Each of the ten
 * family engines must provide its explicit verified directional-support
 * contract before the sole execution selector can be promoted.
 */
export function runCanonicalBusinessMission(
  input: CanonicalBusinessMissionOrchestratorInput,
): CanonicalBusinessMissionOrchestratorResult {
  if (
    input?.provenance !== "LIVE_CANONICAL_MISSION_ORCHESTRATOR_V1"
    || typeof input.decisionId !== "string"
    || !input.decisionId.trim()
    || !Number.isFinite(input.nowMs)
    || input.nowMs <= 0
    || !Array.isArray(input.familySignals)
    || !Array.isArray(input.evaluations)
  ) {
    return result("INPUT", ["INVALID_ORCHESTRATOR_INPUT"]);
  }

  const evidence = buildCanonicalBusinessEvidenceInputs(input.source);
  const snapshot = input.source?.snapshot;
  if (!evidence.ready || !snapshot) {
    return result("EVIDENCE_ADAPTER", [
      "CANONICAL_BUSINESS_EVIDENCE_NOT_READY",
      ...evidence.blockers,
      ...(input.source?.blockers ?? []).map((blocker) => `SOURCE_${blocker}`),
    ]);
  }

  const normalization = produceCanonicalNormalizedFamilySupport({
    businessEvidence: evidence,
    familySignals: input.familySignals,
  });
  if (!normalization.ready) {
    return result("NORMALIZATION", normalization.blockers, {
      normalization,
    });
  }

  const scoring = scoreCanonicalBusinessEvidence({
    businessEvidence: evidence,
    normalizedEvidence: normalization.normalizedEvidence,
  });
  if (!scoring.ready) {
    return result("SCORING", scoring.blockers, {
      normalization,
      scoring,
    });
  }

  const mission = promoteCanonicalBusinessCandidate({
    provenance: "LIVE_CANONICAL_BUSINESS_MISSION_V1",
    snapshotId: snapshot.snapshotId,
    decisionId: input.decisionId.trim(),
    snapshotAsOfMs: snapshot.asOfMs,
    nowMs: input.nowMs,
    maxAgeMs: input.maxAgeMs,
    telegramHorizon: input.telegramHorizon,
    businessEvidence: evidence,
    scoring,
    evaluations: input.evaluations,
  });
  if (!mission.ready) {
    return result("MISSION_GATE", mission.blockers, {
      normalization,
      scoring,
      mission,
    });
  }

  return result("READY_FOR_TELEGRAM_TRANSPORT", [], {
    snapshotId: snapshot.snapshotId,
    decisionId: input.decisionId.trim(),
    normalization,
    scoring,
    mission,
  });
}
