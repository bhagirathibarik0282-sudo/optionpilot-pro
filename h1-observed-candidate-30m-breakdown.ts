import type { ExecutionDteBucket } from "./execution-candidate-selector.js";
import type { H1ReplaySymbol } from "./h1-replay-http.js";
import type { ObservedCandidate30mSample } from "./h1-observed-candidate-30m-gross.js";

export interface ObservedCandidate30mBreakdownCell {
  symbol: H1ReplaySymbol;
  side: "CE" | "PE";
  dteBucket: Exclude<ExecutionDteBucket, "UNSUPPORTED">;
  sampleCount: number;
  positiveCount: number;
  lossCount: number;
  flatCount: number;
  positiveRatePct: number;
  lossRatePct: number;
  averageGrossReturnPct: number;
  medianGrossReturnPct: number;
  bestGrossReturnPct: number;
  worstGrossReturnPct: number;
}

export interface ObservedCandidate30mBreakdownResult {
  state: "USABLE" | "UNAVAILABLE";
  totalSamples: number;
  includedSamples: number;
  excludedUnsupportedDte: number;
  cells: ObservedCandidate30mBreakdownCell[];
  blockers: string[];
  semantics: "OBSERVED_H1_EXACT30M_GROSS_BREAKDOWN_ONLY_NOT_SELECTOR_OR_PROFIT_PROOF";
  dtePolicy: "EXECUTION_CANDIDATE_SELECTOR_V2_DTE_BUCKETS_REUSED";
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  createsOrders: false;
  aiMayOverride: false;
}

function classifyDte(symbol: H1ReplaySymbol, dte: number): Exclude<ExecutionDteBucket, "UNSUPPORTED"> | null {
  if (!Number.isInteger(dte) || dte < 0) return null;
  if (symbol === "NIFTY" || symbol === "SENSEX") {
    if (dte <= 1) return "EXPIRY_0_1";
    if (dte <= 4) return "NEAR_2_4";
    if (dte <= 7) return "FALLBACK_5_7";
    return null;
  }
  if (symbol === "BANKNIFTY" && dte >= 10 && dte <= 35) return "BANKNIFTY_HIGHER_10_35";
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildObservedCandidate30mBreakdown(
  symbol: H1ReplaySymbol,
  samples: ObservedCandidate30mSample[],
): ObservedCandidate30mBreakdownResult {
  const groups = new Map<string, { side: "CE" | "PE"; dteBucket: Exclude<ExecutionDteBucket, "UNSUPPORTED">; values: number[] }>();
  let excludedUnsupportedDte = 0;

  for (const sample of samples) {
    if (sample.symbol !== symbol) continue;
    const dteBucket = classifyDte(symbol, sample.dte);
    if (!dteBucket) {
      excludedUnsupportedDte++;
      continue;
    }
    const key = `${sample.side}|${dteBucket}`;
    const group = groups.get(key) ?? { side: sample.side, dteBucket, values: [] };
    group.values.push(sample.grossReturnPct);
    groups.set(key, group);
  }

  const cells = [...groups.values()]
    .map((group): ObservedCandidate30mBreakdownCell => {
      const values = group.values;
      const positiveCount = values.filter((v) => v > 0).length;
      const lossCount = values.filter((v) => v < 0).length;
      const flatCount = values.length - positiveCount - lossCount;
      return {
        symbol,
        side: group.side,
        dteBucket: group.dteBucket,
        sampleCount: values.length,
        positiveCount,
        lossCount,
        flatCount,
        positiveRatePct: positiveCount / values.length * 100,
        lossRatePct: lossCount / values.length * 100,
        averageGrossReturnPct: values.reduce((a, b) => a + b, 0) / values.length,
        medianGrossReturnPct: median(values),
        bestGrossReturnPct: Math.max(...values),
        worstGrossReturnPct: Math.min(...values),
      };
    })
    .sort((a, b) => `${a.side}|${a.dteBucket}`.localeCompare(`${b.side}|${b.dteBucket}`));

  const blockers: string[] = [];
  if (!cells.length) blockers.push("NO_SUPPORTED_DTE_OBSERVED_CANDIDATE_30M_SAMPLES");

  return {
    state: blockers.length ? "UNAVAILABLE" : "USABLE",
    totalSamples: samples.length,
    includedSamples: cells.reduce((n, cell) => n + cell.sampleCount, 0),
    excludedUnsupportedDte,
    cells,
    blockers,
    semantics: "OBSERVED_H1_EXACT30M_GROSS_BREAKDOWN_ONLY_NOT_SELECTOR_OR_PROFIT_PROOF",
    dtePolicy: "EXECUTION_CANDIDATE_SELECTOR_V2_DTE_BUCKETS_REUSED",
    affectsVerdict: false,
    affectsTelegram: false,
    affectsExecution: false,
    createsOrders: false,
    aiMayOverride: false,
  };
}
