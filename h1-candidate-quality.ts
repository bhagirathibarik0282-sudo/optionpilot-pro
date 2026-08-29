import type { TemporalDirection, TemporalEvidenceSnapshot } from "./temporal-evidence-fusion.js";
import type { FamilyStateFusionSnapshot } from "./family-state-fusion.js";

export type HorizonAlignment = "FULL" | "PARTIAL" | "CONFLICT" | "UNAVAILABLE";
export type HistoricalCandidateGrade = "A_PLUS" | "A" | "B" | "REJECT" | "UNAVAILABLE";

export interface CandidateQualityInputs {
  scalp?: TemporalEvidenceSnapshot | null;
  intraday?: TemporalEvidenceSnapshot | null;
  swing?: TemporalEvidenceSnapshot | null;
  fusion?: FamilyStateFusionSnapshot | null;
  evidenceCompletenessPct?: number | null;
  liquidityAcceptable?: boolean | null;
  overextended?: boolean | null;
  noChase?: boolean | null;
}

export interface HistoricalCandidateQualitySnapshot {
  alignment: HorizonAlignment;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL" | "CONFLICTING";
  grade: HistoricalCandidateGrade;
  usableHorizons: number;
  alignedHorizons: number;
  overextended: boolean;
  noChase: boolean;
  liquidityAcceptable: boolean | null;
  evidenceCompletenessPct: number | null;
  reasons: string[];
  ruleVersion: "H1_CANDIDATE_QUALITY_V1";
  semantics: "HISTORICAL_RESEARCH_ONLY";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

function usableDirection(v: TemporalDirection | undefined): v is "UP" | "DOWN" {
  return v === "UP" || v === "DOWN";
}

function collectDirections(input: CandidateQualityInputs): Array<"UP" | "DOWN"> {
  const dirs = [input.scalp?.direction, input.intraday?.direction, input.swing?.direction];
  return dirs.filter(usableDirection);
}

function directionFrom(dirs: Array<"UP" | "DOWN">): HistoricalCandidateQualitySnapshot["direction"] {
  if (dirs.length === 0) return "NEUTRAL";
  const up = dirs.filter((d) => d === "UP").length;
  const down = dirs.length - up;
  if (up > 0 && down > 0) return "CONFLICTING";
  return up > 0 ? "BULLISH" : "BEARISH";
}

function alignmentFrom(dirs: Array<"UP" | "DOWN">): HorizonAlignment {
  if (dirs.length < 2) return "UNAVAILABLE";
  const first = dirs[0];
  const aligned = dirs.filter((d) => d === first).length;
  if (aligned === dirs.length && dirs.length === 3) return "FULL";
  if (aligned === dirs.length) return "PARTIAL";
  return "CONFLICT";
}

function clampPct(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
}

/** Historical-only classifier. It must never create a live trade verdict. */
export function deriveHistoricalCandidateQuality(input: CandidateQualityInputs): HistoricalCandidateQualitySnapshot {
  const dirs = collectDirections(input);
  const direction = directionFrom(dirs);
  const alignment = alignmentFrom(dirs);
  const overextended = input.overextended === true;
  const noChase = input.noChase === true;
  const liquidity = input.liquidityAcceptable ?? null;
  const completeness = clampPct(input.evidenceCompletenessPct);
  const reasons: string[] = [];

  if (dirs.length === 0) reasons.push("No usable closed-horizon direction is available.");
  if (alignment === "CONFLICT") reasons.push("Closed-horizon directions conflict.");
  if (alignment === "FULL") reasons.push("All three usable horizons align directionally.");
  if (alignment === "PARTIAL") reasons.push("Two usable horizons align; full three-horizon confirmation is unavailable.");
  if (input.fusion?.state === "CONFLICTING") reasons.push("Evidence-family fusion is conflicting.");
  if (input.fusion?.state === "WARNING") reasons.push("Evidence-family fusion carries a warning.");
  if (liquidity === false) reasons.push("Liquidity/executability gate is not acceptable.");
  if (overextended) reasons.push("Candidate is overextended; historical direction may remain valid while fresh entry quality is poor.");
  if (noChase) reasons.push("No-chase rule is active.");
  if (completeness != null && completeness < 60) reasons.push("Evidence completeness is below 60%. ");

  let grade: HistoricalCandidateGrade = "UNAVAILABLE";
  const fusionSupportive = input.fusion?.state === "SUPPORTIVE";
  const fusionBlocked = input.fusion?.state === "CONFLICTING" || input.fusion?.state === "INSUFFICIENT_DATA";

  if (dirs.length < 2 || completeness == null) {
    grade = "UNAVAILABLE";
  } else if (alignment === "CONFLICT" || fusionBlocked || liquidity === false || overextended || noChase || completeness < 50) {
    grade = "REJECT";
  } else if (alignment === "FULL" && fusionSupportive && completeness >= 85 && liquidity === true) {
    grade = "A_PLUS";
  } else if ((alignment === "FULL" || alignment === "PARTIAL") && completeness >= 70 && input.fusion?.state !== "WARNING") {
    grade = "A";
  } else {
    grade = "B";
  }

  return {
    alignment,
    direction,
    grade,
    usableHorizons: dirs.length,
    alignedHorizons: dirs.length === 0 ? 0 : Math.max(dirs.filter((d) => d === "UP").length, dirs.filter((d) => d === "DOWN").length),
    overextended,
    noChase,
    liquidityAcceptable: liquidity,
    evidenceCompletenessPct: completeness,
    reasons,
    ruleVersion: "H1_CANDIDATE_QUALITY_V1",
    semantics: "HISTORICAL_RESEARCH_ONLY",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}
