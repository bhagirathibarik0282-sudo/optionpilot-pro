import type {
  ResearchIndexCode,
  ResearchIndexDailyRecord,
  ResearchIndexMetrics,
} from "./research-index-types.js";
import { evaluateResearchIndexHealth, RESEARCH_INDEX_CODES } from "./research-index-health.js";
import { classifySizeRegime, type SizeRegimeOutput } from "./research-size-regime.js";

export interface ResearchIndexApiSnapshot {
  mode: "RESEARCH_MODE";
  layer: "BROAD_MARKET_SIZE";
  generatedAt: string;
  health: ReturnType<typeof evaluateResearchIndexHealth>;
  regime: SizeRegimeOutput;
  latest: Partial<Record<ResearchIndexCode, ResearchIndexDailyRecord>>;
  metrics: Partial<Record<ResearchIndexCode, ResearchIndexMetrics>>;
  productionImpact: "NONE";
}

function latestRow(rows: ResearchIndexDailyRecord[]): ResearchIndexDailyRecord | undefined {
  return [...rows].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)).at(-1);
}

function latestMetric(rows: ResearchIndexMetrics[]): ResearchIndexMetrics | undefined {
  return [...rows].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)).at(-1);
}

export function buildResearchIndexApiSnapshot(
  rowsByIndex: Partial<Record<ResearchIndexCode, ResearchIndexDailyRecord[]>>,
  metricsByIndex: Partial<Record<ResearchIndexCode, ResearchIndexMetrics[]>>,
  generatedAt = new Date().toISOString(),
): ResearchIndexApiSnapshot {
  const health = evaluateResearchIndexHealth(rowsByIndex);
  const latest: Partial<Record<ResearchIndexCode, ResearchIndexDailyRecord>> = {};
  const metrics: Partial<Record<ResearchIndexCode, ResearchIndexMetrics>> = {};

  for (const code of RESEARCH_INDEX_CODES) {
    const row = latestRow(rowsByIndex[code] ?? []);
    const metric = latestMetric(metricsByIndex[code] ?? []);
    if (row) latest[code] = row;
    if (metric) metrics[code] = metric;
  }

  const regime = classifySizeRegime({ metrics, dataQuality: health.overall });

  return {
    mode: "RESEARCH_MODE",
    layer: "BROAD_MARKET_SIZE",
    generatedAt,
    health,
    regime,
    latest,
    metrics,
    productionImpact: "NONE",
  };
}
