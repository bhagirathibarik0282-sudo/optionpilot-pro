export type TradeMode = "SCALP" | "INTRADAY" | "SWING" | "BTST";
export type Direction = "BULLISH" | "BEARISH" | "NEUTRAL" | "CONFLICTING";
export type Regime = "BALANCE" | "ACCUMULATION" | "EXPANSION" | "TREND" | "COMPRESSION" | "DISTRIBUTION" | "EXHAUSTION" | "REVERSAL" | "TRANSITION";
export type RegimeMaturity = "EARLY" | "DEVELOPING" | "MATURE" | "EXHAUSTING" | "UNKNOWN";
export type CandidateStatus = "DISCOVERED" | "WATCH" | "READY" | "ENTRY_VALID" | "ACTIVE" | "CONFIDENT_HOLD" | "HOLD" | "CAUTION" | "PARTIAL" | "TRAIL" | "RECOVERED" | "OVEREXTENDED" | "MISSED_ENTRY" | "INVALIDATED" | "EXIT" | "EXPIRED";
export type EvidenceQuality = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

export interface PremiumPairState {
  selectedSide: "CE" | "PE";
  selectedLtp: number | null;
  oppositeLtp: number | null;
  selectedChangePct: number | null;
  oppositeChangePct: number | null;
  relation: "SELECTED_UP_OPPOSITE_DOWN" | "BOTH_UP" | "BOTH_DOWN" | "SELECTED_DOWN_OPPOSITE_UP" | "MIXED" | "UNAVAILABLE";
}

export interface EvidenceFamilyState {
  familyId: string;
  state: "SUPPORTIVE" | "CONTRADICTORY" | "NEUTRAL" | "UNAVAILABLE";
  strength: number | null;
  quality: EvidenceQuality;
  reasonCodes: string[];
}

export interface DerivedHistoryState {
  symbol: string;
  observedAt: string;
  snapshotId: string | null;
  mode: TradeMode;
  direction: Direction;
  regime: Regime;
  maturity: RegimeMaturity;
  evidenceQuality: EvidenceQuality;
  evidenceCompletenessPct: number | null;
  conflictCount: number;
  candidateAgeMinutes: number | null;
  noChase: boolean;
  overextended: boolean;
  multiHorizonAlignment: "FULL" | "PARTIAL" | "CONFLICT" | "UNAVAILABLE";
  regimeSurvivalCount: number;
  premiumPair: PremiumPairState | null;
  evidenceFamilies: EvidenceFamilyState[];
  fiiDiiContext: "SUPPORTIVE" | "CONTRADICTORY" | "NEUTRAL" | "UNAVAILABLE";
  reasonCodes: string[];
  ruleVersion: string;
}

export interface CandidateLifecycleRecord {
  candidateId: string;
  symbol: string;
  mode: TradeMode;
  observedAt: string;
  status: CandidateStatus;
  direction: Direction;
  expiry: string | null;
  strike: number | null;
  side: "CE" | "PE" | null;
  entryLow: number | null;
  entryHigh: number | null;
  sl: number | null;
  t1: number | null;
  t2: number | null;
  t3: number | null;
  currentPremium: number | null;
  oppositePremium: number | null;
  reasonCodes: string[];
  evidenceQuality: EvidenceQuality;
  ruleVersion: string;
}

export interface OutcomeAttribution {
  candidateId: string;
  closedAt: string;
  outcome: "WIN" | "LOSS" | "SCRATCH" | "NO_ENTRY" | "EXPIRED" | "UNKNOWN";
  mfePct: number | null;
  maePct: number | null;
  timeToT1Minutes: number | null;
  timeToStopMinutes: number | null;
  regimeSurvivalCount: number;
  exitReasonCode: string | null;
  directionCorrect: boolean | null;
  timingCorrect: boolean | null;
  premiumSelectionCorrect: boolean | null;
  userDisciplineIssue: boolean | null;
  notes: string[];
}

export function normalizeEvidenceCompleteness(available: number, expected: number): number | null {
  if (!Number.isFinite(available) || !Number.isFinite(expected) || expected <= 0) return null;
  return Math.max(0, Math.min(100, (available / expected) * 100));
}

export function premiumPairRelation(selectedChangePct: number | null, oppositeChangePct: number | null): PremiumPairState["relation"] {
  if (selectedChangePct === null || oppositeChangePct === null) return "UNAVAILABLE";
  if (selectedChangePct > 0 && oppositeChangePct < 0) return "SELECTED_UP_OPPOSITE_DOWN";
  if (selectedChangePct > 0 && oppositeChangePct > 0) return "BOTH_UP";
  if (selectedChangePct < 0 && oppositeChangePct < 0) return "BOTH_DOWN";
  if (selectedChangePct < 0 && oppositeChangePct > 0) return "SELECTED_DOWN_OPPOSITE_UP";
  return "MIXED";
}
