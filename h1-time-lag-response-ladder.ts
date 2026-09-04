import type { TemporalEvidenceSnapshot } from "./temporal-evidence-fusion.js";

export type H1ResponseStage =
  | "EARLY_CLUE"
  | "INITIAL_CONFIRMATION"
  | "TRANSITION_VALIDATION"
  | "SUSTAINED_REGIME_CONFIRMATION";

export interface H1ResponseStageView {
  timeframe: "3M" | "6M" | "15M" | "30M";
  stage: H1ResponseStage;
  direction: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
  confirmed: boolean;
  blockEnd: string;
  observedBlockEndOffsetMinutesFrom3m: number | null;
  blockers: string[];
}

export interface H1TimeLagResponseLadder {
  version: "H1_TIME_LAG_RESPONSE_LADDER_V1";
  ready: boolean;
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX" | null;
  anchorDirection: "UP" | "DOWN" | null;
  highestConfirmedStage: H1ResponseStage | null;
  causalLagAvailable: false;
  stages: H1ResponseStageView[];
  blockers: string[];
  semantics: "OBSERVED_CLOSED_BLOCK_SEQUENCE_ONLY_NO_CAUSAL_CLAIM";
  productionImpact: "NONE";
  readOnly: true;
  forwardsDownstream: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  grantsPromotionAuthority: false;
  failClosed: true;
}

const ORDER = ["3M", "6M", "15M", "30M"] as const;
const STAGE: Record<(typeof ORDER)[number], H1ResponseStage> = {
  "3M": "EARLY_CLUE",
  "6M": "INITIAL_CONFIRMATION",
  "15M": "TRANSITION_VALIDATION",
  "30M": "SUSTAINED_REGIME_CONFIRMATION",
};

function safe(row: TemporalEvidenceSnapshot): boolean {
  return row.affectsVerdict === false && row.affectsTelegram === false && row.affectsExecution === false;
}

function usableDirection(row: TemporalEvidenceSnapshot): row is TemporalEvidenceSnapshot & { direction: "UP" | "DOWN" } {
  return (row.direction === "UP" || row.direction === "DOWN") &&
    row.state !== "INSUFFICIENT_DATA" && row.state !== "CONFLICTING" && row.state !== "REVERSING";
}

export function buildH1TimeLagResponseLadder(
  inputs: TemporalEvidenceSnapshot[],
  maxTimestampSkewMs = 180_000,
): H1TimeLagResponseLadder {
  const blockers: string[] = [];
  if (!Array.isArray(inputs)) blockers.push("MISSING_TEMPORAL_INPUTS");
  if (!Number.isFinite(maxTimestampSkewMs) || maxTimestampSkewMs <= 0) blockers.push("INVALID_TIMESTAMP_SKEW_POLICY");

  const rows = new Map<(typeof ORDER)[number], TemporalEvidenceSnapshot>();
  for (const timeframe of ORDER) {
    const matches = Array.isArray(inputs) ? inputs.filter((x) => x.timeframe === timeframe && safe(x)) : [];
    if (matches.length !== 1) blockers.push(matches.length === 0 ? `MISSING_${timeframe}_STATE` : `DUPLICATE_${timeframe}_STATE`);
    else rows.set(timeframe, matches[0]);
  }

  const symbols = new Set([...rows.values()].map((x) => x.symbol));
  if (symbols.size > 1) blockers.push("TEMPORAL_SYMBOL_MISMATCH");

  const anchor = rows.get("3M");
  const anchorDirection = anchor && usableDirection(anchor) ? anchor.direction : null;
  if (!anchorDirection) blockers.push("3M_DIRECTIONAL_CLUE_UNAVAILABLE");

  const anchorMs = anchor ? Date.parse(anchor.blockEnd) : NaN;
  const times = [...rows.values()].map((x) => Date.parse(x.blockEnd));
  if (times.some((x) => !Number.isFinite(x))) blockers.push("INVALID_BLOCK_END_TIME");
  if (times.length === 4 && Math.max(...times) - Math.min(...times) > maxTimestampSkewMs) blockers.push("TEMPORAL_BLOCK_SKEW_TOO_LARGE");

  let chainIntact = blockers.length === 0;
  let highest: H1ResponseStage | null = null;
  const stages: H1ResponseStageView[] = ORDER.map((timeframe) => {
    const row = rows.get(timeframe);
    const stageBlockers: string[] = [];
    let confirmed = false;
    if (!row) stageBlockers.push("STATE_UNAVAILABLE");
    else if (!usableDirection(row)) stageBlockers.push("DIRECTIONAL_STATE_NOT_USABLE");
    else if (!anchorDirection) stageBlockers.push("ANCHOR_DIRECTION_UNAVAILABLE");
    else if (row.direction !== anchorDirection) stageBlockers.push("DIRECTION_CONFLICTS_WITH_3M_ANCHOR");
    else if (!chainIntact) stageBlockers.push("PRIOR_STAGE_NOT_CONFIRMED");
    else confirmed = true;

    if (confirmed) highest = STAGE[timeframe];
    else chainIntact = false;

    const blockMs = row ? Date.parse(row.blockEnd) : NaN;
    const offset = Number.isFinite(anchorMs) && Number.isFinite(blockMs) ? (blockMs - anchorMs) / 60_000 : null;
    return {
      timeframe,
      stage: STAGE[timeframe],
      direction: row?.direction ?? "UNKNOWN",
      confirmed,
      blockEnd: row?.blockEnd ?? new Date(0).toISOString(),
      observedBlockEndOffsetMinutesFrom3m: offset,
      blockers: stageBlockers,
    };
  });

  return {
    version: "H1_TIME_LAG_RESPONSE_LADDER_V1",
    ready: blockers.length === 0,
    symbol: symbols.size === 1 ? ([...symbols][0] as H1TimeLagResponseLadder["symbol"]) : null,
    anchorDirection,
    highestConfirmedStage: highest,
    causalLagAvailable: false,
    stages,
    blockers: [...new Set(blockers)],
    semantics: "OBSERVED_CLOSED_BLOCK_SEQUENCE_ONLY_NO_CAUSAL_CLAIM",
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
