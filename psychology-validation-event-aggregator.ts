import type { ShadowValidationRegimeEvidence } from "./psychology-regime-evidence.ts";
import { validateShadowValidationRegimeEvidence } from "./psychology-regime-evidence.ts";
import { validatePsychologyShadowObservations, type ShadowValidationObservation, type ShadowValidationRegime } from "./psychology-shadow-validation.ts";

export type PsychologyValidationEventSource = "DETERMINISTIC_REPLAY" | "DETERMINISTIC_LIVE";

interface PsychologyValidationEventBase {
  eventId: string;
  tradeId: string;
  observedAt: string;
  source: PsychologyValidationEventSource;
  ruleVersion: string;
}

export type PsychologyValidationEvent =
  | (PsychologyValidationEventBase & { kind: "CHASE_WARNING"; falseWarning: boolean })
  | (PsychologyValidationEventBase & { kind: "LATE_EXIT_EVENT"; priorExitOrProtectWarning: boolean })
  | (PsychologyValidationEventBase & { kind: "THESIS_FAILURE"; priorThesisWarning: boolean })
  | (PsychologyValidationEventBase & { kind: "STATE_FLIP"; terminal: boolean })
  | (PsychologyValidationEventBase & { kind: "MESSAGE_ELIGIBLE"; duplicate: boolean; spoken: boolean })
  | (PsychologyValidationEventBase & { kind: "SIDE_FLIP"; freshDeterministicSetup: boolean })
  | (PsychologyValidationEventBase & { kind: "ENTRY"; accepted: boolean; extensionBlocked: boolean })
  | (PsychologyValidationEventBase & { kind: "STOPPED_TRADE"; stopRespected: boolean })
  | (PsychologyValidationEventBase & { kind: "PROFIT_PROTECTION_OPPORTUNITY"; useful: boolean })
  | (PsychologyValidationEventBase & { kind: "TRADE_COMPLETED" });

export interface PsychologyValidationEventAggregationInput {
  tradeId: string;
  evaluationCutoffAt: string;
  replayDecisionAt: string;
  regimes: ShadowValidationRegime[];
  regimeEvidence: ShadowValidationRegimeEvidence[];
  events: readonly PsychologyValidationEvent[];
}

