import {
  H1_GOLD_CHASE_CALIBRATION_PERSISTENCE_V1,
  persistH1GoldChaseCalibrationSample,
  type H1GoldChasePersistenceState,
} from "./h1-gold-chase-calibration-persistence-v1.js";
import {
  H1_GOLD_CHASE_LIVE_OUTCOME_BRIDGE_V1,
  type H1GoldChaseLiveOutcomeBridgeResult,
} from "./h1-gold-chase-live-outcome-bridge-v1.js";
import type { H1GoldChaseObservationInput } from "./h1-gold-chase-observation-v1.js";

export const H1_GOLD_CHASE_COMPLETE_SAMPLE_PERSISTENCE_V1 = "H1_GOLD_CHASE_COMPLETE_SAMPLE_PERSISTENCE_V1" as const;

export type H1GoldChaseCompleteSamplePersistenceState =
  | "BLOCKED"
  | "NOT_COMPLETE"
  | "PERSISTED"
  | "EXACT_DUPLICATE"
  | "PERSISTENCE_FAILED";

export interface H1GoldChaseCompleteSamplePersistenceInput {
  observationInput: H1GoldChaseObservationInput;
  bridge: H1GoldChaseLiveOutcomeBridgeResult;
}

export interface H1GoldChaseCompleteSamplePersistenceResult {
  version: typeof H1_GOLD_CHASE_COMPLETE_SAMPLE_PERSISTENCE_V1;
  state: H1GoldChaseCompleteSamplePersistenceState;
  durable: boolean;
  persistenceState: H1GoldChasePersistenceState | null;
  sampleKey: string | null;
  payloadDigest: string | null;
  blockers: string[];
  completeSampleOnly: true;
  rebuildsBeforePersistence: true;
  thresholdPolicyDefined: false;
  classificationPolicyDefined: false;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  registersGoldFamily: false;
  failClosed: true;
  semantics: "COMPLETE_VALIDATED_SHADOW_CHASE_SAMPLE_TO_IMMUTABLE_RESEARCH_PERSISTENCE_ONLY_NO_AUTHORITY";
}

const SAFETY = Object.freeze({
  completeSampleOnly: true as const,
  rebuildsBeforePersistence: true as const,
  thresholdPolicyDefined: false as const,
  classificationPolicyDefined: false as const,
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  registersGoldFamily: false as const,
  failClosed: true as const,
  semantics: "COMPLETE_VALIDATED_SHADOW_CHASE_SAMPLE_TO_IMMUTABLE_RESEARCH_PERSISTENCE_ONLY_NO_AUTHORITY" as const,
});

function result(
  state: H1GoldChaseCompleteSamplePersistenceState,
  persistenceState: H1GoldChasePersistenceState | null,
  sampleKey: string | null,
  payloadDigest: string | null,
  blockers: string[],
): H1GoldChaseCompleteSamplePersistenceResult {
  return {
    version: H1_GOLD_CHASE_COMPLETE_SAMPLE_PERSISTENCE_V1,
    state,
    durable: state === "PERSISTED" || state === "EXACT_DUPLICATE",
    persistenceState,
    sampleKey,
    payloadDigest,
    blockers: [...new Set(blockers.filter(Boolean))],
    ...SAFETY,
  };
}

/**
 * Final authority-free persistence seam for chase research.
 *
 * It accepts only the validated COMPLETE_SAMPLE state produced by the exact-live
 * outcome bridge. Incomplete or blocked journals never reach Postgres. The
 * persistence layer rebuilds the sample again from raw T0 observation + immutable
 * journal before writing, so this seam never trusts a free label or threshold.
 */
export async function persistCompleteH1GoldChaseResearchSample(
  input: H1GoldChaseCompleteSamplePersistenceInput,
): Promise<H1GoldChaseCompleteSamplePersistenceResult> {
  const bridge = input?.bridge;
  if (!bridge || bridge.version !== H1_GOLD_CHASE_LIVE_OUTCOME_BRIDGE_V1) {
    return result("BLOCKED", null, null, null, ["VALID_LIVE_OUTCOME_BRIDGE_REQUIRED"]);
  }
  if (bridge.semantics !== "VALIDATED_EXACT_LIVE_OUTCOME_TO_SHADOW_CHASE_SAMPLE_ONLY_NO_PERSISTENCE_NO_AUTHORITY") {
    return result("BLOCKED", null, null, null, ["VALID_BRIDGE_SEMANTICS_REQUIRED"]);
  }
  if (
    bridge.productionImpact !== "NONE" ||
    bridge.affectsGoldEligibility !== false ||
    bridge.affectsSelector !== false ||
    bridge.affectsTelegram !== false ||
    bridge.affectsExecution !== false ||
    bridge.grantsPromotionAuthority !== false ||
    bridge.createsOrders !== false ||
    bridge.registersGoldFamily !== false ||
    bridge.failClosed !== true
  ) {
    return result("BLOCKED", null, null, null, ["BRIDGE_AUTHORITY_OR_SAFETY_MISMATCH"]);
  }
  if (bridge.state === "BLOCKED" || bridge.blockers.length > 0) {
    return result("BLOCKED", null, null, null, ["BRIDGE_BLOCKED", ...bridge.blockers]);
  }
  if (
    bridge.state !== "COMPLETE_SAMPLE" ||
    bridge.completeSampleReady !== true ||
    !bridge.journal ||
    !bridge.sample ||
    bridge.sample.state !== "COMPLETE_SAMPLE" ||
    bridge.sample.readyForDataset !== true
  ) {
    return result("NOT_COMPLETE", null, null, null, ["COMPLETE_SHADOW_SAMPLE_REQUIRED"]);
  }
  if (
    bridge.sample.chaseLabel !== null ||
    bridge.sample.outcomeLabel !== null ||
    bridge.sample.thresholdPolicy !== null ||
    bridge.sample.classificationPolicyDefined ||
    bridge.sample.sampleSufficiencyPolicyDefined ||
    bridge.sample.productionImpact !== "NONE" ||
    bridge.sample.affectsGoldEligibility ||
    bridge.sample.affectsSelector ||
    bridge.sample.affectsTelegram ||
    bridge.sample.affectsExecution ||
    bridge.sample.grantsPromotionAuthority ||
    bridge.sample.createsOrders
  ) {
    return result("BLOCKED", null, null, null, ["LABEL_THRESHOLD_OR_AUTHORITY_NOT_ALLOWED"]);
  }

  const persisted = await persistH1GoldChaseCalibrationSample(input.observationInput, bridge.journal);
  if (persisted.version !== H1_GOLD_CHASE_CALIBRATION_PERSISTENCE_V1) {
    return result("PERSISTENCE_FAILED", null, null, null, ["PERSISTENCE_VERSION_MISMATCH"]);
  }
  if (persisted.state === "PERSISTED" || persisted.state === "EXACT_DUPLICATE") {
    return result(persisted.state, persisted.state, persisted.sampleKey, persisted.payloadDigest, []);
  }

  return result(
    "PERSISTENCE_FAILED",
    persisted.state,
    persisted.sampleKey,
    persisted.payloadDigest,
    [`PERSISTENCE_${persisted.state}`, ...persisted.blockers],
  );
}
