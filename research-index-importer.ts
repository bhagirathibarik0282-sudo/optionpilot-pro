import type {
  ResearchIndexCode,
  ResearchIndexDailyRecord,
  ResearchIndexImporter,
} from "./research-index-types.js";
import { validateResearchIndexBatch } from "./research-index-validator.js";

export const RESEARCH_INDEX_NAMES: Record<ResearchIndexCode, string> = {
  NIFTY50: "NIFTY 50",
  NIFTY100: "NIFTY 100",
  NIFTY200: "NIFTY 200",
  NIFTY500: "NIFTY 500",
  NEXT50: "NIFTY NEXT 50",
  MIDCAP150: "NIFTY MIDCAP 150",
  SMALLCAP250: "NIFTY SMALLCAP 250",
};

export interface ResearchIndexRawRow {
  date: string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  triClose?: string | number | null;
  sourceTimestamp?: string | null;
}

export interface ResearchIndexTransport {
  fetchHistoricalRows(indexCode: ResearchIndexCode, from: string, to: string): Promise<ResearchIndexRawRow[]>;
  fetchLatestRows(indexCode: ResearchIndexCode): Promise<ResearchIndexRawRow[]>;
}

function numberOrNaN(value: string | number): number {
  if (typeof value === "number") return value;
  return Number(String(value).replace(/,/g, "").trim());
}

function nullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = numberOrNaN(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return trimmed;
  return d.toISOString().slice(0, 10);
}

export function normalizeResearchIndexRow(
  indexCode: ResearchIndexCode,
  raw: ResearchIndexRawRow,
  source = "NIFTY_INDICES_OFFICIAL",
): ResearchIndexDailyRecord {
  const tradeDate = normalizeDate(raw.date);
  const record: ResearchIndexDailyRecord = {
    tradeDate,
    indexCode,
    indexName: RESEARCH_INDEX_NAMES[indexCode],
    open: numberOrNaN(raw.open),
    high: numberOrNaN(raw.high),
    low: numberOrNaN(raw.low),
    close: numberOrNaN(raw.close),
    triClose: nullableNumber(raw.triClose),
    source,
    sourceTimestamp: raw.sourceTimestamp ?? null,
    freshnessStatus: "UNKNOWN",
    validationStatus: "PARTIAL",
  };
  return record;
}

export class DefaultResearchIndexImporter implements ResearchIndexImporter {
  constructor(private readonly transport: ResearchIndexTransport) {}

  async fetchHistorical(indexCode: ResearchIndexCode, from: string, to: string): Promise<ResearchIndexDailyRecord[]> {
    try {
      const raw = await this.transport.fetchHistoricalRows(indexCode, from, to);
      const normalized = raw.map((row) => normalizeResearchIndexRow(indexCode, row));
      const deduped = Array.from(new Map(normalized.map((row) => [`${row.indexCode}:${row.tradeDate}`, row])).values())
        .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
      const validation = validateResearchIndexBatch(deduped);
      if (!validation.valid) {
        console.warn("[research-index-importer] historical batch contains invalid data", {
          indexCode,
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }
      return deduped;
    } catch (error) {
      console.error("[research-index-importer] historical fetch failed", { indexCode, error });
      return [];
    }
  }

  async fetchLatest(indexCode: ResearchIndexCode): Promise<ResearchIndexDailyRecord | null> {
    try {
      const rows = await this.transport.fetchLatestRows(indexCode);
      const normalized = rows.map((row) => normalizeResearchIndexRow(indexCode, row));
      normalized.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
      return normalized.at(-1) ?? null;
    } catch (error) {
      console.error("[research-index-importer] latest fetch failed", { indexCode, error });
      return null;
    }
  }
}

// Deliberately no undocumented web endpoint is embedded here. The transport
// must be supplied by a verified official-download adapter or an approved
// archived CSV loader. This prevents silent breakage when a website changes.
