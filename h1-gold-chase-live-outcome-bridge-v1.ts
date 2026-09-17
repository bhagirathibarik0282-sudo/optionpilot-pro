import {
  BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1,
  type BusinessForwardLiveOutcomeCollectorResult,
} from "./business-forward-live-outcome-collector-v1.js";
import {
  buildH1GoldChaseCalibrationSample,
  type H1GoldChaseCalibrationSample,
} from "./h1-gold-chase-calibration-dataset-v1.js";
import type { BusinessForwardJournalRecord } from "./business-forward-journal-v1.js";
import type { H1GoldChaseObservationInput } from "./h1-gold-chase-observation-v1.js";

export const H1_GOLD_CHASE_LIVE_OUTCOME_BRIDGE_V1 = "H1_GOLD_CHASE_LIVE_OUTCOME_BRIDGE_V1" as const;

export type H1GoldChaseLiveOutcomeBridgeState = "BLOCKED" | "COLLECTING" | "COMPLETE_SAMPLE";

export interface H1GoldChaseLiveOutcomeBridgeInput {
  observationInput: H1GoldChaseObservationInput;
  liveOutcome: BusinessForwardLiveOutcomeCollectorResult;
}

export interface H1GoldChaseLiveOutcomeBridgeResult {
  version: typeof H1_GOLD_CHASE_LIVE_OUTCOME_BRIDGE_V1;
  state: H1GoldChaseLiveOutcomeBridgeState;
  journal: BusinessForwardJournalRecord | null;
  sample: H1GoldChaseCalibrationSample | null;
  blockers: string[];
  completeSampleReady: boolean;
  persistsData: false;
  schedulesSampling: false;
  infersWindowFromClock: false;
  thresholdPolicy: null;
  chaseLabel: null;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  registersGoldFamily: false;
  failClosed: true;
  semantics: "VALIDATED_EXACT_LIVE_OUTCOME_TO_SHADOW_CHASE_SAMPLE_ONLY_NO_PERSISTENCE_NO_AUTHORITY";
}

const SEMANTICS = "VALIDATED_EXACT_LIVE_OUTCOME_TO_SHADOW_CHASE_SAMPLE_ONLY_NO_PERSISTENCE_NO_AUTHORITY" as const;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function result(
  state: H1GoldChaseLiveOutcomeBridgeState,
  journal: BusinessForwardJournalRecord | null,
  sample: H1GoldChaseCalibrationSample | null,
  blockers: string[],
): H1GoldChaseLiveOutcomeBridgeResult {
  return {
    version: H1_GOLD_CHASE_LIVE_OUTCOME_BRIDGE_V1,
    state,
    journal: state === "BLOCKED" ? null : journal,
    sample,
    blockers: unique(blockers),
    completeSampleReady: state === "COMPLETE_SAMPLE" && sample?.readyForDataset === true,
    persistsData: false,
    schedulesSampling: false,
    infersWindowFromClock: false,
    thresholdPolicy: null,
    chaseLabel: null,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    registersGoldFamily: false,
    failClosed: true,
    semantics: SEMANTICS,
  };
}

/**
 * Authority-free seam from the existing exact-live forward-outcome collector
 * into the chase calibration sample builder.
 *
 * This bridge does not call clocks, schedule windows, infer a window, persist a
 * row, classify chase, register a Gold producer, send Telegram, or create an
 * order. It only accepts a successful exact-live collector result, verifies the
 * claimed newly captured point is present in the returned immutable journal,
 * then lets the chase dataset builder revalidate T0 identity and chronology.
 */
export function bridgeH1GoldChaseFromLiveOutcome(
  input: H1GoldChaseLiveOutcomeBridgeInput,
): H1GoldChaseLiveOutcomeBridgeResult {
  const live = input?.liveOutcome;
  if (!live || live.version !== BUSINESS_FORWARD_LIVE_OUTCOME_COLLECTOR_V1) {
    return result("BLOCKED", null, null, ["EXACT_LIVE_OUTCOME_COLLECTOR_V1_REQUIRED"]);
  }
  if (live.semantics !== "READ_ONLY_EXACT_LIVE_FORWARD_OUTCOME_CAPTURE") {
    return result("BLOCKED", null, null, ["EXACT_LIVE_OUTCOME_SEMANTICS_REQUIRED"]);
  }
  if (
    live.affectsVerdict !== false ||
    live.affectsStars !== false ||
    live.affectsCandidateAuthority !== false ||
    live.affectsTelegram !== false ||
    live.affectsExecution !== false ||
    live.createsOrders !== false ||
    live.failClosed !== true
  ) {
    return result("BLOCKED", null, null, ["LIVE_OUTCOME_AUTHORITY_OR_SAFETY_MISMATCH"]);
  }
  if (!live.ready || !live.record) {
    return result("BLOCKED", null, null, ["READY_EXACT_LIVE_OUTCOME_REQUIRED", ...live.blockers]);
  }
  if (live.blockers.length > 0) {
    return result("BLOCKED", null, null, ["LIVE_OUTCOME_HAS_BLOCKERS", ...live.blockers]);
  }
  if (!live.window || !Number.isFinite(live.observedAtMs)) {
    return result("BLOCKED", null, null, ["LIVE_OUTCOME_WINDOW_AND_TIMESTAMP_REQUIRED"]);
  }

  const matching = live.record.outcomes.filter((point) => point.window === live.window);
  if (matching.length !== 1) {
    return result("BLOCKED", null, null, ["EXACTLY_ONE_CAPTURED_WINDOW_POINT_REQUIRED"]);
  }
  if (matching[0].observedAtMs !== live.observedAtMs) {
    return result("BLOCKED", null, null, ["LIVE_OUTCOME_TIMESTAMP_MISMATCH"]);
  }

  const sample = buildH1GoldChaseCalibrationSample(input.observationInput, live.record);
  if (sample.state === "BLOCKED") {
    return result("BLOCKED", null, sample, sample.blockers);
  }
  if (sample.state === "COMPLETE_SAMPLE") {
    return result("COMPLETE_SAMPLE", live.record, sample, []);
  }
  return result("COLLECTING", live.record, sample, []);
}