export interface PsychologyValidationEventAggregationResult {
  version: "PSYCHOLOGY_VALIDATION_EVENT_AGGREGATOR_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: "READY" | "BLOCKED";
  observation: ShadowValidationObservation | null;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function validIso(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function blocked(blockers: string[]): PsychologyValidationEventAggregationResult {
  return {
    version: "PSYCHOLOGY_VALIDATION_EVENT_AGGREGATOR_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status: "BLOCKED",
    observation: null,
    blockers: [...new Set(blockers)],
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}

/**
 * Aggregates already-deterministic replay/live instrumentation into the frozen psychology
 * validation counters. It never infers event truth from prices or text. Every event must have
 * a stable unique eventId so replay/retry duplication cannot inflate validation counters.
 * Retrospective events may occur after the original replay decision as long as they are no
 * later than the explicit evaluation cutoff. Regime evidence remains separately no-lookahead
 * guarded to replayDecisionAt because regime labels describe information available at decision time.
 */
export function aggregatePsychologyValidationEvents(
  input: PsychologyValidationEventAggregationInput,
): PsychologyValidationEventAggregationResult {
  const blockers: string[] = [];
  const tradeId = input.tradeId.trim();
  if (!tradeId) blockers.push("TRADE_ID_MISSING");
  if (!validIso(input.evaluationCutoffAt)) blockers.push("EVALUATION_CUTOFF_INVALID");
  if (!validIso(input.replayDecisionAt)) blockers.push("REPLAY_DECISION_AT_INVALID");
  if (validIso(input.evaluationCutoffAt) && validIso(input.replayDecisionAt)
      && Date.parse(input.evaluationCutoffAt) < Date.parse(input.replayDecisionAt)) {
    blockers.push("EVALUATION_CUTOFF_BEFORE_REPLAY_DECISION");
  }

  const provenance = validateShadowValidationRegimeEvidence(input.regimeEvidence, input.replayDecisionAt, input.regimes);
  if (!provenance.valid) blockers.push(...provenance.blockers);

  const seenEventIds = new Set<string>();
  for (const event of input.events) {
    if (!event || typeof event !== "object") {
      blockers.push("EVENT_INVALID");
      continue;
    }
    const eventId = typeof event.eventId === "string" ? event.eventId.trim() : "";
    if (!eventId) blockers.push(`EVENT_ID_MISSING:${event.kind}`);
    else if (seenEventIds.has(eventId)) blockers.push(`EVENT_ID_DUPLICATE:${eventId}`);
    else seenEventIds.add(eventId);
    if (event.tradeId.trim() !== tradeId) blockers.push(`EVENT_TRADE_ID_MISMATCH:${event.kind}`);
    if (event.source !== "DETERMINISTIC_REPLAY" && event.source !== "DETERMINISTIC_LIVE") {
      blockers.push(`EVENT_SOURCE_UNSUPPORTED:${event.kind}`);
    }
    if (typeof event.ruleVersion !== "string" || !event.ruleVersion.trim()) blockers.push(`EVENT_RULE_VERSION_MISSING:${event.kind}`);
    if (!validIso(event.observedAt)) blockers.push(`EVENT_TIMESTAMP_INVALID:${event.kind}`);
    else if (validIso(input.evaluationCutoffAt) && Date.parse(event.observedAt) > Date.parse(input.evaluationCutoffAt)) {
      blockers.push(`EVENT_AFTER_EVALUATION_CUTOFF:${event.kind}`);
    }
  }

  if (blockers.length > 0) return blocked(blockers);

  let completedTrade = false;
  let chaseWarnings = 0;
  let falseChaseWarnings = 0;
  let lateExitEvents = 0;
  let missedLateExitWarnings = 0;
  let thesisFailures = 0;
  let missedThesisFailures = 0;
  let stateFlips = 0;
  let eligibleMessages = 0;
  let duplicateMessages = 0;
  let spokenUpdates = 0;
  let wrongSideFlips = 0;
  let entries = 0;
  let entriesAfterExtension = 0;
  let stoppedTrades = 0;
  let stopRespectViolations = 0;
  let profitProtectionOpportunities = 0;
  let usefulProfitProtectionEvents = 0;

  for (const event of input.events) {
    switch (event.kind) {
      case "CHASE_WARNING":
        chaseWarnings += 1;
        if (event.falseWarning) falseChaseWarnings += 1;
        break;
      case "LATE_EXIT_EVENT":
        lateExitEvents += 1;
        if (!event.priorExitOrProtectWarning) missedLateExitWarnings += 1;
        break;
      case "THESIS_FAILURE":
        thesisFailures += 1;
        if (!event.priorThesisWarning) missedThesisFailures += 1;
        break;
      case "STATE_FLIP":
        if (!event.terminal) stateFlips += 1;
        break;
      case "MESSAGE_ELIGIBLE":
        eligibleMessages += 1;
        if (event.duplicate) duplicateMessages += 1;
        if (event.spoken) spokenUpdates += 1;
        break;
      case "SIDE_FLIP":
        if (!event.freshDeterministicSetup) wrongSideFlips += 1;
        break;
      case "ENTRY":
        if (event.accepted) {
          entries += 1;
          if (event.extensionBlocked) entriesAfterExtension += 1;
        }
        break;
      case "STOPPED_TRADE":
        stoppedTrades += 1;
        if (!event.stopRespected) stopRespectViolations += 1;
        break;
      case "PROFIT_PROTECTION_OPPORTUNITY":
        profitProtectionOpportunities += 1;
        if (event.useful) usefulProfitProtectionEvents += 1;
        break;
      case "TRADE_COMPLETED":
        completedTrade = true;
        break;
    }
  }

  const observation: ShadowValidationObservation = {
    tradeId,
    regimes: [...input.regimes],
    regimeEvidence: input.regimeEvidence.map((item) => ({ ...item })),
    completedTrade,
    chaseWarnings,
    falseChaseWarnings,
    lateExitEvents,
    missedLateExitWarnings,
    thesisFailures,
    missedThesisFailures,
    stateFlips,
    eligibleMessages,
    duplicateMessages,
    spokenUpdates,
    wrongSideFlips,
    entries,
    entriesAfterExtension,
    stoppedTrades,
    stopRespectViolations,
    profitProtectionOpportunities,
    usefulProfitProtectionEvents,
  };

  try {
    validatePsychologyShadowObservations([observation]);
  } catch (error) {
    return blocked([`AGGREGATED_OBSERVATION_INVALID:${error instanceof Error ? error.message : String(error)}`]);
  }

  return {
    version: "PSYCHOLOGY_VALIDATION_EVENT_AGGREGATOR_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status: "READY",
    observation,
    blockers: [],
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
