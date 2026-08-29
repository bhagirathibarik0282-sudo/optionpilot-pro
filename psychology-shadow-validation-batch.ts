import {
  adaptPsychologyValidationEvidence,
  type PsychologyReplayValidationInput,
} from "./psychology-shadow-replay-adapter.ts";
import {
  validatePsychologyShadowObservations,
  type ShadowValidationResult,
} from "./psychology-shadow-validation.ts";

export interface PsychologyValidationBatchRejection {
  index: number;
  tradeId: string;
  blockers: string[];
}

export interface PsychologyValidationBatchResult {
  version: "PSYCHOLOGY_SHADOW_VALIDATION_BATCH_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  totalInputs: number;
  acceptedInputs: number;
  rejectedInputs: number;
  acceptedRealReplay: number;
  acceptedLiveObservation: number;
  rejections: PsychologyValidationBatchRejection[];
  validation: ShadowValidationResult | null;
  blockers: string[];
  promotionEligible: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

/**
 * Admits provenance-backed evidence first, then sends only accepted observations
 * into the frozen psychology shadow validation aggregator.
 * Rejected evidence is never silently dropped: every rejection is surfaced.
 */
export function runPsychologyValidationBatch(
  inputs: PsychologyReplayValidationInput[],
): PsychologyValidationBatchResult {
  const accepted = [] as NonNullable<ReturnType<typeof adaptPsychologyValidationEvidence>["observation"]>[];
  const rejections: PsychologyValidationBatchRejection[] = [];
  let acceptedRealReplay = 0;
  let acceptedLiveObservation = 0;

  inputs.forEach((input, index) => {
    const result = adaptPsychologyValidationEvidence(input);
    if (!result.accepted || !result.observation) {
      rejections.push({
        index,
        tradeId: input.validation.tradeId.trim(),
        blockers: [...result.blockers],
      });
      return;
    }

    accepted.push(result.observation);
    if (input.source === "REAL_REPLAY") acceptedRealReplay += 1;
    if (input.source === "LIVE_OBSERVATION") acceptedLiveObservation += 1;
  });

  const blockers: string[] = [];
  if (inputs.length === 0) blockers.push("NO_EVIDENCE_INPUTS");
  if (rejections.length > 0) blockers.push("EVIDENCE_REJECTIONS_PRESENT");
  if (accepted.length === 0) blockers.push("NO_ACCEPTED_REAL_EVIDENCE");

  let validation: ShadowValidationResult | null = null;
  if (accepted.length > 0) {
    try {
      validation = validatePsychologyShadowObservations(accepted);
      blockers.push(...validation.blockers);
    } catch (error) {
      blockers.push(`VALIDATION_INPUT_INVALID:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    version: "PSYCHOLOGY_SHADOW_VALIDATION_BATCH_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    totalInputs: inputs.length,
    acceptedInputs: accepted.length,
    rejectedInputs: rejections.length,
    acceptedRealReplay,
    acceptedLiveObservation,
    rejections,
    validation,
    blockers,
    promotionEligible: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
