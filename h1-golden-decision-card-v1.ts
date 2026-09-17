import type { BusinessForwardJournalRecord, ForwardOutcomePoint } from "./business-forward-journal-v1.js";
import {
  H1_GOLD_EVIDENCE_ADAPTER_VERSION,
  type H1GoldEvidenceAdapterResult,
} from "./h1-gold-evidence-adapter-v1.js";
import { validateH1GoldForwardEvidence } from "./h1-gold-forward-validation-v1.js";
import { evaluateH1GoldPromotionFirewall } from "./h1-gold-promotion-firewall-v1.js";
import {
  GOLDEN_SHADOW_CORE_CONFIRMATIONS,
  evaluateGoldenShadowCandidate,
} from "./h1-golden-shadow-candidate-v1.js";
import type { GoldEvidenceFamily } from "./h1-gold-eligibility-v1.js";

export const H1_GOLDEN_DECISION_CARD_V1 = "H1_GOLDEN_DECISION_CARD_V1" as const;

export type H1GoldenDecisionStage = "REJECTED" | "WATCH" | "SHADOW_ONLY" | "FORWARD_VALIDATION";
export type H1GoldenForwardStatus = "NOT_ELIGIBLE" | "JOURNAL_REQUIRED" | "COLLECTING" | "STRUCTURAL_EVIDENCE" | "BLOCKED";

