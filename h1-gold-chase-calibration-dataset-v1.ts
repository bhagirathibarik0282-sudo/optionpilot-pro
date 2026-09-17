import type {
  BusinessForwardJournalRecord,
  ForwardOutcomePoint,
} from "./business-forward-journal-v1.js";
import {
  observeH1GoldChaseFacts,
  type H1GoldChaseObservationFeatures,
  type H1GoldChaseObservationInput,
} from "./h1-gold-chase-observation-v1.js";

export const H1_GOLD_CHASE_CALIBRATION_DATASET_V1 = "H1_GOLD_CHASE_CALIBRATION_DATASET_V1" as const;

export type H1GoldChaseCalibrationState = "BLOCKED" | "COLLECTING" | "COMPLETE_SAMPLE";

export interface H1GoldChaseCalibrationOutcome {
  window: ForwardOutcomePoint["window"];
  targetMinutes: number;
  observedAtMs: number;
  actualLagMinutes: number;
  premium: number;
  returnPct: number;
}

export interface H1GoldChaseCalibrationSample {
  version: typeof H1_GOLD_CHASE_CALIBRATION_DATASET_V1;
  state: H1GoldChaseCalibrationState;
  readyForDataset: boolean;
  snapshotId: string | null;
  decisionId: string | null;
  candidateKey: string | null;
  symbol: "NIFTY" | "SENSEX";
  side: "CE" | "PE";
  expiry: string | null;
  strike: number | null;
  dte: number | null;
  t0ObservedAtMs: number | null;
  t0Premium: number | null;
  t0Features: H1GoldChaseObservationFeatures | null;
  t0MarketState: string | null;
  t0SellerStressState: string | null;
  t0OpportunityStage: string | null;
  outcomes: ReadonlyArray<Readonly<H1GoldChaseCalibrationOutcome>>;
  completedWindows: ForwardOutcomePoint["window"][];
  missingWindows: ForwardOutcomePoint["window"][];
  mfePct: number | null;
  maePct: number | null;
  terminal30mReturnPct: number | null;
  blockers: string[];
  chaseLabel: null;
  outcomeLabel: null;
  thresholdPolicy: null;
  classificationPolicyDefined: false;
  sampleSufficiencyPolicyDefined: false;
  productionImpact: "NONE";
  affectsGoldEligibility: false;
  affectsSelector: false;
  affectsTelegram: false;
  affectsExecution: false;
  grantsPromotionAuthority: false;
  createsOrders: false;
  usesPostT0Outcome: true;
  failClosed: true;
  businessUse: "FORWARD_CHASE_CALIBRATION_DATASET_ONLY_NOT_GOLD_AUTHORITY";
  semantics: "EXACT_T0_CHASE_FACTS_PAIRED_WITH_FROZEN_SELECTED_CANDIDATE_FORWARD_PREMIUMS_NO_LABEL_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY";
}

const WINDOWS: ForwardOutcomePoint["window"][] = [
  "T_PLUS_3M",
  "T_PLUS_6M",
  "T_PLUS_15M",
  "T_PLUS_30M",
];

const WINDOW_MINUTES: Record<ForwardOutcomePoint["window"], number> = {
  T_PLUS_3M: 3,
  T_PLUS_6M: 6,
  T_PLUS_15M: 15,
  T_PLUS_30M: 30,
};

const SEMANTICS = "EXACT_T0_CHASE_FACTS_PAIRED_WITH_FROZEN_SELECTED_CANDIDATE_FORWARD_PREMIUMS_NO_LABEL_NO_THRESHOLD_NO_PRODUCTION_AUTHORITY" as const;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function pct(t0: number, value: number): number {
  return round4(((value - t0) / t0) * 100);
}

