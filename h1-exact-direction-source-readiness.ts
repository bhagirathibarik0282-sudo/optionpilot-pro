export type H1ExactDirectionSourceKind =
  | "VERIFIED_DETERMINISTIC_RUNTIME"
  | "STATIC_CONTRACT_DIRECTION"
  | "OPTION_SIDE_INFERENCE"
  | "MISSING";

export interface H1ExactDirectionSourceReadinessInput {
  source: H1ExactDirectionSourceKind;
  sourceId?: string | null;
  liveRuntimeExact: boolean;
  deterministic: boolean;
  optionSideInferenceUsed: boolean;
  callerStaticDirectionUsed: boolean;
}

export interface H1ExactDirectionSourceReadinessResult {
  version: "H1_EXACT_DIRECTION_SOURCE_READINESS_V1";
  ready: boolean;
  source: H1ExactDirectionSourceKind;
  sourceId: string | null;
  blockers: string[];
  failClosed: true;
  productionImpact: "NONE";
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
}

export function auditH1ExactDirectionSourceReadiness(
  input: H1ExactDirectionSourceReadinessInput,
): H1ExactDirectionSourceReadinessResult {
  const blockers: string[] = [];
  const sourceId = input.sourceId?.trim() || null;

  if (input.source !== "VERIFIED_DETERMINISTIC_RUNTIME") blockers.push("VERIFIED_DETERMINISTIC_RUNTIME_DIRECTION_SOURCE_REQUIRED");
  if (!sourceId) blockers.push("DIRECTION_SOURCE_ID_REQUIRED");
  if (!input.liveRuntimeExact) blockers.push("DIRECTION_SOURCE_NOT_LIVE_RUNTIME_EXACT");
  if (!input.deterministic) blockers.push("DIRECTION_SOURCE_NOT_DETERMINISTIC");
  if (input.optionSideInferenceUsed || input.source === "OPTION_SIDE_INFERENCE") blockers.push("OPTION_SIDE_DIRECTION_INFERENCE_FORBIDDEN");
  if (input.callerStaticDirectionUsed || input.source === "STATIC_CONTRACT_DIRECTION") blockers.push("STATIC_CONTRACT_DIRECTION_FORBIDDEN");
  if (input.source === "MISSING") blockers.push("DIRECTION_SOURCE_MISSING");

  return {
    version: "H1_EXACT_DIRECTION_SOURCE_READINESS_V1",
    ready: blockers.length === 0,
    source: input.source,
    sourceId,
    blockers: [...new Set(blockers)],
    failClosed: true,
    productionImpact: "NONE",
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
  };
}
