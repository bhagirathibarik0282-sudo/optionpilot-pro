import type { H1OutcomeAttribution } from "./h1-outcome-attribution.ts";
import type { PsychologyValidationEvent, PsychologyValidationEventSource } from "./psychology-validation-event-aggregator.ts";

export type RetrospectiveEvidenceSource = "DETERMINISTIC_REPLAY" | "DETERMINISTIC_LIVE";

export interface CandidateOutcomeBinding {
  tradeId: string;
  outcomeId: string;
  source: "DETERMINISTIC_OUTCOME_BINDING";
  ruleVersion: string;
}

interface RetrospectiveEvidenceBase {
  evidenceId: string;
  tradeId: string;
  observedAt: string;
  source: RetrospectiveEvidenceSource;
  ruleVersion: string;
}

export type PsychologyRetrospectiveAdjudication =
  | (RetrospectiveEvidenceBase & { kind: "CHASE_WARNING_ADJUDICATED"; falseWarning: boolean })
  | (RetrospectiveEvidenceBase & { kind: "LATE_EXIT_ADJUDICATED"; priorExitOrProtectWarning: boolean })
  | (RetrospectiveEvidenceBase & { kind: "THESIS_FAILURE_ADJUDICATED"; priorThesisWarning: boolean })
  | (RetrospectiveEvidenceBase & { kind: "SIDE_FLIP_ADJUDICATED"; freshDeterministicSetup: boolean })
  | (RetrospectiveEvidenceBase & { kind: "PROFIT_PROTECTION_ADJUDICATED"; useful: boolean });

export interface PsychologyRetrospectiveOutcomeEvidenceInput {
  tradeId: string;
  evaluationCutoffAt: string;
  eventSource: PsychologyValidationEventSource;
  eventRuleVersion: string;
  binding: CandidateOutcomeBinding;
  outcome: H1OutcomeAttribution;
  adjudications: readonly PsychologyRetrospectiveAdjudication[];
}

