import type { OutcomeRecord, OutcomeStatus } from "./outcome-engine.js";

export type H1OutcomeClass = "WIN" | "LOSS" | "SCRATCH" | "NO_ENTRY" | "INCOMPLETE" | "PENDING" | "UNKNOWN";

export interface H1OutcomeAttribution {
  outcomeId: string;
  planId: string | null;
  symbol: string;
  tradingDate: string;
  status: OutcomeStatus;
  outcomeClass: H1OutcomeClass;
  terminal: boolean;
  calibrationEligible: boolean;
  incompleteReason: string | null;
  horizon: string | null;
  tmVersion: string;
  observationResolution: string;
  maePremium: number | null;
  mfePremium: number | null;
  maeR: number | null;
  mfeR: number | null;
  marketRegime: string | null;
  expiryType: string | null;
  signalType: string | null;
  clampApplied: string | null;
  reasons: string[];
  semantics: "VERIFIED_OUTCOME_ATTRIBUTION_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  ruleVersion: "H1_OUTCOME_ATTRIBUTION_V1";
}

const INCOMPLETE = new Set<OutcomeStatus>([
  "INCOMPLETE_WINDOW",
  "INCOMPLETE_STRIKE_SHIFTED",
  "INCOMPLETE_NO_ENTRY_DATA",
  "INCOMPLETE_DATA",
]);

function classify(status: OutcomeStatus): H1OutcomeClass {
  if (status === "PENDING") return "PENDING";
  if (status === "TARGET_T1_HIT" || status === "TARGET_T2_HIT" || status === "TARGET_T3_HIT") return "WIN";
  if (status === "STOP_HIT") return "LOSS";
  if (status === "NEITHER_HIT") return "SCRATCH";
  if (status === "INCOMPLETE_NO_ENTRY_DATA") return "NO_ENTRY";
  if (INCOMPLETE.has(status)) return "INCOMPLETE";
  return "UNKNOWN";
}

/**
 * Maps the deterministic Outcome Engine result into research attribution.
 * It never re-evaluates prices, reconstructs missing observations, or changes
 * the authoritative outcome status.
 */
export function mapVerifiedOutcome(record: OutcomeRecord): H1OutcomeAttribution {
  const outcomeClass = classify(record.status);
  const terminal = record.status !== "PENDING";
  const incomplete = INCOMPLETE.has(record.status);
  const reasons: string[] = [];

  if (incomplete) reasons.push(`OUTCOME_${record.status}`);
  if (record.observationResolution !== "3MIN_LTP_SAMPLED") reasons.push("OBSERVATION_RESOLUTION_UNEXPECTED");
  if (record.maeR == null || record.mfeR == null) reasons.push("R_EXCURSION_UNAVAILABLE");
  if (!record.planId) reasons.push("PLAN_ID_UNAVAILABLE");

  const calibrationEligible =
    terminal &&
    !incomplete &&
    outcomeClass !== "UNKNOWN" &&
    outcomeClass !== "NO_ENTRY" &&
    record.side != null &&
    record.strike != null &&
    record.entry != null &&
    record.entry > 0;

  return {
    outcomeId: record.outcomeId,
    planId: record.planId,
    symbol: record.symbol,
    tradingDate: record.tradingDate,
    status: record.status,
    outcomeClass,
    terminal,
    calibrationEligible,
    incompleteReason: incomplete ? record.outcomeDetail ?? record.status : null,
    horizon: record.horizon,
    tmVersion: record.tmVersion,
    observationResolution: record.observationResolution,
    maePremium: record.maePremium,
    mfePremium: record.mfePremium,
    maeR: record.maeR,
    mfeR: record.mfeR,
    marketRegime: record.marketRegime,
    expiryType: record.expiryType,
    signalType: record.signalType,
    clampApplied: record.clampApplied,
    reasons,
    semantics: "VERIFIED_OUTCOME_ATTRIBUTION_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    ruleVersion: "H1_OUTCOME_ATTRIBUTION_V1",
  };
}
