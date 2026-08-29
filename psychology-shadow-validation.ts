// Research-only validation registry + aggregator for the psychology shadow chain.
// This module freezes metric definitions and regime coverage requirements.
// It does NOT invent acceptance thresholds and has no live authority.

export type ShadowValidationRegime =
  | "TREND"
  | "RANGE"
  | "GAP"
  | "EXPIRY"
  | "REVERSAL"
  | "HIGH_IV"
  | "LOW_VOL"
  | "FALSE_BREAKOUT";

export type ShadowValidationMetricKey =
  | "FALSE_CHASE_WARNING_RATE"
  | "MISSED_LATE_EXIT_WARNING_RATE"
  | "MISSED_THESIS_FAILURE_RATE"
  | "STATE_FLIPS_PER_TRADE"
  | "DUPLICATE_MESSAGE_RATE"
  | "AVERAGE_UPDATES_PER_TRADE"
  | "WRONG_SIDE_FLIP_RATE"
  | "ENTRY_AFTER_EXTENSION_RATE"
  | "STOP_RESPECT_VIOLATION_RATE"
  | "PROFIT_PROTECTION_USEFULNESS_RATE";

export const REQUIRED_SHADOW_REGIMES: readonly ShadowValidationRegime[] = [
  "TREND", "RANGE", "GAP", "EXPIRY", "REVERSAL", "HIGH_IV", "LOW_VOL", "FALSE_BREAKOUT",
] as const;

export const SHADOW_VALIDATION_METRICS: Readonly<Record<ShadowValidationMetricKey, { definition: string; preferredDirection: "LOWER" | "HIGHER" }>> = {
  FALSE_CHASE_WARNING_RATE: { definition: "false chase warnings / chase warnings emitted", preferredDirection: "LOWER" },
  MISSED_LATE_EXIT_WARNING_RATE: { definition: "late-exit events with no prior exit/protect warning / late-exit events", preferredDirection: "LOWER" },
  MISSED_THESIS_FAILURE_RATE: { definition: "thesis failures not warned before failure / thesis failures", preferredDirection: "LOWER" },
  STATE_FLIPS_PER_TRADE: { definition: "non-terminal participant/premium/lifecycle state flips / completed candidate trades", preferredDirection: "LOWER" },
  DUPLICATE_MESSAGE_RATE: { definition: "duplicate messages / messages eligible before duplicate suppression", preferredDirection: "LOWER" },
  AVERAGE_UPDATES_PER_TRADE: { definition: "spoken lifecycle updates / completed candidate trades", preferredDirection: "LOWER" },
  WRONG_SIDE_FLIP_RATE: { definition: "opposite-side flips without a fresh deterministic setup / completed candidate trades", preferredDirection: "LOWER" },
  ENTRY_AFTER_EXTENSION_RATE: { definition: "entries accepted after deterministic extension/chase block / entries", preferredDirection: "LOWER" },
  STOP_RESPECT_VIOLATION_RATE: { definition: "cases where guidance widened/ignored a deterministic stop / stopped trades", preferredDirection: "LOWER" },
  PROFIT_PROTECTION_USEFULNESS_RATE: { definition: "profit-protection events that preserved profit or reduced giveback / profit-protection opportunities", preferredDirection: "HIGHER" },
};

export interface ShadowValidationObservation {
  tradeId: string;
  regime: ShadowValidationRegime;
  completedTrade: boolean;
  chaseWarnings: number;
  falseChaseWarnings: number;
  lateExitEvents: number;
  missedLateExitWarnings: number;
  thesisFailures: number;
  missedThesisFailures: number;
  stateFlips: number;
  eligibleMessages: number;
  duplicateMessages: number;
  spokenUpdates: number;
  wrongSideFlips: number;
  entries: number;
  entriesAfterExtension: number;
  stoppedTrades: number;
  stopRespectViolations: number;
  profitProtectionOpportunities: number;
  usefulProfitProtectionEvents: number;
}

export interface ShadowValidationResult {
  version: "PSYCHOLOGY_SHADOW_VALIDATION_V1";
  semantics: "RESEARCH_SHADOW_ONLY";
  observations: number;
  completedTrades: number;
  coveredRegimes: ShadowValidationRegime[];
  missingRegimes: ShadowValidationRegime[];
  metrics: Record<ShadowValidationMetricKey, number | null>;
  metricDefinitionsFrozen: true;
  acceptanceThresholdsFrozen: false;
  promotionEligible: false;
  blockers: string[];
  affectsTelegram: false;
  affectsVerdict: false;
  affectsExecution: false;
}

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

