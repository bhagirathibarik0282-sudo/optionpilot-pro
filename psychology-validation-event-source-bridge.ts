import type { CandidateIdentity } from "./live-psychology-coach-contract.ts";
import { buildPsychologyCandidateKey, type PsychologyShadowChainResult } from "./psychology-shadow-chain.ts";
import type { PsychologyValidationEvent, PsychologyValidationEventSource } from "./psychology-validation-event-aggregator.ts";

export interface PsychologyValidationEventSourceBridgeInput {
  candidate: CandidateIdentity;
  tradeId: string;
  observedAt: string;
  source: PsychologyValidationEventSource;
  ruleVersion: string;
  previous: PsychologyShadowChainResult | null;
  current: PsychologyShadowChainResult;
}

export interface PsychologyValidationEventSourceBridgeResult {
  version: "PSYCHOLOGY_VALIDATION_EVENT_SOURCE_BRIDGE_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  status: "READY" | "BLOCKED";
  events: PsychologyValidationEvent[];
  blockers: string[];
  deferredMetricSources: readonly string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

const DEFERRED_METRIC_SOURCES = [
  "CHASE_WARNING_REQUIRES_RETROSPECTIVE_FALSE_WARNING_ADJUDICATION",
  "LATE_EXIT_EVENT_REQUIRES_RETROSPECTIVE_OUTCOME_ADJUDICATION",
  "THESIS_FAILURE_REQUIRES_RETROSPECTIVE_FAILURE_ADJUDICATION",
  "SIDE_FLIP_REQUIRES_FRESH_SETUP_PROOF",
  "STOPPED_TRADE_REQUIRES_EXIT_CAUSE_PROOF",
  "PROFIT_PROTECTION_USEFULNESS_REQUIRES_RETROSPECTIVE_OUTCOME_ADJUDICATION",
] as const;

function validIso(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function blocked(blockers: string[]): PsychologyValidationEventSourceBridgeResult {
  return {
    version: "PSYCHOLOGY_VALIDATION_EVENT_SOURCE_BRIDGE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status: "BLOCKED",
    events: [],
    blockers: [...new Set(blockers)],
    deferredMetricSources: DEFERRED_METRIC_SOURCES,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}

function eventId(tradeId: string, observedAt: string, discriminator: string): string {
  return `${tradeId}:${observedAt}:${discriminator}`;
}

/**
 * Projects only facts that are directly provable from the deterministic shadow-chain result.
 * It intentionally does not fabricate retrospective outcome truth for false warnings, missed exits,
 * thesis failures, stop quality, fresh opposite setups, or protection usefulness.
 */
export function projectPsychologyValidationEvents(
  input: PsychologyValidationEventSourceBridgeInput,
): PsychologyValidationEventSourceBridgeResult {
  const blockers: string[] = [];
  const tradeId = input.tradeId.trim();
  const expectedKey = buildPsychologyCandidateKey(input.candidate);

  if (!tradeId) blockers.push("TRADE_ID_MISSING");
  if (input.candidate.candidateId.trim() !== tradeId) blockers.push("TRADE_ID_CANDIDATE_ID_MISMATCH");
  if (!validIso(input.observedAt)) blockers.push("OBSERVED_AT_INVALID");
  if (input.source !== "DETERMINISTIC_REPLAY" && input.source !== "DETERMINISTIC_LIVE") blockers.push("SOURCE_UNSUPPORTED");
  if (typeof input.ruleVersion !== "string" || !input.ruleVersion.trim()) blockers.push("RULE_VERSION_MISSING");
  if (input.current.candidateKey !== expectedKey) blockers.push("CURRENT_CANDIDATE_KEY_MISMATCH");
  if (input.previous && input.previous.candidateKey !== expectedKey) blockers.push("PREVIOUS_CANDIDATE_KEY_MISMATCH");

  if (blockers.length > 0) return blocked(blockers);

  const events: PsychologyValidationEvent[] = [];
  const base = {
    tradeId,
    observedAt: input.observedAt,
    source: input.source,
    ruleVersion: input.ruleVersion,
  } as const;

  if (input.previous) {
    if (input.previous.premium.state !== input.current.premium.state) {
      events.push({
        ...base,
        eventId: eventId(tradeId, input.observedAt, "STATE_FLIP:PREMIUM"),
        kind: "STATE_FLIP",
        terminal: false,
      });
    }
    if (input.previous.buyerSeller.state !== input.current.buyerSeller.state) {
      events.push({
        ...base,
        eventId: eventId(tradeId, input.observedAt, "STATE_FLIP:BUYER_SELLER"),
        kind: "STATE_FLIP",
        terminal: false,
      });
    }
    if (input.previous.lifecycle.nextState !== input.current.lifecycle.nextState) {
      events.push({
        ...base,
        eventId: eventId(tradeId, input.observedAt, "STATE_FLIP:LIFECYCLE"),
        kind: "STATE_FLIP",
        terminal: input.current.lifecycle.nextState === "EXIT",
      });
    }
  }

  if (input.current.trigger.eligibleBeforeDuplicateSuppression) {
    events.push({
      ...base,
      eventId: eventId(tradeId, input.observedAt, "MESSAGE_ELIGIBLE"),
      kind: "MESSAGE_ELIGIBLE",
      duplicate: input.current.trigger.duplicateSuppressed,
      spoken: input.current.trigger.shouldSpeak,
    });
  }

  if (input.previous?.lifecycle.nextState === "ENTRY_READY" && input.current.lifecycle.nextState === "ACTIVE") {
    events.push({
      ...base,
      eventId: eventId(tradeId, input.observedAt, "ENTRY"),
      kind: "ENTRY",
      accepted: true,
      extensionBlocked: input.current.behaviourRisk.risks.includes("DO_NOT_CHASE"),
    });
  }

  if (input.previous && input.previous.lifecycle.nextState !== "EXIT" && input.current.lifecycle.nextState === "EXIT") {
    events.push({
      ...base,
      eventId: eventId(tradeId, input.observedAt, "TRADE_COMPLETED"),
      kind: "TRADE_COMPLETED",
    });
  }

  return {
    version: "PSYCHOLOGY_VALIDATION_EVENT_SOURCE_BRIDGE_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    status: "READY",
    events,
    blockers: [],
    deferredMetricSources: DEFERRED_METRIC_SOURCES,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
