import type { ResearchIndexCode, ResearchIndexDailyRecord, ResearchIndexMetrics } from "./research-index-types.js";
import { RESEARCH_INDEX_CODES } from "./research-index-health.js";

export interface ResearchIndexReadinessAudit {
  mode: "RESEARCH_MODE";
  productionImpact: "NONE";
  ready: boolean;
  coverage: string;
  latestTradeDate: string | null;
  alignedLatestDate: boolean;
  minimumHistoryObservations: number;
  metricsCoverage: string;
  blockers: string[];
  warnings: string[];
  perIndex: Record<ResearchIndexCode, {
    historyObservations: number;
    latestTradeDate: string | null;
    has252Lookback: boolean;
    hasMetrics: boolean;
  }>;
}

export function buildResearchIndexReadinessAudit(
  histories: Partial<Record<ResearchIndexCode, ResearchIndexDailyRecord[]>>,
  metrics: Partial<Record<ResearchIndexCode, ResearchIndexMetrics[]>>,
): ResearchIndexReadinessAudit {
  const perIndex = {} as ResearchIndexReadinessAudit["perIndex"];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const latestDates: string[] = [];
  let covered = 0;
  let metricsCovered = 0;
  let minimumHistoryObservations = Number.POSITIVE_INFINITY;

  for (const code of RESEARCH_INDEX_CODES) {
    const history = [...(histories[code] ?? [])].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    const metricRows = metrics[code] ?? [];
    const latestTradeDate = history.at(-1)?.tradeDate ?? null;
    const has252Lookback = history.length >= 253;
    const hasMetrics = metricRows.length > 0;

    if (history.length > 0) {
      covered += 1;
      minimumHistoryObservations = Math.min(minimumHistoryObservations, history.length);
    } else {
      blockers.push(`${code}:NO_HISTORY`);
    }

    if (latestTradeDate) latestDates.push(latestTradeDate);
    if (hasMetrics) metricsCovered += 1;
    else blockers.push(`${code}:NO_METRICS`);

    if (!has252Lookback) warnings.push(`${code}:LESS_THAN_253_OBSERVATIONS`);

    perIndex[code] = {
      historyObservations: history.length,
      latestTradeDate,
      has252Lookback,
      hasMetrics,
    };
  }

  const latestTradeDate = latestDates.length ? [...latestDates].sort().at(-1) ?? null : null;
  const alignedLatestDate = latestTradeDate !== null && latestDates.length === RESEARCH_INDEX_CODES.length
    && latestDates.every((d) => d === latestTradeDate);

  if (!alignedLatestDate) blockers.push("LATEST_TRADE_DATE_NOT_ALIGNED");
  if (covered !== RESEARCH_INDEX_CODES.length) blockers.push(`COVERAGE_${covered}_OF_${RESEARCH_INDEX_CODES.length}`);
  if (metricsCovered !== RESEARCH_INDEX_CODES.length) blockers.push(`METRICS_${metricsCovered}_OF_${RESEARCH_INDEX_CODES.length}`);

  const allHaveLongLookback = RESEARCH_INDEX_CODES.every((code) => perIndex[code].has252Lookback);
  if (!allHaveLongLookback) blockers.push("INSUFFICIENT_252D_LOOKBACK_FOR_FULL_LAB");

  return {
    mode: "RESEARCH_MODE",
    productionImpact: "NONE",
    ready: blockers.length === 0,
    coverage: `${covered}/${RESEARCH_INDEX_CODES.length}`,
    latestTradeDate,
    alignedLatestDate,
    minimumHistoryObservations: Number.isFinite(minimumHistoryObservations) ? minimumHistoryObservations : 0,
    metricsCoverage: `${metricsCovered}/${RESEARCH_INDEX_CODES.length}`,
    blockers,
    warnings,
    perIndex,
  };
}
