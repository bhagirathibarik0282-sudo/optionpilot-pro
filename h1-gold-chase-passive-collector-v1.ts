import {
  appendForwardOutcome,
  createBusinessForwardJournal,
  type BusinessForwardAnchor,
  type BusinessForwardJournalRecord,
  type ForwardOutcomePoint,
} from "./business-forward-journal-v1.js";
import {
  buildH1GoldChaseCalibrationSample,
  type H1GoldChaseCalibrationSample,
} from "./h1-gold-chase-calibration-dataset-v1.js";
import type { H1GoldChaseObservationInput } from "./h1-gold-chase-observation-v1.js";

export const H1_GOLD_CHASE_PASSIVE_COLLECTOR_V1 = "H1_GOLD_CHASE_PASSIVE_COLLECTOR_V1" as const;

export type H1GoldChasePassiveCollectorState = "BLOCKED" | "COLLECTING" | "COMPLETE_SAMPLE";

export interface H1GoldChasePassiveCollectorInput {
  observationInput: H1GoldChaseObservationInput;
  anchor: BusinessForwardAnchor;
  explicitOutcomes?: ReadonlyArray<ForwardOutcomePoint>;
}

export interface H1GoldChasePassiveCollectorResult {
  version: typeof H1_GOLD_CHASE_PASSIVE_COLLECTOR_V1;
  state: H1GoldChasePassiveCollectorState;
  journal: BusinessForwardJournalRecord | null;
  sample: H1GoldChaseCalibrationSample | null;
  acceptedWindows: ForwardOutcomePoint["window"][];
  missingWindows: ForwardOutcomePoint["window"][];
  blockers: string[];
  completeSampleReady: boolean;
  thresholdPolicy: null;
  chaseLabel: null;
  classificationPolicyDefined: false;
  sampleSufficiencyPolicyDefined: false;
  schedulesSampling: false;
  infersWindowFromClock: false;
  autoFillsMissingWindows: false;
  persistsData: false;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  registersGoldFamily: false;
  failClosed: true;
  businessUse: "PASSIVE_SHADOW_CHASE_COLLECTION_ONLY_NOT_GOLD_AUTHORITY";
  semantics: "CALLER_ASSIGNED_EXACT_FORWARD_WINDOWS_ONLY_NO_SCHEDULER_NO_INFERENCE_NO_AUTOFILL_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY";
}

const WINDOWS: ForwardOutcomePoint["window"][] = [
  "T_PLUS_3M",
  "T_PLUS_6M",
  "T_PLUS_15M",
  "T_PLUS_30M",
];

const SEMANTICS = "CALLER_ASSIGNED_EXACT_FORWARD_WINDOWS_ONLY_NO_SCHEDULER_NO_INFERENCE_NO_AUTOFILL_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY" as const;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function result(
  state: H1GoldChasePassiveCollectorState,
  journal: BusinessForwardJournalRecord | null,
  sample: H1GoldChaseCalibrationSample | null,
  blockers: string[],
): H1GoldChasePassiveCollectorResult {
  const acceptedWindows = sample?.completedWindows ? [...sample.completedWindows] : [];
  const missingWindows = sample?.missingWindows ? [...sample.missingWindows] : [...WINDOWS];
  return {
    version: H1_GOLD_CHASE_PASSIVE_COLLECTOR_V1,
    state,
    journal: state === "BLOCKED" ? null : journal,
    sample,
    acceptedWindows,
    missingWindows,
    blockers: unique(blockers),
    completeSampleReady: state === "COMPLETE_SAMPLE" && sample?.readyForDataset === true,
    thresholdPolicy: null,
    chaseLabel: null,
    classificationPolicyDefined: false,
    sampleSufficiencyPolicyDefined: false,
    schedulesSampling: false,
    infersWindowFromClock: false,
    autoFillsMissingWindows: false,
    persistsData: false,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    registersGoldFamily: false,
    failClosed: true,
    businessUse: "PASSIVE_SHADOW_CHASE_COLLECTION_ONLY_NOT_GOLD_AUTHORITY",
    semantics: SEMANTICS,
  };
}

/**
 * Pure SHADOW collection boundary for chase research.
 *
 * The caller must provide the exact frozen T0 anchor and must explicitly label
 * every later observation as T+3/T+6/T+15/T+30. This function deliberately has
 * no clock, scheduler, tolerance policy, persistence side effect, or automatic
 * mapping from observation time to a forward window.
 *
 * Existing journal + dataset validators remain the source of truth for identity,
 * chronology and minimum target-time enforcement. A COMPLETE_SAMPLE means only
 * that all four exact structural observations exist; it is not a chase label,
 * performance claim, Gold signal, or production approval.
 */
export function collectH1GoldChasePassiveEvidence(
  input: H1GoldChasePassiveCollectorInput,
): H1GoldChasePassiveCollectorResult {
  const made = createBusinessForwardJournal(input?.anchor);
  if (!made.ready || !made.record) {
    return result("BLOCKED", null, null, made.blockers.map((code) => `T0_JOURNAL_${code}`));
  }

  let journal = made.record;

  // Validate exact T0 binding before accepting any future observation.
  let sample = buildH1GoldChaseCalibrationSample(input?.observationInput, journal);
  if (sample.state === "BLOCKED") {
    return result("BLOCKED", null, sample, sample.blockers.map((code) => `T0_${code}`));
  }

  const points = input?.explicitOutcomes == null ? [] : input.explicitOutcomes;
  if (!Array.isArray(points)) {
    return result("BLOCKED", null, sample, ["EXPLICIT_OUTCOMES_ARRAY_REQUIRED"]);
  }

  for (const point of points) {
    const appended = appendForwardOutcome(journal, point);
    if (!appended.ready || !appended.record) {
      return result("BLOCKED", null, sample, appended.blockers.map((code) => `FORWARD_${code}`));
    }

    journal = appended.record;
    sample = buildH1GoldChaseCalibrationSample(input.observationInput, journal);
    if (sample.state === "BLOCKED") {
      return result("BLOCKED", null, sample, sample.blockers);
    }
  }

  if (sample.state === "COMPLETE_SAMPLE") {
    return result("COMPLETE_SAMPLE", journal, sample, []);
  }

  return result("COLLECTING", journal, sample, []);
}
