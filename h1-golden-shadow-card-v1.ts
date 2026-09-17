import {
  GOLDEN_SHADOW_CORE_CONFIRMATIONS,
  GOLDEN_SHADOW_HARD_GATES,
  GOLDEN_SHADOW_MIN_CORE_CONFIRMATIONS,
  H1_GOLDEN_SHADOW_CANDIDATE_V1,
  type H1GoldenShadowCandidateResult,
} from "./h1-golden-shadow-candidate-v1.js";
import type { GoldEvidenceFamily } from "./h1-gold-eligibility-v1.js";

export const H1_GOLDEN_SHADOW_CARD_V1 = "H1_GOLDEN_SHADOW_CARD_V1" as const;

export interface H1GoldenShadowCard {
  version: typeof H1_GOLDEN_SHADOW_CARD_V1;
  semantics: "READ_ONLY_SHADOW_PRESENTATION_OF_ALREADY_APPROVED_GOLDEN_CANDIDATE";
  presentationKey: string;
  state: "GOLDEN_SHADOW_CANDIDATE";
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  observedAt: string;
  headline: string;
  corePassed: number;
  coreTotal: number;
  hardGateFamilies: GoldEvidenceFamily[];
  passedCoreConfirmations: GoldEvidenceFamily[];
  missingCoreConfirmations: GoldEvidenceFamily[];
  missingContextFamilies: GoldEvidenceFamily[];
  reasonCodes: string[];
  executablePlanShown: false;
  readOnly: true;
  productionImpact: "NONE";
  affectsSelector: false;
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
}

function sameMembers(actual: readonly GoldEvidenceFamily[], expected: readonly GoldEvidenceFamily[]): boolean {
  return actual.length === expected.length
    && expected.every((family) => actual.includes(family))
    && new Set(actual).size === actual.length;
}

function validCandidateContract(candidate: H1GoldenShadowCandidateResult | null | undefined): candidate is H1GoldenShadowCandidateResult {
  if (!candidate) return false;
  if (candidate.version !== H1_GOLDEN_SHADOW_CANDIDATE_V1) return false;
  if (candidate.state !== "GOLDEN_SHADOW_CANDIDATE") return false;
  if (candidate.symbol !== "NIFTY" && candidate.symbol !== "SENSEX") return false;
  if (candidate.side !== "CE" && candidate.side !== "PE") return false;
  if (!Number.isFinite(Date.parse(candidate.observedAt))) return false;

  if (
    candidate.productionImpact !== "NONE"
    || candidate.affectsSelector !== false
    || candidate.affectsTelegram !== false
    || candidate.affectsExecution !== false
    || candidate.grantsPromotionAuthority !== false
    || candidate.createsOrders !== false
    || candidate.failClosed !== true
  ) return false;

  if (!sameMembers(candidate.hardGateFamilies, GOLDEN_SHADOW_HARD_GATES)) return false;
  if (!sameMembers(candidate.coreConfirmationFamilies, GOLDEN_SHADOW_CORE_CONFIRMATIONS)) return false;
  if (candidate.failedFamilies.length !== 0) return false;

  const passed = candidate.passedCoreConfirmations;
  if (new Set(passed).size !== passed.length) return false;
  if (passed.length < GOLDEN_SHADOW_MIN_CORE_CONFIRMATIONS) return false;
  if (passed.some((family) => !GOLDEN_SHADOW_CORE_CONFIRMATIONS.includes(family as typeof GOLDEN_SHADOW_CORE_CONFIRMATIONS[number]))) return false;

  const missing = candidate.missingCoreConfirmations;
  if (new Set(missing).size !== missing.length) return false;
  if (missing.some((family) => !GOLDEN_SHADOW_CORE_CONFIRMATIONS.includes(family as typeof GOLDEN_SHADOW_CORE_CONFIRMATIONS[number]))) return false;
  if (missing.some((family) => passed.includes(family))) return false;
  if (passed.length + missing.length !== GOLDEN_SHADOW_CORE_CONFIRMATIONS.length) return false;

  if (!candidate.reasonCodes.includes("HARD_GATES_PASS")) return false;
  if (!candidate.reasonCodes.includes("NO_EXPLICIT_CONTRADICTION")) return false;
  if (!candidate.reasonCodes.includes("SHADOW_ONLY_NO_PRODUCTION_AUTHORITY")) return false;

  return true;
}

function presentationKey(candidate: H1GoldenShadowCandidateResult): string {
  return `GOLDEN_SHADOW:${candidate.symbol}:${candidate.side}:${candidate.observedAt}`;
}

/**
 * Read-only projection only. This function cannot create a Golden candidate and
 * does not accept raw market evidence. WATCH / REJECTED / malformed candidate
 * contracts return null rather than being upgraded for presentation.
 */
export function projectH1GoldenShadowCard(
  candidate: H1GoldenShadowCandidateResult | null | undefined,
): H1GoldenShadowCard | null {
  if (!validCandidateContract(candidate)) return null;

  return {
    version: H1_GOLDEN_SHADOW_CARD_V1,
    semantics: "READ_ONLY_SHADOW_PRESENTATION_OF_ALREADY_APPROVED_GOLDEN_CANDIDATE",
    presentationKey: presentationKey(candidate),
    state: "GOLDEN_SHADOW_CANDIDATE",
    symbol: candidate.symbol,
    side: candidate.side,
    observedAt: candidate.observedAt,
    headline: `GOLDEN SHADOW • ${candidate.symbol} • ${candidate.side}`,
    corePassed: candidate.passedCoreConfirmations.length,
    coreTotal: GOLDEN_SHADOW_CORE_CONFIRMATIONS.length,
    hardGateFamilies: [...candidate.hardGateFamilies],
    passedCoreConfirmations: [...candidate.passedCoreConfirmations],
    missingCoreConfirmations: [...candidate.missingCoreConfirmations],
    missingContextFamilies: [...candidate.missingContextFamilies],
    reasonCodes: [...candidate.reasonCodes],
    executablePlanShown: false,
    readOnly: true,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    failClosed: true,
  };
}
