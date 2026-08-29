import { validateReplayObservation, type ReplayObservation } from "./h1-replay-guard.ts";
import type { ShadowValidationObservation } from "./psychology-shadow-validation.ts";

export type PsychologyValidationSource = "REAL_REPLAY" | "LIVE_OBSERVATION" | "SYNTHETIC";

export interface PsychologyReplayValidationInput {
  source: PsychologyValidationSource;
  replay: ReplayObservation;
  validation: ShadowValidationObservation;
}

export interface PsychologyReplayValidationResult {
  version: "PSYCHOLOGY_SHADOW_REPLAY_ADAPTER_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  accepted: boolean;
  observation: ShadowValidationObservation | null;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

/**
 * Admits only provenance-backed real replay or live-observation rows into psychology validation.
 * Historical replay must first pass the H1 no-lookahead/data-quality guard.
 * Synthetic cases remain useful for unit tests but can never become validation evidence.
 */
export function adaptPsychologyValidationEvidence(input: PsychologyReplayValidationInput): PsychologyReplayValidationResult {
  const blockers: string[] = [];

  if (input.source === "SYNTHETIC") blockers.push("SYNTHETIC_EVIDENCE_NOT_ACCEPTED");
  if (!input.validation.tradeId.trim()) blockers.push("MISSING_VALIDATION_TRADE_ID");
  if (!input.replay.logicalKey.trim()) blockers.push("MISSING_REPLAY_LOGICAL_KEY");
  if (input.validation.tradeId.trim() !== input.replay.logicalKey.trim()) blockers.push("TRADE_ID_REPLAY_KEY_MISMATCH");

  const replayGuard = validateReplayObservation(input.replay);
  if (input.source === "REAL_REPLAY" && !replayGuard.eligible) {
    blockers.push(...replayGuard.errors.map((e) => `REPLAY_GUARD_${e}`));
  }

  if (input.source === "LIVE_OBSERVATION") {
    const observed = Date.parse(input.replay.observedAt);
    const decision = Date.parse(input.replay.decisionAt);
    if (!Number.isFinite(observed) || !Number.isFinite(decision)) blockers.push("INVALID_LIVE_OBSERVATION_TIMESTAMP");
    if (input.replay.quality !== "TRUE") blockers.push(`LIVE_OBSERVATION_QUALITY_${input.replay.quality}`);
    if (input.replay.sessionEligible === false) blockers.push("LIVE_OBSERVATION_OUTSIDE_ELIGIBLE_SESSION");
  }

  return {
    version: "PSYCHOLOGY_SHADOW_REPLAY_ADAPTER_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    accepted: blockers.length === 0,
    observation: blockers.length === 0 ? { ...input.validation } : null,
    blockers,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
