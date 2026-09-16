import {
  adaptH1GoldEvidence,
  type H1GoldEvidenceAdapterInput,
  type H1GoldEvidenceAdapterResult,
} from "./h1-gold-evidence-adapter-v1.js";
import {
  evaluateGoldenShadowCandidate,
  H1_GOLDEN_SHADOW_CANDIDATE_V1,
  type H1GoldenShadowCandidateResult,
} from "./h1-golden-shadow-candidate-v1.js";
import {
  observeH1GoldChaseFacts,
  type H1GoldChaseContractIdentity,
  type H1GoldChaseObservationInput,
  type H1GoldChaseObservationResult,
  type H1GoldChasePremiumPoint,
} from "./h1-gold-chase-observation-v1.js";
import {
  createBusinessForwardJournal,
  type BusinessForwardJournalRecord,
} from "./business-forward-journal-v1.js";

export const H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1 = "H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1" as const;

export interface H1GoldChaseResearchBootstrapInput {
  goldEvidence: H1GoldEvidenceAdapterInput;
  contract: H1GoldChaseContractIdentity;
  premiumPoints: H1GoldChasePremiumPoint[];
  spread?: number | null;
  estimatedSlippage?: number | null;
}

export interface H1GoldChaseResearchBootstrapResult {
  version: typeof H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1;
  state: "READY_FOR_FORWARD_COLLECTION" | "BLOCKED";
  ready: boolean;
  candidateKey: string | null;
  decisionId: string | null;
  adapted: H1GoldEvidenceAdapterResult;
  shadowCandidate: H1GoldenShadowCandidateResult;
  observation: H1GoldChaseObservationResult;
  observationInput: H1GoldChaseObservationInput | null;
  journal: BusinessForwardJournalRecord | null;
  blockers: string[];
  strictGoldRequired: false;
  chasePolicyDefined: false;
  outcomeClassificationPolicyDefined: false;
  sampleSufficiencyPolicyDefined: false;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  failClosed: true;
  businessUse: "GOLDEN_SHADOW_CANDIDATE_TO_EMPIRICAL_CHASE_CALIBRATION_ONLY";
  semantics: "EXISTING_GOLDEN_SHADOW_TRIGGER_TO_FROZEN_T0_FORWARD_JOURNAL_NO_NEW_THRESHOLD_NO_GOLD_AUTHORITY";
}

const SAFETY = Object.freeze({
  strictGoldRequired: false as const,
  chasePolicyDefined: false as const,
  outcomeClassificationPolicyDefined: false as const,
  sampleSufficiencyPolicyDefined: false as const,
  productionImpact: "NONE" as const,
  affectsGoldEligibility: false as const,
  affectsSelector: false as const,
  affectsTelegram: false as const,
  affectsExecution: false as const,
  grantsPromotionAuthority: false as const,
  createsOrders: false as const,
  failClosed: true as const,
  businessUse: "GOLDEN_SHADOW_CANDIDATE_TO_EMPIRICAL_CHASE_CALIBRATION_ONLY" as const,
  semantics: "EXISTING_GOLDEN_SHADOW_TRIGGER_TO_FROZEN_T0_FORWARD_JOURNAL_NO_NEW_THRESHOLD_NO_GOLD_AUTHORITY" as const,
});

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function canonicalCandidateKey(input: H1GoldChaseResearchBootstrapInput): string | null {
  const symbol = input?.goldEvidence?.symbol;
  const side = input?.goldEvidence?.side;
  const contract = input?.contract;
  if ((symbol !== "NIFTY" && symbol !== "SENSEX") || (side !== "CE" && side !== "PE")) return null;
  if (!contract || !contract.expiry?.trim() || !Number.isFinite(contract.strike) || contract.strike <= 0 || contract.optionType !== side) return null;
  return `${symbol}|${contract.expiry}|${contract.strike}|${side}`;
}

function placeholderObservation(input: H1GoldChaseResearchBootstrapInput): H1GoldChaseObservationResult {
  const side = input?.goldEvidence?.side === "PE" ? "PE" : "CE";
  const symbol = input?.goldEvidence?.symbol === "SENSEX" ? "SENSEX" : "NIFTY";
  const observedAt = Number.isFinite(Date.parse(input?.goldEvidence?.observedAt ?? ""))
    ? input.goldEvidence.observedAt
    : new Date(0).toISOString();
  return {
    version: "H1_GOLD_CHASE_OBSERVATION_V1",
    state: "MISSING",
    readyForForwardCalibration: false,
    symbol,
    side,
    observedAt,
    snapshotId: input?.goldEvidence?.canonicalSnapshot?.snapshotId?.trim() || "MISSING_CANONICAL_SNAPSHOT",
    contract: input?.contract ?? { expiry: "", strike: 0, optionType: side, dte: -1 },
    features: {
      pointCount: 0,
      firstObservedAt: null,
      currentObservedAt: null,
      minutesSinceMarketOpen: null,
      observationSpanMinutes: null,
      firstPremium: null,
      currentPremium: null,
      sessionHighPremium: null,
      sessionHighObservedAt: null,
      sessionLowPremium: null,
      sessionLowObservedAt: null,
      currentVsFirstPct: null,
      currentVsSessionHighPct: null,
      sessionRangePct: null,
    },
    blockers: ["BOOTSTRAP_OBSERVATION_NOT_BUILT"],
    chaseVerdict: null,
    goldFamilySignal: null,
    thresholdPolicy: null,
    productionImpact: "NONE",
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    registersGoldFamily: false,
    usesFutureOutcome: false,
    failClosed: true,
    businessUse: "FORWARD_CALIBRATION_ONLY_NOT_CHASE_VERDICT",
    semantics: "EXACT_T0_SAME_CONTRACT_PREMIUM_PATH_FACTS_ONLY_NO_CHASE_CLASSIFICATION_NO_THRESHOLD",
  };
}

