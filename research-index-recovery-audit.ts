import { RESEARCH_INDEX_CODES } from "./research-index-health.ts";
import type { ResearchIndexCode } from "./research-index-types.ts";
import type { SqlClient } from "./research-index-store.ts";

export const RESEARCH_INDEX_RECOVERY_AUDIT_V1 = "RESEARCH_INDEX_RECOVERY_AUDIT_V1" as const;
export const CURRENT_RUNTIME_WINDOW_ROWS = 320 as const;

export interface ResearchIndexRecoveryRow {
  indexCode: ResearchIndexCode;
  totalDailyRows: number;
  totalMetricRows: number;
  earliestTradeDate: string | null;
  latestTradeDate: string | null;
  calendarYearsCovered: number | null;
  runtimeWindowRows: number;
  rowsOutsideRuntimeWindow: number;
  archiveExceedsRuntimeWindow: boolean;
  hasApproxTenCalendarYears: boolean;
}

export interface ResearchIndexRecoveryAudit {
  version: typeof RESEARCH_INDEX_RECOVERY_AUDIT_V1;
  ready: boolean;
  exactSevenCoverage: boolean;
  allArchivesExceedRuntimeWindow: boolean;
  allHaveApproxTenCalendarYears: boolean;
  runtimeCurrentlyTruncatesHistory: boolean;
  currentRuntimeWindowRows: typeof CURRENT_RUNTIME_WINDOW_ROWS;
  rows: ResearchIndexRecoveryRow[];
  blockers: string[];
  warnings: string[];
  readOnly: true;
  contextOnly: true;
  affectsVerdict: false;
  affectsCandidate: false;
  affectsTelegram: false;
  affectsExecution: false;
  mutatesData: false;
  failClosed: true;
}

type CountRow = {
  index_code: ResearchIndexCode;
  total_daily_rows: number | string;
  earliest_trade_date: string | Date | null;
  latest_trade_date: string | Date | null;
};

type MetricCountRow = {
  index_code: ResearchIndexCode;
  total_metric_rows: number | string;
};

function dateOnly(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function calendarYearsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / (365.2425 * 86_400_000);
}

export async function auditResearchIndexArchiveRecovery(db: SqlClient): Promise<ResearchIndexRecoveryAudit> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  try {
    const [dailyResult, metricResult] = await Promise.all([
      db.query<CountRow>(
        `SELECT index_code, COUNT(*)::bigint AS total_daily_rows,
                MIN(trade_date) AS earliest_trade_date,
                MAX(trade_date) AS latest_trade_date
         FROM research_index_daily
         GROUP BY index_code`,
      ),
      db.query<MetricCountRow>(
        `SELECT index_code, COUNT(*)::bigint AS total_metric_rows
         FROM research_index_metrics
         GROUP BY index_code`,
      ),
    ]);

    const dailyByCode = new Map(dailyResult.rows.map((row) => [row.index_code, row]));
    const metricByCode = new Map(metricResult.rows.map((row) => [row.index_code, Number(row.total_metric_rows)]));
    const rows: ResearchIndexRecoveryRow[] = [];

    for (const indexCode of RESEARCH_INDEX_CODES) {
      const raw = dailyByCode.get(indexCode);
      if (!raw) {
        blockers.push(`${indexCode}:NO_ARCHIVE_ROWS`);
        continue;
      }
      const totalDailyRows = Number(raw.total_daily_rows);
      const totalMetricRows = metricByCode.get(indexCode) ?? 0;
      const earliestTradeDate = dateOnly(raw.earliest_trade_date);
      const latestTradeDate = dateOnly(raw.latest_trade_date);
      const calendarYearsCovered = calendarYearsBetween(earliestTradeDate, latestTradeDate);
      if (!Number.isFinite(totalDailyRows) || totalDailyRows <= 0) blockers.push(`${indexCode}:INVALID_ARCHIVE_COUNT`);
      if (totalMetricRows <= 0) warnings.push(`${indexCode}:NO_DERIVED_METRICS`);
      const rowsOutsideRuntimeWindow = Math.max(0, totalDailyRows - CURRENT_RUNTIME_WINDOW_ROWS);
      const archiveExceedsRuntimeWindow = totalDailyRows > CURRENT_RUNTIME_WINDOW_ROWS;
      const hasApproxTenCalendarYears = calendarYearsCovered !== null && calendarYearsCovered >= 9.5;
      if (!archiveExceedsRuntimeWindow) warnings.push(`${indexCode}:ARCHIVE_NOT_LARGER_THAN_RUNTIME_WINDOW`);
      if (!hasApproxTenCalendarYears) warnings.push(`${indexCode}:LESS_THAN_APPROX_10_CALENDAR_YEARS`);

      rows.push({
        indexCode,
        totalDailyRows,
        totalMetricRows,
        earliestTradeDate,
        latestTradeDate,
        calendarYearsCovered: calendarYearsCovered === null ? null : Math.round(calendarYearsCovered * 100) / 100,
        runtimeWindowRows: CURRENT_RUNTIME_WINDOW_ROWS,
        rowsOutsideRuntimeWindow,
        archiveExceedsRuntimeWindow,
        hasApproxTenCalendarYears,
      });
    }

    const exactSevenCoverage = rows.length === RESEARCH_INDEX_CODES.length;
    if (!exactSevenCoverage) blockers.push(`ARCHIVE_COVERAGE_${rows.length}_OF_${RESEARCH_INDEX_CODES.length}`);

    const allArchivesExceedRuntimeWindow = exactSevenCoverage && rows.every((row) => row.archiveExceedsRuntimeWindow);
    const allHaveApproxTenCalendarYears = exactSevenCoverage && rows.every((row) => row.hasApproxTenCalendarYears);

    return {
      version: RESEARCH_INDEX_RECOVERY_AUDIT_V1,
      ready: blockers.length === 0,
      exactSevenCoverage,
      allArchivesExceedRuntimeWindow,
      allHaveApproxTenCalendarYears,
      runtimeCurrentlyTruncatesHistory: allArchivesExceedRuntimeWindow,
      currentRuntimeWindowRows: CURRENT_RUNTIME_WINDOW_ROWS,
      rows: blockers.length === 0 ? rows : [],
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
      readOnly: true,
      contextOnly: true,
      affectsVerdict: false,
      affectsCandidate: false,
      affectsTelegram: false,
      affectsExecution: false,
      mutatesData: false,
      failClosed: true,
    };
  } catch (error) {
    return {
      version: RESEARCH_INDEX_RECOVERY_AUDIT_V1,
      ready: false,
      exactSevenCoverage: false,
      allArchivesExceedRuntimeWindow: false,
      allHaveApproxTenCalendarYears: false,
      runtimeCurrentlyTruncatesHistory: false,
      currentRuntimeWindowRows: CURRENT_RUNTIME_WINDOW_ROWS,
      rows: [],
      blockers: [`RESEARCH_ARCHIVE_AUDIT_FAILED:${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
      readOnly: true,
      contextOnly: true,
      affectsVerdict: false,
      affectsCandidate: false,
      affectsTelegram: false,
      affectsExecution: false,
      mutatesData: false,
      failClosed: true,
    };
  }
}
