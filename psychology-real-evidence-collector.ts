import type { CandidateHistoryRecord } from "./candidate-history-record.ts";
import { preparePsychologyRealEvidenceForStorage, type StoredPsychologyRealEvidence } from "./psychology-real-evidence-store.ts";
import { validateShadowValidationRegimeEvidence } from "./psychology-regime-evidence.ts";
import { adaptPsychologyValidationEvidence, type PsychologyReplayValidationInput } from "./psychology-shadow-replay-adapter.ts";
import { validatePsychologyShadowObservations } from "./psychology-shadow-validation.ts";

export interface PsychologyEvidenceCollectionCandidate {
  candidate: CandidateHistoryRecord;
  input: PsychologyReplayValidationInput;
  recordedAt: string;
}

export type PsychologyEvidenceCollectionStatus = "READY_TO_PERSIST" | "BLOCKED";

export interface PsychologyEvidenceCollectionResult {
  version: "PSYCHOLOGY_REAL_EVIDENCE_COLLECTOR_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  candidateId: string;
  status: PsychologyEvidenceCollectionStatus;
  record: StoredPsychologyRealEvidence | null;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

export interface PsychologyEvidenceCollectionBatchResult {
  version: "PSYCHOLOGY_REAL_EVIDENCE_COLLECTOR_BATCH_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  total: number;
  ready: number;
  blocked: number;
  results: PsychologyEvidenceCollectionResult[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function validIso(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

/**
 * Fail-closed bridge from an observed candidate-history row into the trusted psychology
 * real-evidence store contract. This collector deliberately does not derive psychology
 * counters or regime labels from candidate history: those facts must already be supplied
 * by deterministic upstream/replay instrumentation and pass their canonical validators.
 */
export function preparePsychologyEvidenceCollectionCandidate(
  request: PsychologyEvidenceCollectionCandidate,
): PsychologyEvidenceCollectionResult {
  const blockers: string[] = [];
  const candidateId = request.candidate.candidateId.trim();
  const tradeId = request.input.validation.tradeId.trim();
  const replayKey = request.input.replay.logicalKey.trim();

  if (!candidateId) blockers.push("CANDIDATE_ID_MISSING");
  if (request.candidate.status !== "OBSERVED") blockers.push(`CANDIDATE_NOT_OBSERVED:${request.candidate.status}`);
  if (candidateId !== tradeId) blockers.push("CANDIDATE_VALIDATION_TRADE_ID_MISMATCH");
  if (candidateId !== replayKey) blockers.push("CANDIDATE_REPLAY_KEY_MISMATCH");

  if (!validIso(request.candidate.observedAt)) blockers.push("CANDIDATE_OBSERVED_AT_INVALID");
  if (!validIso(request.input.replay.decisionAt)) blockers.push("REPLAY_DECISION_AT_INVALID");
  if (validIso(request.candidate.observedAt) && validIso(request.input.replay.decisionAt)
      && Date.parse(request.candidate.observedAt) > Date.parse(request.input.replay.decisionAt)) {
    blockers.push("CANDIDATE_OBSERVED_AFTER_DECISION");
  }

  if (request.candidate.expiry !== null && request.input.replay.expiry !== null
      && request.candidate.expiry !== request.input.replay.expiry) {
    blockers.push("CANDIDATE_REPLAY_EXPIRY_MISMATCH");
  }

  const admitted = adaptPsychologyValidationEvidence(request.input);
  if (!admitted.accepted || !admitted.observation) blockers.push(...admitted.blockers);

  if (admitted.observation) {
    try {
      validatePsychologyShadowObservations([admitted.observation]);
    } catch (error) {
      blockers.push(`VALIDATION_INPUT_INVALID:${error instanceof Error ? error.message : String(error)}`);
    }

    const provenance = validateShadowValidationRegimeEvidence(
      admitted.observation.regimeEvidence,
      request.input.replay.decisionAt,
      admitted.observation.regimes,
    );
    if (!provenance.valid) blockers.push(...provenance.blockers);
  }

  if (blockers.length > 0) {
    return {
      version: "PSYCHOLOGY_REAL_EVIDENCE_COLLECTOR_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      candidateId,
      status: "BLOCKED",
      record: null,
      blockers: [...new Set(blockers)],
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  const record = preparePsychologyRealEvidenceForStorage(request.input, request.recordedAt);
  if (!record) {
    return {
      version: "PSYCHOLOGY_REAL_EVIDENCE_COLLECTOR_V1",
      semantics: "RESEARCH_SHADOW_ONLY",
      candidateId,
      status: "BLOCKED",
      record: null,
      blockers: ["REAL_EVIDENCE_STORE_PREPARATION_REJECTED"],
      affectsTelegram: false,
      affectsVerdict: false,
      affectsExecution: false,
    };
  }

  return {
    version: "PSYCHOLOGY_REAL_EVIDENCE_COLLECTOR_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    candidateId,
    status: "READY_TO_PERSIST",
    record,
    blockers: [],
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}

export function preparePsychologyEvidenceCollectionBatch(
  requests: readonly PsychologyEvidenceCollectionCandidate[],
): PsychologyEvidenceCollectionBatchResult {
  const results = requests.map(preparePsychologyEvidenceCollectionCandidate);
  const ready = results.filter((result) => result.status === "READY_TO_PERSIST").length;
  return {
    version: "PSYCHOLOGY_REAL_EVIDENCE_COLLECTOR_BATCH_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    total: results.length,
    ready,
    blocked: results.length - ready,
    results,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
