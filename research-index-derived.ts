import type {
  ResearchIndexDailyRecord,
  ResearchIndexDerivedEngine,
  ResearchIndexMetrics,
} from "./research-index-types";

const LOOKBACKS = [1, 5, 20, 60, 120, 252] as const;

type Lookback = (typeof LOOKBACKS)[number];

function pctReturn(current: number, previous: number | undefined): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || !previous || previous <= 0) return null;
  return (current / previous - 1) * 100;
}

function byTradeDate(history: ResearchIndexDailyRecord[]): ResearchIndexDailyRecord[] {
  return [...history]
    .filter((row) => row.validationStatus !== "INVALID")
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

function returnAt(history: ResearchIndexDailyRecord[], index: number, lookback: Lookback): number | null {
  const previous = history[index - lookback];
  if (!previous) return null;
  return pctReturn(history[index].close, previous.close);
}

function benchmarkReturns(
  history: ResearchIndexDailyRecord[],
): Map<string, { r5: number | null; r20: number | null; r60: number | null }> {
  const sorted = byTradeDate(history);
  const map = new Map<string, { r5: number | null; r20: number | null; r60: number | null }>();

  sorted.forEach((row, index) => {
    map.set(row.tradeDate, {
      r5: returnAt(sorted, index, 5),
      r20: returnAt(sorted, index, 20),
      r60: returnAt(sorted, index, 60),
    });
  });

  return map;
}

function relativeStrength(indexReturn: number | null, benchmarkReturn: number | null): number | null {
  if (indexReturn === null || benchmarkReturn === null) return null;
  return indexReturn - benchmarkReturn;
}

export class DefaultResearchIndexDerivedEngine implements ResearchIndexDerivedEngine {
  buildMetrics(
    history: ResearchIndexDailyRecord[],
    nifty50History: ResearchIndexDailyRecord[],
  ): ResearchIndexMetrics[] {
    const sorted = byTradeDate(history);
    const benchmark = benchmarkReturns(nifty50History);

    return sorted.map((row, index) => {
      const return1d = returnAt(sorted, index, 1);
      const return5d = returnAt(sorted, index, 5);
      const return20d = returnAt(sorted, index, 20);
      const return60d = returnAt(sorted, index, 60);
      const return120d = returnAt(sorted, index, 120);
      const return252d = returnAt(sorted, index, 252);
      const nifty = benchmark.get(row.tradeDate);

      return {
        tradeDate: row.tradeDate,
        indexCode: row.indexCode,
        return1d,
        return5d,
        return20d,
        return60d,
        return120d,
        return252d,
        rsVsNifty50_5d: relativeStrength(return5d, nifty?.r5 ?? null),
        rsVsNifty50_20d: relativeStrength(return20d, nifty?.r20 ?? null),
        rsVsNifty50_60d: relativeStrength(return60d, nifty?.r60 ?? null),
      };
    });
  }
}

export function latestResearchIndexMetrics(
  history: ResearchIndexDailyRecord[],
  nifty50History: ResearchIndexDailyRecord[],
): ResearchIndexMetrics | null {
  const metrics = new DefaultResearchIndexDerivedEngine().buildMetrics(history, nifty50History);
  return metrics.at(-1) ?? null;
}