function result(
  state: H1GoldChaseResearchBootstrapResult["state"],
  adapted: H1GoldEvidenceAdapterResult,
  shadowCandidate: H1GoldenShadowCandidateResult,
  observation: H1GoldChaseObservationResult,
  candidateKey: string | null,
  decisionId: string | null,
  observationInput: H1GoldChaseObservationInput | null,
  journal: BusinessForwardJournalRecord | null,
  blockers: string[],
): H1GoldChaseResearchBootstrapResult {
  return {
    version: H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1,
    state,
    ready: state === "READY_FOR_FORWARD_COLLECTION",
    candidateKey,
    decisionId,
    adapted,
    shadowCandidate,
    observation,
    observationInput,
    journal,
    blockers: unique(blockers),
    ...SAFETY,
  };
}

/**
 * Safe bootstrap for empirical chase calibration.
 *
 * Strict Gold cannot currently be the calibration trigger because chasePhase is
 * intentionally not an approved Gold producer until empirical policy exists.
 * This seam therefore reuses the already-defined GOLDEN_SHADOW_CANDIDATE state
 * as the research trigger, freezes the exact contract/T0 premium path, and
 * creates an immutable forward journal. It does not invent a chase threshold,
 * outcome label, sample target, Telegram authority, selector authority or order.
 */
export function bootstrapH1GoldChaseResearch(
  input: H1GoldChaseResearchBootstrapInput,
): H1GoldChaseResearchBootstrapResult {
  const adapted = adaptH1GoldEvidence(input.goldEvidence);
  const shadowCandidate = evaluateGoldenShadowCandidate(adapted);
  let observation = placeholderObservation(input);
  const blockers: string[] = [];

  if (shadowCandidate.version !== H1_GOLDEN_SHADOW_CANDIDATE_V1 || shadowCandidate.state !== "GOLDEN_SHADOW_CANDIDATE") {
    blockers.push(`SHADOW_TRIGGER_${shadowCandidate.state}`);
    blockers.push(...shadowCandidate.reasonCodes.map((code) => `SHADOW_${code}`));
  }

  const candidateKey = canonicalCandidateKey(input);
  if (!candidateKey) blockers.push("EXACT_CONTRACT_IDENTITY_REQUIRED");
  if (!Number.isInteger(input?.contract?.dte) || input.contract.dte < 0) blockers.push("VALID_CONTRACT_DTE_REQUIRED");

  if (blockers.length > 0) {
    return result("BLOCKED", adapted, shadowCandidate, observation, candidateKey, null, null, null, blockers);
  }

  const observationInput: H1GoldChaseObservationInput = {
    symbol: input.goldEvidence.symbol,
    side: input.goldEvidence.side,
    observedAt: input.goldEvidence.observedAt,
    canonicalSnapshot: input.goldEvidence.canonicalSnapshot,
    contract: input.contract,
    premiumPoints: input.premiumPoints,
  };
  observation = observeH1GoldChaseFacts(observationInput);
  if (observation.state !== "OBSERVABLE" || !observation.readyForForwardCalibration || observation.features.currentPremium == null) {
    return result(
      "BLOCKED",
      adapted,
      shadowCandidate,
      observation,
      candidateKey,
      null,
      observationInput,
      null,
      ["T0_CHASE_OBSERVATION_NOT_READY", ...observation.blockers],
    );
  }

  const snapshotId = input.goldEvidence.canonicalSnapshot.snapshotId;
  const decisionId = `${H1_GOLD_CHASE_RESEARCH_BOOTSTRAP_V1}|${snapshotId}|${candidateKey}|${input.goldEvidence.observedAt}`;
  const made = createBusinessForwardJournal({
    decisionId,
    snapshotId,
    observedAtMs: Date.parse(input.goldEvidence.observedAt),
    selectedCandidateKey: candidateKey,
    eligibleCandidates: [{
      candidateKey,
      symbol: input.goldEvidence.symbol,
      optionSide: input.goldEvidence.side,
      strike: input.contract.strike,
      expiryDate: input.contract.expiry,
      dte: input.contract.dte,
      premiumLtp: observation.features.currentPremium,
      spread: input.spread ?? null,
      estimatedSlippage: input.estimatedSlippage ?? null,
    }],
    opportunityStage: "GOLDEN_SHADOW_CANDIDATE_RESEARCH_ONLY",
  });

  if (!made.ready || !made.record) {
    return result(
      "BLOCKED",
      adapted,
      shadowCandidate,
      observation,
      candidateKey,
      decisionId,
      observationInput,
      null,
      ["FORWARD_JOURNAL_NOT_READY", ...made.blockers],
    );
  }

  return result(
    "READY_FOR_FORWARD_COLLECTION",
    adapted,
    shadowCandidate,
    observation,
    candidateKey,
    decisionId,
    observationInput,
    made.record,
    [],
  );
}
