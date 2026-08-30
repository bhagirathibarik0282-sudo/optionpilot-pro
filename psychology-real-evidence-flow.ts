import type { CandidateHistoryRecord } from "./candidate-history-record.ts";
import type { ReplayObservation } from "./h1-replay-guard.ts";
import type { ShadowValidationRegimeEvidence } from "./psychology-regime-evidence.ts";
import {
  preparePsychologyEvidenceCollectionCandidate,
  type PsychologyEvidenceCollectionResult,
} from "./psychology-real-evidence-collector.ts";
import {
  buildPsychologyRetrospectiveOutcomeEvents,
  type PsychologyRetrospectiveOutcomeEvidenceInput,
} from "./psychology-retrospective-outcome-evidence.ts";
import type { PsychologyValidationSource } from "./psychology-shadow-replay-adapter.ts";
import type { ShadowValidationRegime } from "./psychology-shadow-validation.ts";
import {
  aggregatePsychologyValidationEvents,
  type PsychologyValidationEvent,
  type PsychologyValidationEventSource,
} from "./psychology-validation-event-aggregator.ts";
import {
  projectPsychologyValidationEvents,
  type PsychologyValidationEventSourceBridgeInput,
} from "./psychology-validation-event-source-bridge.ts";

export interface PsychologyRealEvidenceFlowInput {
  candidate: CandidateHistoryRecord;
  replay: ReplayObservation;
  validationSource: Exclude<PsychologyValidationSource, "SYNTHETIC">;
  evaluationCutoffAt: string;
  recordedAt: string;
  regimes: ShadowValidationRegime[];
  regimeEvidence: ShadowValidationRegimeEvidence[];
  direct: readonly PsychologyValidationEventSourceBridgeInput[];
  retrospective: PsychologyRetrospectiveOutcomeEvidenceInput | null;
}

