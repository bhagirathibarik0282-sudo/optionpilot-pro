import { adaptPsychologyValidationEvidence, type PsychologyReplayValidationInput } from "./psychology-shadow-replay-adapter.ts";
import { REQUIRED_SHADOW_REGIMES, SHADOW_VALIDATION_METRICS, validatePsychologyShadowObservations, type ShadowValidationMetricKey, type ShadowValidationRegime } from "./psychology-shadow-validation.ts";

export interface PsychologyRealEvidenceLedgerResult {
  version: "PSYCHOLOGY_REAL_EVIDENCE_LEDGER_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  totalInputs: number;
  acceptedInputs: number;
  rejectedInputs: number;
  acceptedRealReplay: number;
  acceptedLiveObservation: number;
  regimeTradeCounts: Record<ShadowValidationRegime, number>;
  coveredRegimes: ShadowValidationRegime[];
  missingRegimes: ShadowValidationRegime[];
  metricValues: Record<ShadowValidationMetricKey, number | null> | null;
  nullMetrics: ShadowValidationMetricKey[];
  rejectionBlockers: string[];
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

/**
 * Collection ledger only. It counts admitted real evidence by provenance and overlapping regime tags.
 * It intentionally does not invent minimum sample sizes or acceptance thresholds.
 */
export function buildPsychologyRealEvidenceLedger(inputs: PsychologyReplayValidationInput[]): PsychologyRealEvidenceLedgerResult {
  const accepted = [] as NonNullable<ReturnType<typeof adaptPsychologyValidationEvidence>["observation"]>[];
  const rejectionBlockers: string[] = [];
  let acceptedRealReplay = 0;
  let acceptedLiveObservation = 0;

  for (const input of inputs) {
    const admitted = adaptPsychologyValidationEvidence(input);
    if (!admitted.accepted || !admitted.observation) {
      rejectionBlockers.push(...admitted.blockers);
      continue;
    }
    accepted.push(admitted.observation);
    if (input.source === "REAL_REPLAY") acceptedRealReplay += 1;
    if (input.source === "LIVE_OBSERVATION") acceptedLiveObservation += 1;
  }

  const regimeTradeCounts = Object.fromEntries(REQUIRED_SHADOW_REGIMES.map((r) => [r, 0])) as Record<ShadowValidationRegime, number>;
  for (const observation of accepted) {
    for (const regime of observation.regimes) regimeTradeCounts[regime] += 1;
  }

  const coveredRegimes = REQUIRED_SHADOW_REGIMES.filter((r) => regimeTradeCounts[r] > 0);
  const missingRegimes = REQUIRED_SHADOW_REGIMES.filter((r) => regimeTradeCounts[r] === 0);

  let metricValues: Record<ShadowValidationMetricKey, number | null> | null = null;
  if (accepted.length > 0) {
    try {
      metricValues = validatePsychologyShadowObservations(accepted).metrics;
    } catch (error) {
      rejectionBlockers.push(`VALIDATION_INPUT_INVALID:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const nullMetrics = metricValues
    ? (Object.keys(SHADOW_VALIDATION_METRICS) as ShadowValidationMetricKey[]).filter((key) => metricValues?.[key] == null)
    : (Object.keys(SHADOW_VALIDATION_METRICS) as ShadowValidationMetricKey[]);

  return {
    version: "PSYCHOLOGY_REAL_EVIDENCE_LEDGER_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    totalInputs: inputs.length,
    acceptedInputs: accepted.length,
    rejectedInputs: inputs.length - accepted.length,
    acceptedRealReplay,
    acceptedLiveObservation,
    regimeTradeCounts,
    coveredRegimes: [...coveredRegimes],
    missingRegimes: [...missingRegimes],
    metricValues,
    nullMetrics,
    rejectionBlockers,
    acceptanceThresholdsFrozen: false,
    promotionEligible: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
