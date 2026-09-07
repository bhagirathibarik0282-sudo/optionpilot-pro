export type H1DteShadowBucket = "EXPIRY_0_1" | "NEAR_2_4" | "MID_5_9" | "FAR_10_PLUS";

export interface H1DteAwareShadowThresholdInput {
  dte: number;
  absoluteDeltaChange: number;
}

export interface H1DteAwareShadowThresholdResult {
  version: "H1_DTE_AWARE_SHADOW_THRESHOLD_V1";
  semantics: "SHADOW_CALIBRATION_ONLY";
  bucket: H1DteShadowBucket;
  threshold: number | null;
  observedAbsoluteDeltaChange: number;
  pass: boolean;
  blocker: string | null;
  source: "H1_DELTA_OOS_CALIBRATION_2026_09_01_TO_2026_09_04";
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  failClosed: true;
}

export function classifyH1DteShadowBucket(dte: number): H1DteShadowBucket {
  if (!Number.isInteger(dte) || dte < 0) throw new Error("INVALID_DTE");
  if (dte <= 1) return "EXPIRY_0_1";
  if (dte <= 4) return "NEAR_2_4";
  if (dte <= 9) return "MID_5_9";
  return "FAR_10_PLUS";
}

export function evaluateH1DteAwareShadowThreshold(input: H1DteAwareShadowThresholdInput): H1DteAwareShadowThresholdResult {
  if (!Number.isFinite(input?.absoluteDeltaChange) || input.absoluteDeltaChange < 0) {
    throw new Error("INVALID_ABSOLUTE_DELTA_CHANGE");
  }

  const bucket = classifyH1DteShadowBucket(input.dte);
  let threshold: number | null = null;
  let blocker: string | null = null;

  if (bucket === "MID_5_9") threshold = 0.022028497762746096;
  else if (bucket === "FAR_10_PLUS") threshold = 0.016496784582947822;
  else if (bucket === "EXPIRY_0_1") blocker = "INSUFFICIENT_OOS_EVIDENCE";
  else blocker = "INSUFFICIENT_CALIBRATION_AND_OOS_EVIDENCE";

  return {
    version: "H1_DTE_AWARE_SHADOW_THRESHOLD_V1",
    semantics: "SHADOW_CALIBRATION_ONLY",
    bucket,
    threshold,
    observedAbsoluteDeltaChange: input.absoluteDeltaChange,
    pass: threshold != null ? input.absoluteDeltaChange >= threshold : false,
    blocker,
    source: "H1_DELTA_OOS_CALIBRATION_2026_09_01_TO_2026_09_04",
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    failClosed: true,
  };
}
