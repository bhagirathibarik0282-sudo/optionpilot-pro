import { RESEARCH_INDEX_CODES } from "./research-index-health.ts";
import type { ResearchIndexCode, ResearchIndexDailyRecord } from "./research-index-types.ts";

export const CANONICAL_MARKET_DNA_HISTORICAL_MEMORY_V1 = "CANONICAL_MARKET_DNA_HISTORICAL_MEMORY_V1" as const;

const WINDOWS = [20, 60, 120, 252, 756, 1260, 2520] as const;
type Window = (typeof WINDOWS)[number];

export interface MarketDnaHistoricalIndexMemory {
  indexCode: ResearchIndexCode;
  observations: number;
  earliestTradeDate: string;
  latestTradeDate: string;
  returnsPct: Record<Window, number | null>;
}

export interface MarketDnaHistoricalMemory {
  version: typeof CANONICAL_MARKET_DNA_HISTORICAL_MEMORY_V1;
  ready: boolean;
  exactSevenCoverage: boolean;
  latestTradeDate: string | null;
  alignedLatestDate: boolean;
  minimumObservations: number;
  archiveBeyond320Ready: boolean;
  tenYearWindowReady: boolean;
  rows: MarketDnaHistoricalIndexMemory[];
  contextOnly: true;
  readOnly: true;
  duplicateVoteForbidden: true;
  affectsDirection: false;
  affectsVerdict: false;
  affectsCandidate: false;
  affectsTelegram: false;
  affectsExecution: false;
  mutatesData: false;
  failClosed: true;
  blockers: string[];
}

function pct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || current <= 0 || previous <= 0) return null;
  return Math.round(((current / previous - 1) * 100) * 10000) / 10000;
}

function validSorted(rows: ResearchIndexDailyRecord[]): ResearchIndexDailyRecord[] {
  return [...rows]
    .filter((row) => row.validationStatus !== "INVALID" && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

export function buildMarketDnaHistoricalMemory(
  histories: Partial<Record<ResearchIndexCode, ResearchIndexDailyRecord[]>>,
): MarketDnaHistoricalMemory {
  const blockers: string[] = [];
  const out: MarketDnaHistoricalIndexMemory[] = [];
  const latestDates: string[] = [];
  let minimumObservations = Number.POSITIVE_INFINITY;

  for (const code of RESEARCH_INDEX_CODES) {
    const rows = validSorted(histories[code] ?? []);
    if (rows.length === 0) {
      blockers.push(`${code}:NO_HISTORY`);
      continue;
    }
    const last = rows.at(-1)!;
    latestDates.push(last.tradeDate);
    minimumObservations = Math.min(minimumObservations, rows.length);
    const returnsPct = {} as Record<Window, number | null>;
    for (const window of WINDOWS) {
      const previous = rows[rows.length - 1 - window];
      returnsPct[window] = previous ? pct(last.close, previous.close) : null;
    }
    out.push({
      indexCode: code,
      observations: rows.length,
      earliestTradeDate: rows[0].tradeDate,
      latestTradeDate: last.tradeDate,
      returnsPct,
    });
  }

  const exactSevenCoverage = out.length === RESEARCH_INDEX_CODES.length;
  if (!exactSevenCoverage) blockers.push(`HISTORICAL_MEMORY_COVERAGE_${out.length}_OF_${RESEARCH_INDEX_CODES.length}`);
  const latestTradeDate = latestDates.length ? [...latestDates].sort().at(-1)! : null;
  const alignedLatestDate = latestTradeDate !== null && latestDates.length === RESEARCH_INDEX_CODES.length
    && latestDates.every((date) => date === latestTradeDate);
  if (!alignedLatestDate) blockers.push("HISTORICAL_MEMORY_LATEST_DATE_NOT_ALIGNED");

  const archiveBeyond320Ready = Number.isFinite(minimumObservations) && minimumObservations > 320;
  if (!archiveBeyond320Ready) blockers.push("HISTORICAL_MEMORY_NOT_BEYOND_320_ROWS");
  const tenYearWindowReady = exactSevenCoverage && out.every((row) => row.returnsPct[2520] !== null);
  if (!tenYearWindowReady) blockers.push("HISTORICAL_MEMORY_2520D_NOT_READY");

  return {
    version: CANONICAL_MARKET_DNA_HISTORICAL_MEMORY_V1,
    ready: blockers.length === 0,
    exactSevenCoverage,
    latestTradeDate,
    alignedLatestDate,
    minimumObservations: Number.isFinite(minimumObservations) ? minimumObservations : 0,
    archiveBeyond320Ready,
    tenYearWindowReady,
    rows: blockers.length === 0 ? out : [],
    contextOnly: true,
    readOnly: true,
    duplicateVoteForbidden: true,
    affectsDirection: false,
    affectsVerdict: false,
    affectsCandidate: false,
    affectsTelegram: false,
    affectsExecution: false,
    mutatesData: false,
    failClosed: true,
    blockers: [...new Set(blockers)],
  };
}
