import type { HistoricalCandidateQualitySnapshot } from "./h1-candidate-quality.js";

export type CandidateHistorySide = "CE" | "PE";
export type CandidateHistoryStatus = "OBSERVED" | "REJECTED" | "UNAVAILABLE";

export interface CandidateHistoryRecord {
  candidateId: string;
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  observedAt: string;
  side: CandidateHistorySide | null;
  expiry: string | null;
  strike: number | null;
  dte: number | null;
  ltp: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  intrinsic: number | null;
  extrinsic: number | null;
  spread: number | null;
  volume: number | null;
  oi: number | null;
  grade: HistoricalCandidateQualitySnapshot["grade"];
  status: CandidateHistoryStatus;
  reasonCode: string;
  selectionVersion: string;
}

export interface CandidateHistoryInput {
  candidateId: string;
  symbol: CandidateHistoryRecord["symbol"];
  observedAt: string;
  quality: HistoricalCandidateQualitySnapshot;
  side?: CandidateHistorySide | null;
  expiry?: string | null;
  strike?: number | null;
  dte?: number | null;
  ltp?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  vega?: number | null;
  theta?: number | null;
  intrinsic?: number | null;
  extrinsic?: number | null;
  spread?: number | null;
  volume?: number | null;
  oi?: number | null;
  selectionVersion?: string;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validIso(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(new Date(value).getTime());
}

function reasonCode(quality: HistoricalCandidateQualitySnapshot): string {
  if (quality.grade === "UNAVAILABLE") return "QUALITY_UNAVAILABLE";
  if (quality.grade === "REJECT") return "QUALITY_REJECT";
  return "QUALITY_OBSERVED";
}

export function buildCandidateHistoryRecord(input: CandidateHistoryInput): CandidateHistoryRecord | null {
  if (!input.candidateId.trim() || !validIso(input.observedAt)) return null;
  if (input.quality.semantics !== "HISTORICAL_RESEARCH_ONLY") return null;

  const status: CandidateHistoryStatus = input.quality.grade === "UNAVAILABLE"
    ? "UNAVAILABLE"
    : input.quality.grade === "REJECT"
      ? "REJECTED"
      : "OBSERVED";

  return {
    candidateId: input.candidateId,
    symbol: input.symbol,
    observedAt: new Date(input.observedAt).toISOString(),
    side: input.side ?? null,
    expiry: input.expiry ?? null,
    strike: finiteOrNull(input.strike),
    dte: finiteOrNull(input.dte),
    ltp: finiteOrNull(input.ltp),
    iv: finiteOrNull(input.iv),
    delta: finiteOrNull(input.delta),
    gamma: finiteOrNull(input.gamma),
    vega: finiteOrNull(input.vega),
    theta: finiteOrNull(input.theta),
    intrinsic: finiteOrNull(input.intrinsic),
    extrinsic: finiteOrNull(input.extrinsic),
    spread: finiteOrNull(input.spread),
    volume: finiteOrNull(input.volume),
    oi: finiteOrNull(input.oi),
    grade: input.quality.grade,
    status,
    reasonCode: reasonCode(input.quality),
    selectionVersion: input.selectionVersion ?? input.quality.ruleVersion,
  };
}
