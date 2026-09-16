import {
  H1_GOLD_EVIDENCE_ADAPTER_VERSION,
  type H1GoldEvidenceAdapterResult,
} from "./h1-gold-evidence-adapter-v1.js";
import type { GoldEvidenceFamily, GoldEvidenceState } from "./h1-gold-eligibility-v1.js";

export const H1_GOLDEN_SHADOW_CANDIDATE_V1 = "H1_GOLDEN_SHADOW_CANDIDATE_V1" as const;

export type GoldenShadowCandidateState = "REJECTED" | "WATCH" | "GOLDEN_SHADOW_CANDIDATE";

export interface H1GoldenShadowCandidateResult {
  version: typeof H1_GOLDEN_SHADOW_CANDIDATE_V1;
  state: GoldenShadowCandidateState;
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  observedAt: string;
  hardGateFamilies: readonly GoldEvidenceFamily[];
  coreConfirmationFamilies: readonly GoldEvidenceFamily[];
  contextFamilies: readonly GoldEvidenceFamily[];
  passedCoreConfirmations: GoldEvidenceFamily[];
  missingCoreConfirmations: GoldEvidenceFamily[];
  failedFamilies: GoldEvidenceFamily[];
  missingContextFamilies: GoldEvidenceFamily[];
  reasonCodes: string[];
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  semantics: "SHADOW_GOLDEN_CANDIDATE_HARD_GATES_PLUS_CORE_CONVERGENCE_NO_THRESHOLD_INVENTION";
}

export const GOLDEN_SHADOW_MIN_CORE_CONFIRMATIONS = 3 as const;

export const GOLDEN_SHADOW_HARD_GATES = [
  "dataIntegrity",
  "premiumPair",
  "executionQuality",
] as const satisfies readonly GoldEvidenceFamily[];

export const GOLDEN_SHADOW_CORE_CONFIRMATIONS = [
  "spotStructure",
  "targetFuturesPositioning",
  "leaderPositioning",
  "chainRepositioning",
] as const satisfies readonly GoldEvidenceFamily[];

export const GOLDEN_SHADOW_CONTEXT = [
  "peerConflictAbsent",
  "chasePhase",
  "horizonComplete",
] as const satisfies readonly GoldEvidenceFamily[];

function snake(family: GoldEvidenceFamily): string {
  return family.replace(/([A-Z])/g, "_$1").toUpperCase();
}

function stateOf(
  families: Record<GoldEvidenceFamily, GoldEvidenceState> | null | undefined,
  family: GoldEvidenceFamily,
): GoldEvidenceState {
  const state = families?.[family];
  return state === "PASS" || state === "FAIL" || state === "MISSING" ? state : "MISSING";
}

function resultBase(input: H1GoldEvidenceAdapterResult, state: GoldenShadowCandidateState, reasonCodes: string[]): H1GoldenShadowCandidateResult {
  const families = input.families;
  const passedCoreConfirmations = GOLDEN_SHADOW_CORE_CONFIRMATIONS.filter((family) => stateOf(families, family) === "PASS");
  const missingCoreConfirmations = GOLDEN_SHADOW_CORE_CONFIRMATIONS.filter((family) => stateOf(families, family) === "MISSING");
  const failedFamilies = ([...GOLDEN_SHADOW_HARD_GATES, ...GOLDEN_SHADOW_CORE_CONFIRMATIONS, ...GOLDEN_SHADOW_CONTEXT] as GoldEvidenceFamily[])
    .filter((family) => stateOf(families, family) === "FAIL");
  const missingContextFamilies = GOLDEN_SHADOW_CONTEXT.filter((family) => stateOf(families, family) === "MISSING");

  return {
    version: H1_GOLDEN_SHADOW_CANDIDATE_V1,
    state,
    symbol: input.symbol,
    side: input.side,
    observedAt: input.observedAt,
    hardGateFamilies: GOLDEN_SHADOW_HARD_GATES,
    coreConfirmationFamilies: GOLDEN_SHADOW_CORE_CONFIRMATIONS,
    contextFamilies: GOLDEN_SHADOW_CONTEXT,
    passedCoreConfirmations,
    missingCoreConfirmations,
    failedFamilies,
    missingContextFamilies,
    reasonCodes: [...new Set(reasonCodes)],
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
    semantics: "SHADOW_GOLDEN_CANDIDATE_HARD_GATES_PLUS_CORE_CONVERGENCE_NO_THRESHOLD_INVENTION",
  };
}