function base(
  observationInput: H1GoldChaseObservationInput,
  state: H1GoldChaseCalibrationState,
  blockers: string[],
  fields: Partial<Pick<
    H1GoldChaseCalibrationSample,
    | "snapshotId"
    | "decisionId"
    | "candidateKey"
    | "expiry"
    | "strike"
    | "dte"
    | "t0ObservedAtMs"
    | "t0Premium"
    | "t0Features"
    | "t0MarketState"
    | "t0SellerStressState"
    | "t0OpportunityStage"
    | "outcomes"
    | "completedWindows"
    | "missingWindows"
    | "mfePct"
    | "maePct"
    | "terminal30mReturnPct"
  >> = {},
): H1GoldChaseCalibrationSample {
  return {
    version: H1_GOLD_CHASE_CALIBRATION_DATASET_V1,
    state,
    readyForDataset: state === "COMPLETE_SAMPLE" && blockers.length === 0,
    snapshotId: fields.snapshotId ?? null,
    decisionId: fields.decisionId ?? null,
    candidateKey: fields.candidateKey ?? null,
    symbol: observationInput?.symbol === "SENSEX" ? "SENSEX" : "NIFTY",
    side: observationInput?.side === "PE" ? "PE" : "CE",
    expiry: fields.expiry ?? null,
    strike: fields.strike ?? null,
    dte: fields.dte ?? null,
    t0ObservedAtMs: fields.t0ObservedAtMs ?? null,
    t0Premium: fields.t0Premium ?? null,
    t0Features: fields.t0Features ?? null,
    t0MarketState: fields.t0MarketState ?? null,
    t0SellerStressState: fields.t0SellerStressState ?? null,
    t0OpportunityStage: fields.t0OpportunityStage ?? null,
    outcomes: fields.outcomes ?? Object.freeze([]),
    completedWindows: fields.completedWindows ?? [],
    missingWindows: fields.missingWindows ?? [...WINDOWS],
    mfePct: fields.mfePct ?? null,
    maePct: fields.maePct ?? null,
    terminal30mReturnPct: fields.terminal30mReturnPct ?? null,
    blockers: unique(blockers),
    chaseLabel: null,
    outcomeLabel: null,
    thresholdPolicy: null,
    classificationPolicyDefined: false,
    sampleSufficiencyPolicyDefined: false,
    productionImpact: "NONE",
    affectsGoldEligibility: false,
    affectsSelector: false,
    affectsTelegram: false,
    affectsExecution: false,
    grantsPromotionAuthority: false,
    createsOrders: false,
    usesPostT0Outcome: true,
    failClosed: true,
    businessUse: "FORWARD_CHASE_CALIBRATION_DATASET_ONLY_NOT_GOLD_AUTHORITY",
    semantics: SEMANTICS,
  };
}

/**
 * Builds one structurally complete chase-calibration sample.
 *
 * The T0 observation is recomputed from raw exact inputs here instead of trusting
 * a caller-supplied OBSERVABLE boolean. Later outcomes are linked only to the
 * frozen selected candidate from the same snapshot and T0 timestamp.
 *
 * COMPLETE_SAMPLE means data completeness only. It does not mean CHASE,
 * NOT_CHASE, winner, loser, Gold eligible, or production ready.
 */
