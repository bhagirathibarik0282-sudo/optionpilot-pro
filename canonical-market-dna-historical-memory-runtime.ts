import type { SqlClient } from "./research-index-store.ts";
import type { ResearchIndexCode, ResearchIndexDailyRecord, ValidationStatus } from "./research-index-types.ts";
import { RESEARCH_INDEX_CODES } from "./research-index-health.ts";
import { buildMarketDnaHistoricalMemory, type MarketDnaHistoricalMemory } from "./canonical-market-dna-historical-memory.ts";

type DbRow = {
  trade_date: string | Date;
  index_code: ResearchIndexCode;
  close: number | string;
  validation_status: ValidationStatus;
};

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export async function loadMarketDnaHistoricalMemoryFromDb(db: SqlClient): Promise<MarketDnaHistoricalMemory> {
  try {
    const result = await db.query<DbRow>(
      `SELECT trade_date,index_code,close,validation_status
       FROM research_index_daily
       WHERE index_code = ANY($1::text[])
       ORDER BY index_code ASC, trade_date ASC`,
      [RESEARCH_INDEX_CODES],
    );

    const histories: Partial<Record<ResearchIndexCode, ResearchIndexDailyRecord[]>> = {};
    for (const code of RESEARCH_INDEX_CODES) histories[code] = [];

    for (const row of result.rows) {
      if (!RESEARCH_INDEX_CODES.includes(row.index_code)) continue;
      histories[row.index_code]!.push({
        tradeDate: dateOnly(row.trade_date),
        indexCode: row.index_code,
        indexName: row.index_code,
        open: null,
        high: null,
        low: null,
        close: Number(row.close),
        triClose: null,
        source: "RESEARCH_INDEX_DAILY_ARCHIVE",
        sourceTimestamp: null,
        freshnessStatus: "UNKNOWN",
        validationStatus: row.validation_status,
      });
    }

    return buildMarketDnaHistoricalMemory(histories);
  } catch (error) {
    return {
      version: "CANONICAL_MARKET_DNA_HISTORICAL_MEMORY_V1",
      ready: false,
      exactSevenCoverage: false,
      latestTradeDate: null,
      alignedLatestDate: false,
      minimumObservations: 0,
      archiveBeyond320Ready: false,
      tenYearWindowReady: false,
      rows: [],
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
      blockers: [`HISTORICAL_MEMORY_DB_LOAD_FAILED:${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