/**
 * Shadow-only candidate boundary layered on top of the exact Gold adapter.
 *
 * Design intent:
 * - hard gates are non-negotiable and must explicitly PASS;
 * - core directional confirmations require convergence, not unanimity;
 * - an explicit FAIL anywhere is a contradiction and vetoes a Gold shadow candidate;
 * - missing context alone cannot make candidate formation impossible;
 * - no new numeric threshold, probability, win-rate, selector authority, Telegram
 *   authority or execution authority is introduced here.
 *
 * The stricter all-family research eligibility result remains independent and is
 * intentionally not overwritten by this shadow business-candidate layer.
 */
export function evaluateGoldenShadowCandidate(input: H1GoldEvidenceAdapterResult): H1GoldenShadowCandidateResult {
  const invalidInput = !input
    || input.version !== H1_GOLD_EVIDENCE_ADAPTER_VERSION
    || (input.symbol !== "NIFTY" && input.symbol !== "SENSEX")
    || (input.side !== "CE" && input.side !== "PE")
    || !Number.isFinite(Date.parse(input.observedAt));

  if (invalidInput) {
    const fallback = {
      ...(input ?? {}),
      symbol: input?.symbol === "SENSEX" ? "SENSEX" : "NIFTY",
      side: input?.side === "CE" ? "CE" : "PE",
      observedAt: Number.isFinite(Date.parse(input?.observedAt ?? "")) ? input.observedAt : new Date(0).toISOString(),
      families: input?.families ?? {},
    } as H1GoldEvidenceAdapterResult;
    return resultBase(fallback, "REJECTED", ["INVALID_GOLD_ADAPTER_INPUT"]);
  }

  if (input.canonicalRootValid !== true) {
    return resultBase(input, "REJECTED", ["CANONICAL_ROOT_NOT_VALID_FOR_GOLDEN_SHADOW"]);
  }

  const hardFailures: string[] = [];
  for (const family of GOLDEN_SHADOW_HARD_GATES) {
    const state = stateOf(input.families, family);
    if (state !== "PASS") hardFailures.push(`HARD_GATE_${state}_${snake(family)}`);
  }
  if (hardFailures.length > 0) return resultBase(input, "REJECTED", hardFailures);

  const coreFailed = GOLDEN_SHADOW_CORE_CONFIRMATIONS.filter((family) => stateOf(input.families, family) === "FAIL");
  if (coreFailed.length > 0) {
    return resultBase(input, "REJECTED", coreFailed.map((family) => `CORE_CONTRADICTION_${snake(family)}`));
  }

  const contextFailed = GOLDEN_SHADOW_CONTEXT.filter((family) => stateOf(input.families, family) === "FAIL");
  if (contextFailed.length > 0) {
    return resultBase(input, "REJECTED", contextFailed.map((family) => `CONTEXT_CONTRADICTION_${snake(family)}`));
  }

  const corePassed = GOLDEN_SHADOW_CORE_CONFIRMATIONS.filter((family) => stateOf(input.families, family) === "PASS");
  if (corePassed.length < GOLDEN_SHADOW_MIN_CORE_CONFIRMATIONS) {
    return resultBase(input, "WATCH", [
      `CORE_CONFIRMATION_INCOMPLETE_${corePassed.length}_OF_${GOLDEN_SHADOW_CORE_CONFIRMATIONS.length}`,
    ]);
  }

  return resultBase(input, "GOLDEN_SHADOW_CANDIDATE", [
    "HARD_GATES_PASS",
    `CORE_CONFIRMATION_PASS_${corePassed.length}_OF_${GOLDEN_SHADOW_CORE_CONFIRMATIONS.length}`,
    "NO_EXPLICIT_CONTRADICTION",
    "SHADOW_ONLY_NO_PRODUCTION_AUTHORITY",
  ]);
}