export interface H1GoldenDecisionCard {
  version: typeof H1_GOLDEN_DECISION_CARD_V1;
  semantics: "MANDATORY_READ_ONLY_GOLD_DECISION_INFORMATION_CARD_NO_PROMOTION_AUTHORITY";
  presentationKey: string;
  identityValid: boolean;
  symbol: "NIFTY" | "SENSEX" | null;
  side: "CE" | "PE" | null;
  observedAt: string | null;
  headline: string;
  stage: H1GoldenDecisionStage;
  forwardStatus: H1GoldenForwardStatus;
  statusMessage: string;
  shadowState: "REJECTED" | "WATCH" | "GOLDEN_SHADOW_CANDIDATE" | "INVALID";
  strictGoldState: "BLOCKED" | "FORWARD_VALIDATION_REQUIRED" | "INVALID";
  corePassed: number;
  coreTotal: number;
  passedCoreConfirmations: GoldEvidenceFamily[];
  missingCoreConfirmations: GoldEvidenceFamily[];
  missingContextFamilies: GoldEvidenceFamily[];
  strictGoldBlockers: string[];
  forwardBlockers: string[];
  completedForwardWindows: ForwardOutcomePoint["window"][];
  selectedCandidateKey: string | null;
  selectedTerminalReturnPct: number | null;
  selectedMfePct: number | null;
  selectedMaePct: number | null;
  outcomeClassificationPolicyDefined: false;
  sampleSufficiencyPolicyDefined: false;
  performancePromotionThresholdDefined: false;
  informationCardMandatory: true;
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

const SAFETY = {
  outcomeClassificationPolicyDefined: false as const,
  sampleSufficiencyPolicyDefined: false as const,
  performancePromotionThresholdDefined: false as const,
  informationCardMandatory: true as const,
  executablePlanShown: false as const,
  readOnly: true as const,
  productionImpact: "NONE" as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsVerdict: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  failClosed: true as const,
};

function label(stage: H1GoldenDecisionStage): string {
  if (stage === "SHADOW_ONLY") return "SHADOW ONLY";
  if (stage === "FORWARD_VALIDATION") return "FORWARD VALIDATION";
  return stage;
}

function invalidCard(): H1GoldenDecisionCard {
  return {
    version: H1_GOLDEN_DECISION_CARD_V1,
    semantics: "MANDATORY_READ_ONLY_GOLD_DECISION_INFORMATION_CARD_NO_PROMOTION_AUTHORITY",
    presentationKey: "GOLD_DECISION:INVALID",
    identityValid: false,
    symbol: null,
    side: null,
    observedAt: null,
    headline: "GOLD DECISION • INVALID INPUT • REJECTED",
    stage: "REJECTED",
    forwardStatus: "NOT_ELIGIBLE",
    statusMessage: "Gold decision data is invalid. No candidate or production authority is granted.",
    shadowState: "INVALID",
    strictGoldState: "INVALID",
    corePassed: 0,
    coreTotal: GOLDEN_SHADOW_CORE_CONFIRMATIONS.length,
    passedCoreConfirmations: [],
    missingCoreConfirmations: [...GOLDEN_SHADOW_CORE_CONFIRMATIONS],
    missingContextFamilies: [],
    strictGoldBlockers: ["VALID_GOLD_ADAPTER_REQUIRED"],
    forwardBlockers: ["FORWARD_VALIDATION_NOT_ELIGIBLE"],
    completedForwardWindows: [],
    selectedCandidateKey: null,
    selectedTerminalReturnPct: null,
    selectedMfePct: null,
    selectedMaePct: null,
    ...SAFETY,
  };
}

/**
 * Mandatory information card for the Gold research chain.
 *
 * The card never upgrades evidence. It independently derives shadow, strict
 * firewall and forward-evidence states from the adapter and optional immutable
 * forward journal. SHADOW_ONLY is intentionally distinct from strict Gold.
 * Even STRUCTURAL_EVIDENCE remains research evidence because outcome
 * classification, sample sufficiency and performance promotion policies are
 * deliberately undefined here.
 */
export function buildH1GoldenDecisionCard(
  input: H1GoldEvidenceAdapterResult | null | undefined,
  journal?: BusinessForwardJournalRecord | null,
): H1GoldenDecisionCard {
  if (
    !input
    || input.version !== H1_GOLD_EVIDENCE_ADAPTER_VERSION
    || (input.symbol !== "NIFTY" && input.symbol !== "SENSEX")
    || (input.side !== "CE" && input.side !== "PE")
    || !Number.isFinite(Date.parse(input.observedAt))
  ) {
    return invalidCard();
  }

  const shadow = evaluateGoldenShadowCandidate(input);
  const firewall = evaluateH1GoldPromotionFirewall(input);

  let stage: H1GoldenDecisionStage;
  if (shadow.state === "REJECTED") stage = "REJECTED";
  else if (shadow.state === "WATCH") stage = "WATCH";
  else if (firewall.state === "FORWARD_VALIDATION_REQUIRED") stage = "FORWARD_VALIDATION";
  else stage = "SHADOW_ONLY";

  let forwardStatus: H1GoldenForwardStatus = "NOT_ELIGIBLE";
  let forwardBlockers: string[] = [];
  let completedForwardWindows: ForwardOutcomePoint["window"][] = [];
  let selectedCandidateKey = journal?.anchor?.selectedCandidateKey ?? null;
  let selectedTerminalReturnPct: number | null = null;
  let selectedMfePct: number | null = null;
  let selectedMaePct: number | null = null;

  if (firewall.state === "FORWARD_VALIDATION_REQUIRED") {
    if (!journal) {
      forwardStatus = "JOURNAL_REQUIRED";
      forwardBlockers = ["FROZEN_FORWARD_JOURNAL_REQUIRED"];
    } else {
      const forward = validateH1GoldForwardEvidence(input, journal);
      forwardBlockers = [...forward.blockerCodes];
      completedForwardWindows = [...forward.completedWindows];
      selectedCandidateKey = forward.selectedCandidateKey;
      selectedTerminalReturnPct = forward.selectedTerminalReturnPct;
      selectedMfePct = forward.selectedMfePct;
      selectedMaePct = forward.selectedMaePct;
      if (forward.state === "EVIDENCE_COLLECTION_REQUIRED") forwardStatus = "COLLECTING";
      else if (forward.state === "STRUCTURALLY_VALID_EVIDENCE") forwardStatus = "STRUCTURAL_EVIDENCE";
      else forwardStatus = "BLOCKED";
    }
  }

  const statusMessage = stage === "REJECTED"
    ? "Gold candidate rejected by current evidence."
    : stage === "WATCH"
      ? "Evidence convergence is incomplete. Watch only."
      : stage === "SHADOW_ONLY"
        ? "Golden shadow candidate exists, but strict Gold/forward gate is not cleared."
        : forwardStatus === "JOURNAL_REQUIRED"
          ? "Strict Gold cleared for research forward validation; freeze the T0 journal before collecting later outcomes."
          : forwardStatus === "COLLECTING"
            ? "Strict Gold cleared; frozen T0 is linked and forward outcomes are still being collected."
            : forwardStatus === "STRUCTURAL_EVIDENCE"
              ? "Forward evidence is structurally valid; outcome and promotion policies are still undefined."
              : "Strict Gold cleared, but forward evidence integrity is blocked.";

  return {
    version: H1_GOLDEN_DECISION_CARD_V1,
    semantics: "MANDATORY_READ_ONLY_GOLD_DECISION_INFORMATION_CARD_NO_PROMOTION_AUTHORITY",
    presentationKey: `GOLD_DECISION:${input.symbol}:${input.side}:${input.observedAt}`,
    identityValid: true,
    symbol: input.symbol,
    side: input.side,
    observedAt: input.observedAt,
    headline: `GOLD DECISION • ${input.symbol} • ${input.side} • ${label(stage)}`,
    stage,
    forwardStatus,
    statusMessage,
    shadowState: shadow.state,
    strictGoldState: firewall.state,
    corePassed: shadow.passedCoreConfirmations.length,
    coreTotal: GOLDEN_SHADOW_CORE_CONFIRMATIONS.length,
    passedCoreConfirmations: [...shadow.passedCoreConfirmations],
    missingCoreConfirmations: [...shadow.missingCoreConfirmations],
    missingContextFamilies: [...shadow.missingContextFamilies],
    strictGoldBlockers: [...firewall.blockerCodes],
    forwardBlockers,
    completedForwardWindows,
    selectedCandidateKey,
    selectedTerminalReturnPct,
    selectedMfePct,
    selectedMaePct,
    ...SAFETY,
  };
}
