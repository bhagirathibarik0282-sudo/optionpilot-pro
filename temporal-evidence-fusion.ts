import { dbQuerySafe } from "./db.js";

export type TemporalState =
  | "STRENGTHENING"
  | "STABLE"
  | "WEAKENING"
  | "REVERSING"
  | "CONFLICTING"
  | "INSUFFICIENT_DATA";

export type TemporalDirection = "UP" | "DOWN" | "FLAT" | "UNKNOWN";

export interface TemporalEvidenceSnapshot {
  symbol: string;
  timeframe: "3M" | "6M" | "15M" | "30M" | "60M";
  blockEnd: string;
  previousBlockEnd: string | null;
  state: TemporalState;
  direction: TemporalDirection;
  currentReturnPct: number | null;
  previousReturnPct: number | null;
  currentRangePct: number | null;
  previousRangePct: number | null;
  currentCoveragePct: number | null;
  previousCoveragePct: number | null;
  reasons: string[];
  ruleVersion: "TEF_FOUNDATION_V1";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
}

type TfRow = {
  block_end: string | Date;
  data_quality: string | null;
  evidence_compact: {
    coveragePct?: number;
    spot?: { open?: number; close?: number; high?: number; low?: number } | null;
  } | null;
};

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pct(from: number | null, to: number | null): number | null {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function rangePct(open: number | null, high: number | null, low: number | null): number | null {
  if (open == null || high == null || low == null || open === 0) return null;
  return ((high - low) / Math.abs(open)) * 100;
}

function directionFromReturn(ret: number | null): TemporalDirection {
  if (ret == null) return "UNKNOWN";
  if (ret > 0.02) return "UP";
  if (ret < -0.02) return "DOWN";
  return "FLAT";
}

function classify(
  currentRet: number | null,
  previousRet: number | null,
  currentRange: number | null,
  previousRange: number | null,
  currentCoverage: number | null,
  previousCoverage: number | null,
): { state: TemporalState; reasons: string[] } {
  const reasons: string[] = [];

  if (
    currentRet == null || previousRet == null ||
    currentCoverage == null || previousCoverage == null ||
    currentCoverage < 50 || previousCoverage < 50
  ) {
    reasons.push("Need two usable closed blocks with at least 50% sampling coverage.");
    return { state: "INSUFFICIENT_DATA", reasons };
  }

  const currDir = directionFromReturn(currentRet);
  const prevDir = directionFromReturn(previousRet);

  if (
    (currDir === "UP" && prevDir === "DOWN") ||
    (currDir === "DOWN" && prevDir === "UP")
  ) {
    reasons.push("Current closed block reversed the prior block direction.");
    return { state: "REVERSING", reasons };
  }

  if (currDir === "UNKNOWN" || prevDir === "UNKNOWN") {
    reasons.push("Directional evidence is unavailable.");
    return { state: "INSUFFICIENT_DATA", reasons };
  }

  if (currDir === "FLAT" && prevDir !== "FLAT") {
    reasons.push("Directional movement faded into a flat block.");
    return { state: "WEAKENING", reasons };
  }

  if (currDir !== "FLAT" && prevDir === "FLAT") {
    reasons.push("Directional movement emerged after a flat block.");
    return { state: "STRENGTHENING", reasons };
  }

  if (currDir !== prevDir) {
    reasons.push("Current and prior block directions do not agree cleanly.");
    return { state: "CONFLICTING", reasons };
  }

  if (currDir === "FLAT" && prevDir === "FLAT") {
    reasons.push("Both closed blocks are directionally flat.");
    return { state: "STABLE", reasons };
  }

  const currentAbs = Math.abs(currentRet);
  const previousAbs = Math.abs(previousRet);
  const rangeExpansion = currentRange != null && previousRange != null
    ? currentRange - previousRange
    : 0;

  if (currentAbs > previousAbs * 1.15 || rangeExpansion > 0.05) {
    reasons.push("Same-direction return and/or range expanded versus the prior block.");
    return { state: "STRENGTHENING", reasons };
  }

  if (currentAbs < previousAbs * 0.75) {
    reasons.push("Same-direction return materially weakened versus the prior block.");
    return { state: "WEAKENING", reasons };
  }

  reasons.push("Current and prior blocks remain directionally consistent without material expansion or contraction.");
  return { state: "STABLE", reasons };
}

function parseRow(row: TfRow) {
  const spot = row.evidence_compact?.spot ?? null;
  const open = finite(spot?.open);
  const close = finite(spot?.close);
  const high = finite(spot?.high);
  const low = finite(spot?.low);
  const coverage = finite(row.evidence_compact?.coveragePct);
  return {
    blockEnd: new Date(row.block_end).toISOString(),
    ret: pct(open, close),
    range: rangePct(open, high, low),
    coverage,
  };
}

export async function deriveTemporalEvidenceState(
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX",
  timeframe: "3M" | "6M" | "15M" | "30M" | "60M",
): Promise<TemporalEvidenceSnapshot> {
  const result = await dbQuerySafe<TfRow>(`
    SELECT block_end, data_quality, evidence_compact
    FROM timeframe_state
    WHERE symbol = $1 AND timeframe = $2
      AND state_code = 'RAW_BLOCK_ARCHIVE_ONLY'
    ORDER BY block_end DESC
    LIMIT 2
  `, [symbol, timeframe]);

  const rows = result?.rows ?? [];
  if (rows.length < 2) {
    return {
      symbol,
      timeframe,
      blockEnd: rows[0] ? new Date(rows[0].block_end).toISOString() : new Date(0).toISOString(),
      previousBlockEnd: null,
      state: "INSUFFICIENT_DATA",
      direction: "UNKNOWN",
      currentReturnPct: null,
      previousReturnPct: null,
      currentRangePct: null,
      previousRangePct: null,
      currentCoveragePct: null,
      previousCoveragePct: null,
      reasons: ["Two closed timeframe blocks are not yet available."],
      ruleVersion: "TEF_FOUNDATION_V1",
      affectsVerdict: false,
      affectsTelegram: false,
      affectsExecution: false,
    };
  }

  const current = parseRow(rows[0]);
  const previous = parseRow(rows[1]);
  const classified = classify(
    current.ret,
    previous.ret,
    current.range,
    previous.range,
    current.coverage,
    previous.coverage,
  );

  return {
    symbol,
    timeframe,
    blockEnd: current.blockEnd,
    previousBlockEnd: previous.blockEnd,
    state: classified.state,
    direction: directionFromReturn(current.ret),
    currentReturnPct: current.ret,
    previousReturnPct: previous.ret,
    currentRangePct: current.range,
    previousRangePct: previous.range,
    currentCoveragePct: current.coverage,
    previousCoveragePct: previous.coverage,
    reasons: classified.reasons,
    ruleVersion: "TEF_FOUNDATION_V1",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
  };
}
