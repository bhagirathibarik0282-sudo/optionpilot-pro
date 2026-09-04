import type { TemporalEvidenceSnapshot } from "./temporal-evidence-fusion.js";

export type H1BreadthActorState = "LEADING" | "CONFIRMING" | "LAGGING" | "FADING" | "BLOCKED";
export type H1BreadthDirection = "UP" | "DOWN";

export interface H1CrossIndexBreadthRow {
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX";
  state: H1BreadthActorState;
  direction: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
  temporalState: TemporalEvidenceSnapshot["state"];
  blockEnd: string;
  blockers: string[];
}

export interface H1CrossIndexBreadthEvidence {
  version: "H1_CROSS_INDEX_BREADTH_STATE_V1";
  ready: boolean;
  timeframe: "15M";
  consensusDirection: H1BreadthDirection | null;
  usableIndexCount: number;
  rows: H1CrossIndexBreadthRow[];
  heavyweightDetailAvailable: false;
  sectorDetailAvailable: false;
  heavyweightDetailStatus: "UNAVAILABLE";
  sectorDetailStatus: "UNAVAILABLE";
  blockers: string[];
  semantics: "CROSS_INDEX_OBSERVATIONAL_BREADTH_ONLY_NO_CONSTITUENT_INFERENCE";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

const VERSION = "H1_CROSS_INDEX_BREADTH_STATE_V1" as const;
const SEMANTICS = "CROSS_INDEX_OBSERVATIONAL_BREADTH_ONLY_NO_CONSTITUENT_INFERENCE" as const;
const SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

function authoritySafe(row: TemporalEvidenceSnapshot): boolean {
  return row.affectsVerdict === false && row.affectsTelegram === false && row.affectsExecution === false;
}

function validRow(row: TemporalEvidenceSnapshot | null | undefined): row is TemporalEvidenceSnapshot {
  return !!row && SYMBOLS.includes(row.symbol as (typeof SYMBOLS)[number]) &&
    row.timeframe === "15M" && Number.isFinite(Date.parse(row.blockEnd)) && authoritySafe(row);
}

function classify(row: TemporalEvidenceSnapshot, consensus: H1BreadthDirection | null): H1BreadthActorState {
  if (!consensus) return "BLOCKED";
  if (row.direction === "UNKNOWN" || row.direction === "FLAT") return "LAGGING";
  if (row.direction !== consensus) return "BLOCKED";
  if (row.state === "STRENGTHENING") return "LEADING";
  if (row.state === "WEAKENING") return "FADING";
  if (row.state === "STABLE") return "CONFIRMING";
  return "BLOCKED";
}

export function buildH1CrossIndexBreadthState(
  inputs: TemporalEvidenceSnapshot[],
): H1CrossIndexBreadthEvidence {
  const blockers: string[] = [];
  if (!Array.isArray(inputs)) blockers.push("MISSING_CROSS_INDEX_TEMPORAL_INPUTS");
  const valid = Array.isArray(inputs) ? inputs.filter(validRow) : [];
  const seen = new Set<string>();
  for (const row of valid) {
    if (seen.has(row.symbol)) blockers.push(`DUPLICATE_INDEX_INPUT:${row.symbol}`);
    seen.add(row.symbol);
  }
  for (const symbol of SYMBOLS) {
    if (!valid.some((row) => row.symbol === symbol)) blockers.push(`MISSING_15M_INDEX_STATE:${symbol}`);
  }

  const usable = valid.filter((row) => row.direction === "UP" || row.direction === "DOWN");
  const up = usable.filter((row) => row.direction === "UP").length;
  const down = usable.filter((row) => row.direction === "DOWN").length;
  const consensusDirection: H1BreadthDirection | null = up >= 2 ? "UP" : down >= 2 ? "DOWN" : null;
  if (usable.length < 2) blockers.push("INSUFFICIENT_USABLE_INDEX_DIRECTIONS");
  if (!consensusDirection) blockers.push("CROSS_INDEX_DIRECTION_CONSENSUS_UNAVAILABLE");

  const rows = valid.map((row): H1CrossIndexBreadthRow => {
    const rowBlockers: string[] = [];
    const state = classify(row, consensusDirection);
    if (state === "BLOCKED") {
      if (!consensusDirection) rowBlockers.push("CONSENSUS_UNAVAILABLE");
      else if (row.direction === "UP" || row.direction === "DOWN") rowBlockers.push("INDEX_DIRECTION_CONFLICTS_WITH_CONSENSUS");
      else rowBlockers.push("INDEX_TEMPORAL_STATE_NOT_CLASSIFIABLE");
    }
    return {
      symbol: row.symbol as H1CrossIndexBreadthRow["symbol"],
      state,
      direction: row.direction,
      temporalState: row.state,
      blockEnd: row.blockEnd,
      blockers: rowBlockers,
    };
  });

  const ready = blockers.length === 0 && rows.length === 3;
  return {
    version: VERSION,
    ready,
    timeframe: "15M",
    consensusDirection: ready ? consensusDirection : null,
    usableIndexCount: usable.length,
    rows,
    heavyweightDetailAvailable: false,
    sectorDetailAvailable: false,
    heavyweightDetailStatus: "UNAVAILABLE",
    sectorDetailStatus: "UNAVAILABLE",
    blockers: [...new Set(blockers)],
    semantics: SEMANTICS,
    productionImpact: "NONE",
    readOnly: true,
    forwardsDownstream: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    grantsPromotionAuthority: false,
    failClosed: true,
  };
}
