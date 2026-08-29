import type { CandidateLifecycleRecord, CandidateStatus, Direction, EvidenceQuality, PremiumPairState, TradeMode } from "./h1-derived-history.js";
import { premiumPairRelation } from "./h1-derived-history.js";

export type RegimeSurvivalState = "SURVIVED" | "DEGRADED" | "RECOVERED" | "INVALIDATED" | "UNAVAILABLE";

export interface PremiumPairObservation {
  selectedSide: "CE" | "PE";
  selectedLtp: number | null;
  oppositeLtp: number | null;
  previousSelectedLtp: number | null;
  previousOppositeLtp: number | null;
}

export interface LifecycleObservationInput {
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
  premiumPair?: PremiumPairObservation | null;
  evidenceQuality: EvidenceQuality;
  priorRegime?: string | null;
  currentRegime?: string | null;
  thesisIntact?: boolean | null;
  priorSurvivalCount?: number | null;
  reasonCodes?: string[];
}

export interface LifecycleHistorySnapshot {
  lifecycle: CandidateLifecycleRecord;
  premiumPair: PremiumPairState | null;
  regimeSurvivalState: RegimeSurvivalState;
  regimeSurvivalCount: number;
  semantics: "HISTORICAL_RESEARCH_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  ruleVersion: "H1_EXECUTION_LIFECYCLE_V1";
}

function pctChange(previous: number | null, current: number | null): number | null {
  if (previous == null || current == null || !Number.isFinite(previous) || !Number.isFinite(current) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function derivePremiumPairObservation(input: PremiumPairObservation | null | undefined): PremiumPairState | null {
  if (!input) return null;
  const selectedChangePct = pctChange(input.previousSelectedLtp, input.selectedLtp);
  const oppositeChangePct = pctChange(input.previousOppositeLtp, input.oppositeLtp);
  return {
    selectedSide: input.selectedSide,
    selectedLtp: input.selectedLtp,
    oppositeLtp: input.oppositeLtp,
    selectedChangePct,
    oppositeChangePct,
    relation: premiumPairRelation(selectedChangePct, oppositeChangePct),
  };
}

export function classifyRegimeSurvival(input: Pick<LifecycleObservationInput, "priorRegime" | "currentRegime" | "thesisIntact" | "priorSurvivalCount">): { state: RegimeSurvivalState; count: number } {
  const previous = Math.max(0, input.priorSurvivalCount ?? 0);
  if (input.thesisIntact === false) return { state: "INVALIDATED", count: previous };
  if (!input.priorRegime || !input.currentRegime || input.thesisIntact == null) return { state: "UNAVAILABLE", count: previous };
  if (input.priorRegime === input.currentRegime && input.thesisIntact === true) return { state: "SURVIVED", count: previous + 1 };
  if (input.thesisIntact === true && input.currentRegime === "TRANSITION") return { state: "DEGRADED", count: previous };
  if (input.thesisIntact === true && input.priorRegime === "TRANSITION" && input.currentRegime !== "TRANSITION") return { state: "RECOVERED", count: previous + 1 };
  return { state: "DEGRADED", count: previous };
}

/**
 * Historical-only lifecycle adapter.
 * It never creates or changes a live trade state; the caller supplies the already-determined status.
 */
export function buildLifecycleHistorySnapshot(input: LifecycleObservationInput): LifecycleHistorySnapshot {
  const premiumPair = derivePremiumPairObservation(input.premiumPair);
  const survival = classifyRegimeSurvival(input);
  const reasonCodes = [
    ...(input.reasonCodes ?? []),
    `REGIME_SURVIVAL:${survival.state}`,
    ...(premiumPair ? [`PREMIUM_PAIR:${premiumPair.relation}`] : []),
  ];

  return {
    lifecycle: {
      candidateId: input.candidateId,
      symbol: input.symbol,
      mode: input.mode,
      observedAt: input.observedAt,
      status: input.status,
      direction: input.direction,
      expiry: input.expiry,
      strike: input.strike,
      side: input.side,
      entryLow: input.entryLow,
      entryHigh: input.entryHigh,
      sl: input.sl,
      t1: input.t1,
      t2: input.t2,
      t3: input.t3,
      currentPremium: premiumPair?.selectedLtp ?? null,
      oppositePremium: premiumPair?.oppositeLtp ?? null,
      reasonCodes,
      evidenceQuality: input.evidenceQuality,
      ruleVersion: "H1_EXECUTION_LIFECYCLE_V1",
    },
    premiumPair,
    regimeSurvivalState: survival.state,
    regimeSurvivalCount: survival.count,
    semantics: "HISTORICAL_RESEARCH_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    ruleVersion: "H1_EXECUTION_LIFECYCLE_V1",
  };
}
