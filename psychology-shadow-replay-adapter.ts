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
 * Both real replay and live observations must pass the H1 no-lookahead/data-quality guard.
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

  if (input.source === "LIVE_OBSERVATION" && !replayGuard.eligible) {
    blockers.push(...replayGuard.errors.map((e) => `LIVE_GUARD_${e}`));
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
