import type { ResearchIndexCode } from "./research-index-types.js";
import type { ResearchIndexRawRow, ResearchIndexTransport } from "./research-index-importer.js";
import { RESEARCH_INDEX_NAMES } from "./research-index-importer.js";
import { RESEARCH_INDEX_CODES } from "./research-index-health.js";

const INDEX_NAME_ALIASES: Record<ResearchIndexCode, string[]> = {
  NIFTY50: ["NIFTY 50", "Nifty 50"],
  NIFTY100: ["NIFTY 100", "Nifty 100"],
  NIFTY200: ["NIFTY 200", "Nifty 200"],
  NIFTY500: ["NIFTY 500", "Nifty 500"],
  NEXT50: ["NIFTY NEXT 50", "Nifty Next 50"],
  MIDCAP150: ["NIFTY MIDCAP 150", "Nifty Midcap 150"],
  SMALLCAP250: ["NIFTY SMALL CAP 250", "NIFTY SMALLCAP 250", "Nifty Smallcap 250"],
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function field(row: Record<string, string>, ...aliases: string[]): string {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value !== undefined) return value;
  }
  return "";
}

export interface OfficialDailySnapshotRow {
  indexName: string;
  indexDate: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export function parseOfficialDailySnapshotCsv(csv: string): OfficialDailySnapshotRow[] {
  const lines = csv.replace(/\r/g, "").split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const rows: OfficialDailySnapshotRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const mapped: Record<string, string> = {};
    headers.forEach((header, i) => {
      mapped[header] = cells[i] ?? "";
    });

    const indexName = field(mapped, "Index Name");
    const indexDate = field(mapped, "Index Date", "Date");
    const open = field(mapped, "Open Index Value", "Open");
    const high = field(mapped, "High Index Value", "High");
    const low = field(mapped, "Low Index Value", "Low");
    const close = field(mapped, "Closing Index Value", "Close");

    if (!indexName || !indexDate || !open || !high || !low || !close) continue;
    rows.push({ indexName, indexDate, open, high, low, close });
  }

  return rows;
}

function matchesIndex(code: ResearchIndexCode, name: string): boolean {
  const normalized = name.trim().toUpperCase().replace(/\s+/g, " ");
  return INDEX_NAME_ALIASES[code].some(
    (alias) => alias.toUpperCase().replace(/\s+/g, " ") === normalized,
  );
}

function ddmmyyyy(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}${mm}${date.getUTCFullYear()}`;
}

function startOfUtcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function officialDailySnapshotUrl(date: Date): string {
  return `https://www.niftyindices.com/Daily_Snapshot/ind_close_all_${ddmmyyyy(date)}.csv`;
}

export async function fetchOfficialSnapshotCsvForDate(date: Date): Promise<string | null> {
  const url = officialDailySnapshotUrl(date);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "OptionPilot-Pro-Research/1.0",
        accept: "text/csv,text/plain,*/*",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.includes("Index Name") ? text : null;
  } catch {
    return null;
  }
}

function toRaw(row: OfficialDailySnapshotRow): ResearchIndexRawRow {
  return {
    date: row.indexDate,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    sourceTimestamp: null,
  };
}

export async function fetchOfficialHistoricalBundle(
  from: string,
  to: string,
): Promise<Partial<Record<ResearchIndexCode, ResearchIndexRawRow[]>>> {
  const start = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return {};

  const spanDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (spanDays > 370) {
    throw new Error("DAILY_SNAPSHOT_BACKFILL_RANGE_TOO_LARGE_USE_OFFICIAL_HISTORICAL_CSV");
  }

  const bundle: Partial<Record<ResearchIndexCode, ResearchIndexRawRow[]>> = {};
  for (const code of RESEARCH_INDEX_CODES) bundle[code] = [];

  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) continue;
    const csv = await fetchOfficialSnapshotCsvForDate(cursor);
    if (!csv) continue;
    const rows = parseOfficialDailySnapshotCsv(csv);
    for (const code of RESEARCH_INDEX_CODES) {
      const match = rows.find((row) => matchesIndex(code, row.indexName));
      if (match) bundle[code]!.push(toRaw(match));
    }
  }

  return bundle;
}

export class OfficialNiftyDailySnapshotTransport implements ResearchIndexTransport {
  private historicalBundleCache = new Map<string, Promise<Partial<Record<ResearchIndexCode, ResearchIndexRawRow[]>>>>();

  constructor(private readonly latestLookbackCalendarDays = 10) {}

  async fetchLatestRows(indexCode: ResearchIndexCode): Promise<ResearchIndexRawRow[]> {
    const now = new Date();
    for (let offset = 0; offset <= this.latestLookbackCalendarDays; offset += 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
      const csv = await fetchOfficialSnapshotCsvForDate(date);
      if (!csv) continue;
      const match = parseOfficialDailySnapshotCsv(csv).find((row) => matchesIndex(indexCode, row.indexName));
      if (match) return [toRaw(match)];
    }
    return [];
  }

  async fetchHistoricalRows(indexCode: ResearchIndexCode, from: string, to: string): Promise<ResearchIndexRawRow[]> {
    const key = `${from}|${to}`;
    let promise = this.historicalBundleCache.get(key);
    if (!promise) {
      promise = fetchOfficialHistoricalBundle(from, to);
      this.historicalBundleCache.set(key, promise);
    }

    try {
      const bundle = await promise;
      return bundle[indexCode] ?? [];
    } catch (error) {
      this.historicalBundleCache.delete(key);
      throw error;
    }
  }
}

export const officialDailySnapshotSourceInfo = {
  source: "NIFTY_INDICES_OFFICIAL_DAILY_SNAPSHOT",
  indexNames: RESEARCH_INDEX_NAMES,
  historicalBackfillPolicy: "<=370 calendar days via daily snapshots; larger backfill must use official historical CSV export",
  optimizedBundleFetch: true,
  cachedPerRange: true,
  productionImpact: "NONE",
} as const;
