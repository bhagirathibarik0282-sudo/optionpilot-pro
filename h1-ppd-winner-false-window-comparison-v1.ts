import type { PpdSide } from "./h1-premium-pair-divergence-v1.js";

export const H1_PPD_WINNER_FALSE_COMPARISON_VERSION = "H1_PPD_WINNER_FALSE_COMPARISON_V1" as const;

export type PpdBusinessLabel =
  | "WINNER"
  | "FALSE"
  | "TOO_EARLY"
  | "CHASED_LATE"
  | "REVERSAL_TRAP"
  | "NEUTRAL";

export type PpdBusinessWindow = {
  tradeDate: string;
  to: string;
  windowMinutes: 3 | 6 | 15;
  dte: number;
  expiry: string;
  strike: number;
  side: PpdSide;
  label: PpdBusinessLabel;
  expansionStrengthPct: number;
  oppositeCollapseStrengthPct: number;
  netPpdSeparationPp: number;
  ppdRatePpPerMinute: number;
  multiDteAlignment?: "ALL_CE" | "ALL_PE" | "MIXED" | "NO_CONTROL" | "INSUFFICIENT" | null;
  crossDteConflict?: boolean | null;
  outcomePct?: number | null;
};

function finite(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}

function summarizeGroup(windows: PpdBusinessWindow[]) {
  const expansion = finite(windows.map((x) => x.expansionStrengthPct));
  const collapse = finite(windows.map((x) => x.oppositeCollapseStrengthPct));
  const separation = finite(windows.map((x) => x.netPpdSeparationPp));
  const rate = finite(windows.map((x) => Math.abs(x.ppdRatePpPerMinute)));
  const outcomes = finite(windows.map((x) => x.outcomePct));
  const conflictCount = windows.filter((x) => x.crossDteConflict === true).length;
  const alignedCount = windows.filter((x) => {
    if (!x.multiDteAlignment) return false;
    return (x.side === "CE" && x.multiDteAlignment === "ALL_CE")
      || (x.side === "PE" && x.multiDteAlignment === "ALL_PE");
  }).length;
  return {
    count: windows.length,
    expansionStrengthPct: { average: avg(expansion), median: median(expansion) },
    oppositeCollapseStrengthPct: { average: avg(collapse), median: median(collapse) },
    netPpdSeparationPp: { average: avg(separation), median: median(separation) },
    absolutePpdRatePpPerMinute: { average: avg(rate), median: median(rate) },
    outcomePct: { average: avg(outcomes), median: median(outcomes), observedCount: outcomes.length },
    crossDteConflictCount: conflictCount,
    alignedMultiDteCount: alignedCount,
  };
}

export function buildPpdWinnerFalseWindowComparison(windows: PpdBusinessWindow[]) {
  const valid = windows.filter((x) =>
    Number.isFinite(x.expansionStrengthPct)
    && Number.isFinite(x.oppositeCollapseStrengthPct)
    && Number.isFinite(x.netPpdSeparationPp)
    && Number.isFinite(x.ppdRatePpPerMinute)
    && x.netPpdSeparationPp >= 0,
  );

  const labels: PpdBusinessLabel[] = ["WINNER", "FALSE", "TOO_EARLY", "CHASED_LATE", "REVERSAL_TRAP", "NEUTRAL"];
  const byLabel = Object.fromEntries(labels.map((label) => {
    const group = valid.filter((x) => x.label === label);
    return [label, summarizeGroup(group)];
  })) as Record<PpdBusinessLabel, ReturnType<typeof summarizeGroup>>;

  const winners = valid.filter((x) => x.label === "WINNER");
  const nonWinners = valid.filter((x) => x.label !== "WINNER");
  const winnerSummary = summarizeGroup(winners);
  const nonWinnerSummary = summarizeGroup(nonWinners);

  const descriptiveDifference = {
    expansionMedianPct: winnerSummary.expansionStrengthPct.median != null && nonWinnerSummary.expansionStrengthPct.median != null
      ? winnerSummary.expansionStrengthPct.median - nonWinnerSummary.expansionStrengthPct.median
      : null,
    collapseMedianPct: winnerSummary.oppositeCollapseStrengthPct.median != null && nonWinnerSummary.oppositeCollapseStrengthPct.median != null
      ? winnerSummary.oppositeCollapseStrengthPct.median - nonWinnerSummary.oppositeCollapseStrengthPct.median
      : null,
    separationMedianPp: winnerSummary.netPpdSeparationPp.median != null && nonWinnerSummary.netPpdSeparationPp.median != null
      ? winnerSummary.netPpdSeparationPp.median - nonWinnerSummary.netPpdSeparationPp.median
      : null,
    absoluteRateMedianPpPerMinute: winnerSummary.absolutePpdRatePpPerMinute.median != null && nonWinnerSummary.absolutePpdRatePpPerMinute.median != null
      ? winnerSummary.absolutePpdRatePpPerMinute.median - nonWinnerSummary.absolutePpdRatePpPerMinute.median
      : null,
  };

  return {
    ok: valid.length > 0,
    version: H1_PPD_WINNER_FALSE_COMPARISON_VERSION,
    productionImpact: "NONE" as const,
    researchOnly: true as const,
    inputCount: windows.length,
    validCount: valid.length,
    invalidCount: windows.length - valid.length,
    byLabel,
    winnerVsNonWinner: {
      winners: winnerSummary,
      nonWinners: nonWinnerSummary,
      descriptiveDifference,
    },
    interpretation: {
      descriptiveOnly: true as const,
      thresholdPromoted: false as const,
      noFixedTradeCountRule: true as const,
      ppdIsEvidenceNotStandaloneTrigger: true as const,
      requiresEntryTimeLabelsAndForwardOutcomeSeparation: true as const,
    },
    safety: {
      affectsSelector: false as const,
      affectsTelegram: false as const,
      affectsVerdict: false as const,
      affectsExecution: false as const,
      brokerCallMade: false as const,
      placesOrder: false as const,
    },
  };
}
