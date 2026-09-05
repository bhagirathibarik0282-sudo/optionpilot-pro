import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { analyzeH1TheoryReplay, type H1TheoryAnalysisResult } from "./h1-theory-analysis.js";
import { runH1ReplayHttp, type H1ReplayRequest, type H1ReplaySymbol } from "./h1-replay-http.js";

export interface H1TheoryRecordedDate {
  tradeDate: string;
  symbol: H1ReplaySymbol;
  markerCount: number;
  firstMinute: string | null;
  lastMinute: string | null;
}

export interface H1TheoryDateIndexResult {
  ok: boolean;
  mode: "READ_ONLY_H1_RECORDED_DATE_INDEX_V1";
  productionImpact: "NONE";
  dates: H1TheoryRecordedDate[];
  affectsVerdict: false;
  affectsTelegram: false;
  affectsExecution: false;
  reason?: string;
}

type DateRow = { trade_date: string | Date; symbol: H1ReplaySymbol; marker_count: string | number; first_minute: string | Date | null; last_minute: string | Date | null };

function dateOnly(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

function iso(value: string | Date | null): string | null {
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export async function listH1TheoryRecordedDates(): Promise<H1TheoryDateIndexResult> {
  const base = { mode: "READ_ONLY_H1_RECORDED_DATE_INDEX_V1" as const, productionImpact: "NONE" as const, affectsVerdict: false as const, affectsTelegram: false as const, affectsExecution: false as const };
  if (!dbIsConfigured()) return { ...base, ok: false, dates: [], reason: "DATABASE_URL_NOT_CONFIGURED" };
  const result = await dbQuerySafe<DateRow>(`
    SELECT
      ((payload->>'minuteBucket')::timestamptz AT TIME ZONE 'Asia/Kolkata')::date AS trade_date,
      payload->>'symbol' AS symbol,
      COUNT(DISTINCT date_trunc('minute', (payload->>'minuteBucket')::timestamptz)) AS marker_count,
      MIN(date_trunc('minute', (payload->>'minuteBucket')::timestamptz)) AS first_minute,
      MAX(date_trunc('minute', (payload->>'minuteBucket')::timestamptz)) AS last_minute
    FROM app_state_log
    WHERE kind = 'H1_TRUTH_MARKER'
      AND payload->>'symbol' IN ('NIFTY', 'SENSEX', 'BANKNIFTY')
      AND payload->>'minuteBucket' IS NOT NULL
      AND payload->>'truthVerdict' = 'TRUE'
    GROUP BY trade_date, payload->>'symbol'
    ORDER BY trade_date DESC,
      CASE payload->>'symbol' WHEN 'NIFTY' THEN 1 WHEN 'SENSEX' THEN 2 ELSE 3 END
  `);
  if (!result) return { ...base, ok: false, dates: [], reason: "H1_RECORDED_DATE_QUERY_FAILED" };
  return {
    ...base,
    ok: true,
    dates: result.rows.map((row) => ({
      tradeDate: dateOnly(row.trade_date),
      symbol: row.symbol,
      markerCount: Number(row.marker_count),
      firstMinute: iso(row.first_minute),
      lastMinute: iso(row.last_minute),
    })),
  };
}

export async function runH1TheoryDateAnalysis(request: H1ReplayRequest): Promise<H1TheoryAnalysisResult> {
  const replay = await runH1ReplayHttp(request);
  return analyzeH1TheoryReplay(request, replay);
}