export function validatePsychologyShadowObservations(observations: ShadowValidationObservation[]): ShadowValidationResult {
  for (const o of observations) {
    if (!o.tradeId.trim()) throw new Error("tradeId is required");
    for (const [key, value] of Object.entries(o)) {
      if (key === "tradeId" || key === "regime" || key === "completedTrade") continue;
      assertCount(key, value as number);
    }
    if (o.falseChaseWarnings > o.chaseWarnings) throw new Error("falseChaseWarnings cannot exceed chaseWarnings");
    if (o.missedLateExitWarnings > o.lateExitEvents) throw new Error("missedLateExitWarnings cannot exceed lateExitEvents");
    if (o.missedThesisFailures > o.thesisFailures) throw new Error("missedThesisFailures cannot exceed thesisFailures");
    if (o.duplicateMessages > o.eligibleMessages) throw new Error("duplicateMessages cannot exceed eligibleMessages");
    if (o.entriesAfterExtension > o.entries) throw new Error("entriesAfterExtension cannot exceed entries");
    if (o.stopRespectViolations > o.stoppedTrades) throw new Error("stopRespectViolations cannot exceed stoppedTrades");
    if (o.usefulProfitProtectionEvents > o.profitProtectionOpportunities) throw new Error("usefulProfitProtectionEvents cannot exceed profitProtectionOpportunities");
  }

  const sum = (key: keyof ShadowValidationObservation) => observations.reduce((acc, o) => acc + (typeof o[key] === "number" ? (o[key] as number) : 0), 0);
  const completedTrades = observations.filter((o) => o.completedTrade).length;
  const coveredRegimes = REQUIRED_SHADOW_REGIMES.filter((r) => observations.some((o) => o.regime === r));
  const missingRegimes = REQUIRED_SHADOW_REGIMES.filter((r) => !coveredRegimes.includes(r));

  const metrics: Record<ShadowValidationMetricKey, number | null> = {
    FALSE_CHASE_WARNING_RATE: safeRate(sum("falseChaseWarnings"), sum("chaseWarnings")),
    MISSED_LATE_EXIT_WARNING_RATE: safeRate(sum("missedLateExitWarnings"), sum("lateExitEvents")),
    MISSED_THESIS_FAILURE_RATE: safeRate(sum("missedThesisFailures"), sum("thesisFailures")),
    STATE_FLIPS_PER_TRADE: safeRate(sum("stateFlips"), completedTrades),
    DUPLICATE_MESSAGE_RATE: safeRate(sum("duplicateMessages"), sum("eligibleMessages")),
    AVERAGE_UPDATES_PER_TRADE: safeRate(sum("spokenUpdates"), completedTrades),
    WRONG_SIDE_FLIP_RATE: safeRate(sum("wrongSideFlips"), completedTrades),
    ENTRY_AFTER_EXTENSION_RATE: safeRate(sum("entriesAfterExtension"), sum("entries")),
    STOP_RESPECT_VIOLATION_RATE: safeRate(sum("stopRespectViolations"), sum("stoppedTrades")),
    PROFIT_PROTECTION_USEFULNESS_RATE: safeRate(sum("usefulProfitProtectionEvents"), sum("profitProtectionOpportunities")),
  };

  const blockers: string[] = [];
  if (observations.length === 0) blockers.push("NO_SHADOW_OBSERVATIONS");
  if (missingRegimes.length > 0) blockers.push("REGIME_COVERAGE_INCOMPLETE");
  if (completedTrades === 0) blockers.push("NO_COMPLETED_CANDIDATE_TRADES");
  blockers.push("ACCEPTANCE_THRESHOLDS_NOT_CALIBRATED_OR_FROZEN");

  return {
    version: "PSYCHOLOGY_SHADOW_VALIDATION_V1",
    semantics: "RESEARCH_SHADOW_ONLY",
    observations: observations.length,
    completedTrades,
    coveredRegimes: [...coveredRegimes],
    missingRegimes: [...missingRegimes],
    metrics,
    metricDefinitionsFrozen: true,
    acceptanceThresholdsFrozen: false,
    promotionEligible: false,
    blockers,
    affectsTelegram: false,
    affectsVerdict: false,
    affectsExecution: false,
  };
}