export interface PsychologyRealEvidenceFlowResult {
  version: "PSYCHOLOGY_REAL_EVIDENCE_FLOW_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  candidateId: string;
  status: "READY_TO_PERSIST" | "BLOCKED";
  collection: PsychologyEvidenceCollectionResult | null;
  directEventCount: number;
  retrospectiveEventCount: number;
  totalEventCount: number;
  unresolvedSources: string[];
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function validIso(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function expectedEventSource(source: Exclude<PsychologyValidationSource, "SYNTHETIC">): PsychologyValidationEventSource {
  return source === "REAL_REPLAY" ? "DETERMINISTIC_REPLAY" : "DETERMINISTIC_LIVE";
}

function blocked(candidateId: string, blockers: string[], unresolvedSources: string[] = []): PsychologyRealEvidenceFlowResult {
  return {
    version: "PSYCHOLOGY_REAL_EVIDENCE_FLOW_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    candidateId,
    status: "BLOCKED",
    collection: null,
    directEventCount: 0,
    retrospectiveEventCount: 0,
    totalEventCount: 0,
    unresolvedSources: [...new Set(unresolvedSources)],
    blockers: [...new Set(blockers)],
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}

function compareDirectContract(candidate: CandidateHistoryRecord, direct: PsychologyValidationEventSourceBridgeInput): string[] {
  const blockers: string[] = [];
  if (candidate.symbol.trim().toUpperCase() !== direct.candidate.symbol.trim().toUpperCase()) blockers.push("DIRECT_SYMBOL_MISMATCH");
  if (candidate.side !== direct.candidate.side) blockers.push("DIRECT_SIDE_MISMATCH");
  if (candidate.strike !== direct.candidate.strike) blockers.push("DIRECT_STRIKE_MISMATCH");
  if (candidate.expiry !== direct.candidate.expiryDate) blockers.push("DIRECT_EXPIRY_MISMATCH");
  return blockers;
}

/**
 * End-to-end research-only composition for psychology evidence. It joins an ordered sequence of
 * direct deterministic shadow-chain transitions with separately verified retrospective outcome
 * adjudications, aggregates the frozen counters, passes the canonical replay/live guard, and
 * prepares (but never persists) the trusted real-evidence record. Missing retrospective
 * adjudications remain explicit unresolved sources; they are never converted into zero-valued
 * facts by this layer.
 */
export function preparePsychologyRealEvidenceFlow(input: PsychologyRealEvidenceFlowInput): PsychologyRealEvidenceFlowResult {
  const blockers: string[] = [];
  const unresolvedSources: string[] = [];
  const candidateId = input.candidate.candidateId.trim();
  const expectedSource = expectedEventSource(input.validationSource);

  if (!candidateId) blockers.push("CANDIDATE_ID_MISSING");
  if (!validIso(input.evaluationCutoffAt)) blockers.push("EVALUATION_CUTOFF_INVALID");
  if (!validIso(input.recordedAt)) blockers.push("RECORDED_AT_INVALID");
  if (!validIso(input.replay.decisionAt)) blockers.push("REPLAY_DECISION_AT_INVALID");
  if (validIso(input.recordedAt) && validIso(input.evaluationCutoffAt)
      && Date.parse(input.recordedAt) < Date.parse(input.evaluationCutoffAt)) {
    blockers.push("RECORDED_AT_BEFORE_EVALUATION_CUTOFF");
  }

  if (!input.replay.expiry) blockers.push("REPLAY_EXPIRY_MISSING");
  if (input.replay.dte == null) blockers.push("REPLAY_DTE_MISSING");
  if (!input.replay.tradingDate) blockers.push("REPLAY_TRADING_DATE_MISSING");
  if (input.replay.logicalKey.trim() !== candidateId) blockers.push("REPLAY_CANDIDATE_ID_MISMATCH");

  if (!Array.isArray(input.direct) || input.direct.length === 0) blockers.push("DIRECT_SEQUENCE_MISSING");
  let previousObservedMs: number | null = null;
  let previousCurrentFingerprint: string | null = null;
  for (let index = 0; index < input.direct.length; index += 1) {
    const direct = input.direct[index];
    blockers.push(...compareDirectContract(input.candidate, direct).map((item) => `${item}:${index}`));
    if (direct.tradeId.trim() !== candidateId) blockers.push(`DIRECT_TRADE_ID_MISMATCH:${index}`);
    if (direct.source !== expectedSource) blockers.push(`DIRECT_EVENT_SOURCE_MISMATCH:${index}`);
    if (!validIso(direct.observedAt)) blockers.push(`DIRECT_OBSERVED_AT_INVALID:${index}`);
    else {
      const observedMs = Date.parse(direct.observedAt);
      if (validIso(input.replay.decisionAt) && observedMs < Date.parse(input.replay.decisionAt)) blockers.push(`DIRECT_OBSERVED_BEFORE_REPLAY_DECISION:${index}`);
      if (validIso(input.evaluationCutoffAt) && observedMs > Date.parse(input.evaluationCutoffAt)) blockers.push(`DIRECT_OBSERVED_AFTER_EVALUATION_CUTOFF:${index}`);
      if (previousObservedMs != null && observedMs <= previousObservedMs) blockers.push(`DIRECT_SEQUENCE_NOT_STRICTLY_CHRONOLOGICAL:${index}`);
      previousObservedMs = observedMs;
    }

    if (index > 0) {
      if (!direct.previous) blockers.push(`DIRECT_SEQUENCE_PREVIOUS_MISSING:${index}`);
      else if (previousCurrentFingerprint !== null && direct.previous.currentFingerprint !== previousCurrentFingerprint) {
        blockers.push(`DIRECT_SEQUENCE_CONTINUITY_MISMATCH:${index}`);
      }
    }
    previousCurrentFingerprint = direct.current.currentFingerprint;
  }

  if (input.retrospective) {
    if (input.retrospective.tradeId.trim() !== candidateId) blockers.push("RETROSPECTIVE_TRADE_ID_MISMATCH");
    if (input.retrospective.eventSource !== expectedSource) blockers.push("RETROSPECTIVE_EVENT_SOURCE_MISMATCH");
    if (input.retrospective.evaluationCutoffAt !== input.evaluationCutoffAt) blockers.push("RETROSPECTIVE_EVALUATION_CUTOFF_MISMATCH");
    for (const evidence of input.retrospective.adjudications) {
      if (evidence.source !== expectedSource) blockers.push(`RETROSPECTIVE_EVIDENCE_SOURCE_MISMATCH:${evidence.kind}`);
    }
  } else {
    unresolvedSources.push("RETROSPECTIVE_OUTCOME_EVIDENCE_NOT_SUPPLIED");
  }

  if (blockers.length > 0) return blocked(candidateId, blockers, unresolvedSources);

  const directEvents: PsychologyValidationEvent[] = [];
  for (let index = 0; index < input.direct.length; index += 1) {
    const direct = projectPsychologyValidationEvents(input.direct[index]);
    if (direct.status !== "READY") blockers.push(...direct.blockers.map((item) => `DIRECT_${index}_${item}`));
    else directEvents.push(...direct.events);
  }

  let retrospectiveEvents: PsychologyValidationEvent[] = [];
  if (input.retrospective) {
    const retrospective = buildPsychologyRetrospectiveOutcomeEvents(input.retrospective);
    if (retrospective.status !== "READY") blockers.push(...retrospective.blockers.map((item) => `RETROSPECTIVE_${item}`));
    else {
      retrospectiveEvents = retrospective.events;
      unresolvedSources.push(...retrospective.unresolvedSources);
    }
  }

  if (blockers.length > 0) return blocked(candidateId, blockers, unresolvedSources);

  const events = [...directEvents, ...retrospectiveEvents];
  if (validIso(input.replay.decisionAt)) {
    const decisionMs = Date.parse(input.replay.decisionAt);
    for (const event of events) {
      if (validIso(event.observedAt) && Date.parse(event.observedAt) < decisionMs) blockers.push(`EVENT_BEFORE_REPLAY_DECISION:${event.kind}`);
      if (event.source !== expectedSource) blockers.push(`EVENT_SOURCE_MISMATCH:${event.kind}`);
    }
  }

  if (blockers.length > 0) return blocked(candidateId, blockers, unresolvedSources);

  const aggregation = aggregatePsychologyValidationEvents({
    tradeId: candidateId,
    evaluationCutoffAt: input.evaluationCutoffAt,
    replayDecisionAt: input.replay.decisionAt,
    regimes: input.regimes,
    regimeEvidence: input.regimeEvidence,
    events,
  });
  if (aggregation.status !== "READY" || !aggregation.observation) {
    return blocked(candidateId, aggregation.blockers.map((item) => `AGGREGATION_${item}`), unresolvedSources);
  }

  const collection = preparePsychologyEvidenceCollectionCandidate({
    candidate: input.candidate,
    input: {
      source: input.validationSource,
      replay: input.replay,
      validation: aggregation.observation,
    },
    recordedAt: input.recordedAt,
  });

  if (collection.status !== "READY_TO_PERSIST") {
    return blocked(candidateId, collection.blockers.map((item) => `COLLECTION_${item}`), unresolvedSources);
  }

  return {
    version: "PSYCHOLOGY_REAL_EVIDENCE_FLOW_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    candidateId,
    status: "READY_TO_PERSIST",
    collection,
    directEventCount: directEvents.length,
    retrospectiveEventCount: retrospectiveEvents.length,
    totalEventCount: events.length,
    unresolvedSources: [...new Set(unresolvedSources)],
    blockers: [],
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