export interface PsychologyRetrospectiveOutcomeEvidenceResult {
  version: "PSYCHOLOGY_RETROSPECTIVE_OUTCOME_EVIDENCE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: "READY" | "BLOCKED";
  events: PsychologyValidationEvent[];
  blockers: string[];
  unresolvedSources: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function validIso(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function blocked(blockers: string[]): PsychologyRetrospectiveOutcomeEvidenceResult {
  return {
    version: "PSYCHOLOGY_RETROSPECTIVE_OUTCOME_EVIDENCE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status: "BLOCKED",
    events: [],
    blockers: [...new Set(blockers)],
    unresolvedSources: [],
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}

/**
 * Converts only verified outcome truth and separately deterministic retrospective adjudications
 * into the deferred psychology validation events. No metric threshold is invented here.
 * STOP_HIT is the only deferred fact that the existing Outcome Engine can prove directly.
 */
export function buildPsychologyRetrospectiveOutcomeEvents(
  input: PsychologyRetrospectiveOutcomeEvidenceInput,
): PsychologyRetrospectiveOutcomeEvidenceResult {
  const blockers: string[] = [];
  const tradeId = input.tradeId.trim();
  const seenEvidenceIds = new Set<string>();

  if (!tradeId) blockers.push("TRADE_ID_MISSING");
  if (!validIso(input.evaluationCutoffAt)) blockers.push("EVALUATION_CUTOFF_INVALID");
  if (input.eventSource !== "DETERMINISTIC_REPLAY" && input.eventSource !== "DETERMINISTIC_LIVE") blockers.push("EVENT_SOURCE_UNSUPPORTED");
  if (!input.eventRuleVersion.trim()) blockers.push("EVENT_RULE_VERSION_MISSING");

  if (input.binding.tradeId.trim() !== tradeId) blockers.push("OUTCOME_BINDING_TRADE_ID_MISMATCH");
  if (input.binding.outcomeId.trim() !== input.outcome.outcomeId.trim()) blockers.push("OUTCOME_BINDING_OUTCOME_ID_MISMATCH");
  if (input.binding.source !== "DETERMINISTIC_OUTCOME_BINDING") blockers.push("OUTCOME_BINDING_SOURCE_UNSUPPORTED");
  if (!input.binding.ruleVersion.trim()) blockers.push("OUTCOME_BINDING_RULE_VERSION_MISSING");
  if (!input.outcome.terminal) blockers.push("OUTCOME_NOT_TERMINAL");
  if (input.outcome.semantics !== "VERIFIED_OUTCOME_ATTRIBUTION_ONLY") blockers.push("OUTCOME_SEMANTICS_UNTRUSTED");

  for (const evidence of input.adjudications) {
    const evidenceId = evidence.evidenceId.trim();
    if (!evidenceId) blockers.push(`EVIDENCE_ID_MISSING:${evidence.kind}`);
    else if (seenEvidenceIds.has(evidenceId)) blockers.push(`DUPLICATE_EVIDENCE_ID:${evidenceId}`);
    else seenEvidenceIds.add(evidenceId);

    if (evidence.tradeId.trim() !== tradeId) blockers.push(`EVIDENCE_TRADE_ID_MISMATCH:${evidence.kind}`);
    if (evidence.source !== "DETERMINISTIC_REPLAY" && evidence.source !== "DETERMINISTIC_LIVE") blockers.push(`EVIDENCE_SOURCE_UNSUPPORTED:${evidence.kind}`);
    if (!evidence.ruleVersion.trim()) blockers.push(`EVIDENCE_RULE_VERSION_MISSING:${evidence.kind}`);
    if (!validIso(evidence.observedAt)) blockers.push(`EVIDENCE_TIMESTAMP_INVALID:${evidence.kind}`);
    else if (validIso(input.evaluationCutoffAt) && Date.parse(evidence.observedAt) > Date.parse(input.evaluationCutoffAt)) {
      blockers.push(`EVIDENCE_AFTER_EVALUATION_CUTOFF:${evidence.kind}`);
    }
  }

  if (blockers.length > 0) return blocked(blockers);

  const events: PsychologyValidationEvent[] = [];
  const makeBase = (eventId: string, observedAt: string) => ({
    eventId,
    tradeId,
    observedAt,
    source: input.eventSource,
    ruleVersion: input.eventRuleVersion,
  } as const);

  if (input.outcome.status === "STOP_HIT") {
    const observedAt = validIso(input.outcome.incompleteReason ?? "")
      ? input.outcome.incompleteReason as string
      : input.evaluationCutoffAt;
    events.push({
      ...makeBase(`${tradeId}:${input.outcome.outcomeId}:STOPPED_TRADE`, observedAt),
      kind: "STOPPED_TRADE",
      stopRespected: true,
    });
  }

  const resolvedKinds = new Set<string>();
  for (const evidence of input.adjudications) {
    switch (evidence.kind) {
      case "CHASE_WARNING_ADJUDICATED":
        resolvedKinds.add("CHASE_WARNING");
        events.push({ ...makeBase(`${tradeId}:${evidence.evidenceId}:CHASE_WARNING`, evidence.observedAt), kind: "CHASE_WARNING", falseWarning: evidence.falseWarning });
        break;
      case "LATE_EXIT_ADJUDICATED":
        resolvedKinds.add("LATE_EXIT_EVENT");
        events.push({ ...makeBase(`${tradeId}:${evidence.evidenceId}:LATE_EXIT_EVENT`, evidence.observedAt), kind: "LATE_EXIT_EVENT", priorExitOrProtectWarning: evidence.priorExitOrProtectWarning });
        break;
      case "THESIS_FAILURE_ADJUDICATED":
        resolvedKinds.add("THESIS_FAILURE");
        events.push({ ...makeBase(`${tradeId}:${evidence.evidenceId}:THESIS_FAILURE`, evidence.observedAt), kind: "THESIS_FAILURE", priorThesisWarning: evidence.priorThesisWarning });
        break;
      case "SIDE_FLIP_ADJUDICATED":
        resolvedKinds.add("SIDE_FLIP");
        events.push({ ...makeBase(`${tradeId}:${evidence.evidenceId}:SIDE_FLIP`, evidence.observedAt), kind: "SIDE_FLIP", freshDeterministicSetup: evidence.freshDeterministicSetup });
        break;
      case "PROFIT_PROTECTION_ADJUDICATED":
        resolvedKinds.add("PROFIT_PROTECTION_OPPORTUNITY");
        events.push({ ...makeBase(`${tradeId}:${evidence.evidenceId}:PROFIT_PROTECTION`, evidence.observedAt), kind: "PROFIT_PROTECTION_OPPORTUNITY", useful: evidence.useful });
        break;
    }
  }

  const unresolvedSources: string[] = [];
  if (!resolvedKinds.has("CHASE_WARNING")) unresolvedSources.push("FALSE_CHASE_WARNING_ADJUDICATION_NOT_SUPPLIED");
  if (!resolvedKinds.has("LATE_EXIT_EVENT")) unresolvedSources.push("LATE_EXIT_ADJUDICATION_NOT_SUPPLIED");
  if (!resolvedKinds.has("THESIS_FAILURE")) unresolvedSources.push("THESIS_FAILURE_ADJUDICATION_NOT_SUPPLIED");
  if (!resolvedKinds.has("SIDE_FLIP")) unresolvedSources.push("SIDE_FLIP_ADJUDICATION_NOT_SUPPLIED");
  if (!resolvedKinds.has("PROFIT_PROTECTION_OPPORTUNITY")) unresolvedSources.push("PROFIT_PROTECTION_ADJUDICATION_NOT_SUPPLIED");

  return {
    version: "PSYCHOLOGY_RETROSPECTIVE_OUTCOME_EVIDENCE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status: "READY",
    events,
    blockers: [],
    unresolvedSources,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
