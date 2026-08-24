import {
  deriveEvidenceFamilies,
  type EvidenceFamilyResult,
  type EvidenceFamilyId,
  type FamilyBias,
} from "./evidence-family-engine.js";

export type FusionState =
  | "SUPPORTIVE"
  | "NEUTRAL"
  | "CONFLICTING"
  | "WARNING"
  | "INSUFFICIENT_DATA";

export type FusionBias = "BULLISH" | "BEARISH" | "MIXED" | "NONE" | "UNKNOWN";

export interface FamilyStateFusionSnapshot {
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  minuteBucket: string | null;
  state: FusionState;
  bias: FusionBias;
  coreDirectionFamilies: EvidenceFamilyId[];
  contextFamilies: EvidenceFamilyId[];
  availableCoreCount: number;
  availableContextCount: number;
  supportiveFamilies: EvidenceFamilyId[];
  warningFamilies: EvidenceFamilyId[];
  conflictingFamilies: EvidenceFamilyId[];
  unavailableFamilies: EvidenceFamilyId[];
  reasons: string[];
  hierarchy: "CORE_DIRECTION_THEN_CONTEXT";
  duplicateVoteGuard: true;
  ruleVersion: "TEF_FAMILY_FUSION_V1";
  semantics: "FORWARD_TESTING_EVIDENCE_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

const CORE_DIRECTION: EvidenceFamilyId[] = [
  "PRICE_STRUCTURE",
  "OPTION_PREMIUM_REALITY",
];

const CONTEXT: EvidenceFamilyId[] = [
  "VOLATILITY_GREEKS",
  "POSITIONING",
  "MULTI_EXPIRY",
  "BREADTH_REGIME",
];

function byId(families: EvidenceFamilyResult[], id: EvidenceFamilyId): EvidenceFamilyResult | undefined {
  return families.find((f) => f.id === id);
}

function usable(family: EvidenceFamilyResult | undefined): family is EvidenceFamilyResult {
  return !!family && family.state !== "UNAVAILABLE";
}

function directionalBias(family: EvidenceFamilyResult | undefined): FamilyBias | null {
  if (!usable(family)) return null;
  if (family.bias === "BULLISH" || family.bias === "BEARISH" || family.bias === "MIXED") return family.bias;
  return null;
}

function coreBias(families: EvidenceFamilyResult[]): FusionBias {
  const core = CORE_DIRECTION.map((id) => byId(families, id));
  const biases = core.map(directionalBias).filter((v): v is FamilyBias => v !== null);
  if (biases.length === 0) return "UNKNOWN";
  if (biases.some((b) => b === "MIXED")) return "MIXED";
  const bull = biases.some((b) => b === "BULLISH");
  const bear = biases.some((b) => b === "BEARISH");
  if (bull && bear) return "MIXED";
  if (bull) return "BULLISH";
  if (bear) return "BEARISH";
  return "NONE";
}

function contextOpposesCore(families: EvidenceFamilyResult[], bias: FusionBias): EvidenceFamilyId[] {
  if (bias !== "BULLISH" && bias !== "BEARISH") return [];
  const opposite = bias === "BULLISH" ? "BEARISH" : "BULLISH";
  return CONTEXT.filter((id) => {
    const family = byId(families, id);
    return usable(family) && family.bias === opposite;
  });
}

function classify(
  families: EvidenceFamilyResult[],
): { state: FusionState; bias: FusionBias; reasons: string[] } {
  const reasons: string[] = [];
  const core = CORE_DIRECTION.map((id) => byId(families, id));
  const availableCore = core.filter(usable);

  if (availableCore.length === 0) {
    reasons.push("No usable core direction family is available.");
    return { state: "INSUFFICIENT_DATA", bias: "UNKNOWN", reasons };
  }

  const bias = coreBias(families);
  const coreConflict = availableCore.some((f) => f.state === "CONFLICTING") || bias === "MIXED";
  if (coreConflict) {
    reasons.push("Core direction families conflict; context is not allowed to override that conflict.");
    return { state: "CONFLICTING", bias: "MIXED", reasons };
  }

  const coreWarning = availableCore.some((f) => f.state === "WARNING");
  if (coreWarning) {
    reasons.push("A core direction family is warning; evidence is not promoted to supportive.");
    return { state: "WARNING", bias, reasons };
  }

  const contextFamilies = CONTEXT.map((id) => byId(families, id)).filter(usable);
  const contextConflicts = contextFamilies.filter((f) => f.state === "CONFLICTING");
  const contextWarnings = contextFamilies.filter((f) => f.state === "WARNING");
  const opposingContext = contextOpposesCore(families, bias);

  if (contextConflicts.length > 0 || opposingContext.length >= 2) {
    reasons.push("Context contains material conflict against otherwise usable core evidence.");
    if (opposingContext.length >= 2) reasons.push(`Opposing context families: ${opposingContext.join(", ")}.`);
    return { state: "CONFLICTING", bias, reasons };
  }

  if (contextWarnings.length > 0 || opposingContext.length === 1) {
    reasons.push("Core evidence is usable, but one or more context families require caution.");
    return { state: "WARNING", bias, reasons };
  }

  const coreSupportive = availableCore.filter((f) => f.state === "SUPPORTIVE");
  const directionalCoreCount = availableCore.filter((f) => f.bias === "BULLISH" || f.bias === "BEARISH").length;

  if (
    bias !== "UNKNOWN" && bias !== "NONE" && bias !== "MIXED" &&
    coreSupportive.length > 0 && directionalCoreCount > 0
  ) {
    reasons.push("Core direction evidence is aligned and no material context conflict is present.");
    return { state: "SUPPORTIVE", bias, reasons };
  }

  reasons.push("Evidence is available but not strong enough for a supportive family-level state.");
  return { state: "NEUTRAL", bias, reasons };
}

/**
 * Hierarchical evidence fusion only.
 *
 * Price Structure and Option Premium Reality form the core direction layer.
 * Volatility/Greeks, Positioning, Multi-expiry and Breadth/Regime are context
 * layers. Context may weaken or conflict with the core, but cannot create or
 * flip direction by itself. No numerical weights are used in this phase.
 *
 * This function does not create a BUY/SELL verdict, select candidates, change
 * scoring, send Telegram, or affect execution.
 */
export async function deriveFamilyStateFusion(
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX",
): Promise<FamilyStateFusionSnapshot> {
  const snapshot = await deriveEvidenceFamilies(symbol);
  const families = snapshot.families;
  const classified = classify(families);

  return {
    symbol,
    minuteBucket: snapshot.minuteBucket,
    state: classified.state,
    bias: classified.bias,
    coreDirectionFamilies: [...CORE_DIRECTION],
    contextFamilies: [...CONTEXT],
    availableCoreCount: CORE_DIRECTION.map((id) => byId(families, id)).filter(usable).length,
    availableContextCount: CONTEXT.map((id) => byId(families, id)).filter(usable).length,
    supportiveFamilies: families.filter((f) => f.state === "SUPPORTIVE").map((f) => f.id),
    warningFamilies: families.filter((f) => f.state === "WARNING").map((f) => f.id),
    conflictingFamilies: families.filter((f) => f.state === "CONFLICTING").map((f) => f.id),
    unavailableFamilies: families.filter((f) => f.state === "UNAVAILABLE").map((f) => f.id),
    reasons: classified.reasons,
    hierarchy: "CORE_DIRECTION_THEN_CONTEXT",
    duplicateVoteGuard: true,
    ruleVersion: "TEF_FAMILY_FUSION_V1",
    semantics: "FORWARD_TESTING_EVIDENCE_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}