export function buildH1GoldChaseCalibrationSample(
  observationInput: H1GoldChaseObservationInput,
  journal: BusinessForwardJournalRecord | null | undefined,
): H1GoldChaseCalibrationSample {
  const blockers: string[] = [];
  const observation = observeH1GoldChaseFacts(observationInput);

  if (observation.state !== "OBSERVABLE" || !observation.readyForForwardCalibration) {
    blockers.push("VALID_EXACT_T0_CHASE_OBSERVATION_REQUIRED");
    blockers.push(...observation.blockers.map((code) => `T0_${code}`));
  }

  if (!journal || journal.version !== "BUSINESS_FORWARD_JOURNAL_V1" || journal.semantics !== "IMMUTABLE_T0_PLUS_LATER_OUTCOMES") {
    blockers.push("VALID_IMMUTABLE_FORWARD_JOURNAL_REQUIRED");
  }

  const t0Ms = Number.isFinite(Date.parse(observation.observedAt)) ? Date.parse(observation.observedAt) : null;
  const snapshotId = observation.snapshotId?.trim() || null;
  const decisionId = journal?.anchor?.decisionId?.trim() || null;
  const candidateKey = journal?.anchor?.selectedCandidateKey ?? null;
  const baseFields = {
    snapshotId,
    decisionId,
    candidateKey,
    expiry: observation.contract?.expiry || null,
    strike: Number.isFinite(observation.contract?.strike) ? observation.contract.strike : null,
    dte: Number.isInteger(observation.contract?.dte) ? observation.contract.dte : null,
    t0ObservedAtMs: t0Ms,
    t0Premium: observation.features.currentPremium,
    t0Features: observation.state === "OBSERVABLE" ? observation.features : null,
    t0MarketState: journal?.anchor?.marketState?.trim() || null,
    t0SellerStressState: journal?.anchor?.sellerStressState?.trim() || null,
    t0OpportunityStage: journal?.anchor?.opportunityStage?.trim() || null,
  };

  if (journal) {
    if (!snapshotId || journal.anchor.snapshotId !== snapshotId) blockers.push("CALIBRATION_SNAPSHOT_ID_MISMATCH");
    if (t0Ms == null || journal.anchor.observedAtMs !== t0Ms) blockers.push("CALIBRATION_T0_TIMESTAMP_MISMATCH");
    if (!candidateKey) blockers.push("FROZEN_SELECTED_CANDIDATE_REQUIRED");

    const candidates = Array.isArray(journal.anchor.eligibleCandidates) ? journal.anchor.eligibleCandidates : [];
    const candidateKeys = candidates.map((candidate) => candidate.candidateKey);
    if (new Set(candidateKeys).size !== candidateKeys.length) blockers.push("DUPLICATE_FROZEN_CANDIDATE_KEY");

    const selected = candidateKey ? candidates.find((candidate) => candidate.candidateKey === candidateKey) ?? null : null;
    if (!selected && candidateKey) blockers.push("SELECTED_CANDIDATE_NOT_IN_FROZEN_SET");

    if (selected) {
      if (selected.symbol !== observation.symbol) blockers.push("SELECTED_SYMBOL_MISMATCH");
      if (selected.optionSide !== observation.side) blockers.push("SELECTED_SIDE_MISMATCH");
      if (selected.expiryDate !== observation.contract.expiry) blockers.push("SELECTED_EXPIRY_MISMATCH");
      if (selected.strike !== observation.contract.strike) blockers.push("SELECTED_STRIKE_MISMATCH");
      if (selected.dte !== observation.contract.dte) blockers.push("SELECTED_DTE_MISMATCH");
      if (!finitePositive(selected.premiumLtp) || selected.premiumLtp !== observation.features.currentPremium) {
        blockers.push("SELECTED_T0_PREMIUM_MISMATCH");
      }
    }
  }

  if (blockers.length > 0) return base(observationInput, "BLOCKED", blockers, baseFields);

  const selectedKey = candidateKey!;
  const t0Premium = observation.features.currentPremium!;
  const outcomeByWindow = new Map<ForwardOutcomePoint["window"], ForwardOutcomePoint>();
  let previousObservedAtMs = journal!.anchor.observedAtMs;

  for (const point of journal!.outcomes ?? []) {
    if (!WINDOWS.includes(point.window)) {
      blockers.push(`INVALID_FORWARD_WINDOW:${String(point.window)}`);
      continue;
    }
    if (outcomeByWindow.has(point.window)) {
      blockers.push(`DUPLICATE_FORWARD_WINDOW:${point.window}`);
      continue;
    }
    const expectedAtMs = journal!.anchor.observedAtMs + WINDOW_MINUTES[point.window] * 60_000;
    if (!Number.isFinite(point.observedAtMs) || point.observedAtMs < expectedAtMs) {
      blockers.push(`FORWARD_WINDOW_OBSERVED_BEFORE_TARGET:${point.window}`);
    }
    const premium = point.premiumByCandidateKey?.[selectedKey];
    if (!finitePositive(premium)) blockers.push(`SELECTED_FORWARD_PREMIUM_REQUIRED:${point.window}`);
    outcomeByWindow.set(point.window, point);
  }

  const orderedPoints = WINDOWS
    .filter((window) => outcomeByWindow.has(window))
    .map((window) => outcomeByWindow.get(window)!);
  for (const point of orderedPoints) {
    if (point.observedAtMs <= previousObservedAtMs) blockers.push(`FORWARD_CHRONOLOGY_REVERSED:${point.window}`);
    previousObservedAtMs = point.observedAtMs;
  }

  if (blockers.length > 0) return base(observationInput, "BLOCKED", blockers, baseFields);

  const outcomes: H1GoldChaseCalibrationOutcome[] = orderedPoints.map((point) => {
    const premium = point.premiumByCandidateKey[selectedKey];
    return {
      window: point.window,
      targetMinutes: WINDOW_MINUTES[point.window],
      observedAtMs: point.observedAtMs,
      actualLagMinutes: round4((point.observedAtMs - journal!.anchor.observedAtMs) / 60_000),
      premium,
      returnPct: pct(t0Premium, premium),
    };
  });

  const completedWindows = outcomes.map((outcome) => outcome.window);
  const missingWindows = WINDOWS.filter((window) => !completedWindows.includes(window));
  const returns = outcomes.map((outcome) => outcome.returnPct);
  const mfePct = returns.length > 0 ? round4(Math.max(...returns)) : null;
  const maePct = returns.length > 0 ? round4(Math.min(...returns)) : null;
  const terminal30mReturnPct = outcomes.find((outcome) => outcome.window === "T_PLUS_30M")?.returnPct ?? null;
  const state: H1GoldChaseCalibrationState = missingWindows.length === 0 ? "COMPLETE_SAMPLE" : "COLLECTING";

  return base(observationInput, state, [], {
    ...baseFields,
    outcomes: Object.freeze(outcomes.map((outcome) => Object.freeze({ ...outcome }))),
    completedWindows,
    missingWindows,
    mfePct,
    maePct,
    terminal30mReturnPct,
  });
}
