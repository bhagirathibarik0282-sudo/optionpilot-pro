import type { ResearchIndexCode } from "./research-index-types.js";
import type { ResearchIndexRawRow } from "./research-index-importer.js";

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
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeIndexName(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const EXPECTED_INDEX_NAMES: Record<ResearchIndexCode, string[]> = {
  NIFTY50: ["NIFTY 50"],
  NIFTY100: ["NIFTY 100"],
  NIFTY200: ["NIFTY 200"],
  NIFTY500: ["NIFTY 500"],
  NEXT50: ["NIFTY NEXT 50"],
  MIDCAP150: ["NIFTY MIDCAP 150", "NIFTY MID CAP 150"],
  SMALLCAP250: ["NIFTY SMALLCAP 250", "NIFTY SMALL CAP 250"],
};

function expectedIndexNameSet(indexCode: ResearchIndexCode): Set<string> {
  return new Set(EXPECTED_INDEX_NAMES[indexCode].map(normalizeIndexName));
}

function getField(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value !== undefined) return value;
  }
  return "";
}

function missingNumeric(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return normalized === "" || normalized === "-" || normalized === "--" || normalized === "NA" || normalized === "N/A";
}

function parseDateMs(value: string): number | null {
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  const match = value.trim().match(/^(\d{1,2})[-\/]([A-Za-z]{3}|\d{1,2})[-\/](\d{4})$/);
  if (!match) return null;
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface HistoricalCsvParseAudit {
  indexCode: ResearchIndexCode;
  parsedRows: number;
  skippedRows: number;
  partialOhlRows: number;
  firstDate: string | null;
  lastDate: string | null;
  detectedIndexNames: string[];
  unexpectedIndexNames: string[];
  warnings: string[];
}

export interface HistoricalCsvParseResult {
  rows: ResearchIndexRawRow[];
  audit: HistoricalCsvParseAudit;
}

export function parseOfficialHistoricalIndexCsv(
  indexCode: ResearchIndexCode,
  csv: string,
): HistoricalCsvParseResult {
  const lines = csv.replace(/\r/g, "").split("\n").filter((line) => line.trim().length > 0);
  const warnings: string[] = [];
  if (lines.length < 2) {
    return {
      rows: [],
      audit: {
        indexCode,
        parsedRows: 0,
        skippedRows: 0,
        partialOhlRows: 0,
        firstDate: null,
        lastDate: null,
        detectedIndexNames: [],
        unexpectedIndexNames: [],
        warnings: ["EMPTY_OR_HEADER_ONLY_CSV"],
      },
    };
  }

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const rows: ResearchIndexRawRow[] = [];
  const detectedIndexNames = new Set<string>();
  let skippedRows = 0;
  let partialOhlRows = 0;

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const mapped: Record<string, string> = {};
    headers.forEach((header, i) => {
      mapped[header] = cells[i] ?? "";
    });

    const sourceIndexName = getField(mapped, ["Index Name", "IndexName", "Index"]);
    if (sourceIndexName.trim()) detectedIndexNames.add(sourceIndexName.trim());

    const date = getField(mapped, ["Date", "Index Date"]);
    const open = getField(mapped, ["Open", "Open Index Value"]);
    const high = getField(mapped, ["High", "High Index Value"]);
    const low = getField(mapped, ["Low", "Low Index Value"]);
    const close = getField(mapped, ["Close", "Closing Index Value"]);

    // Date + Close are the minimum safe requirements for return/RS research.
    // Missing official O/H/L are preserved as null and never fabricated.
    if (!date || missingNumeric(close)) {
      skippedRows += 1;
      continue;
    }

    const partial = [open, high, low].some(missingNumeric);
    if (partial) partialOhlRows += 1;

    rows.push({
      date,
      open: missingNumeric(open) ? null : open,
      high: missingNumeric(high) ? null : high,
      low: missingNumeric(low) ? null : low,
      close,
      sourceTimestamp: null,
    });
  }

  if (skippedRows > 0) warnings.push(`SKIPPED_ROWS_${skippedRows}`);
  if (partialOhlRows > 0) warnings.push(`PARTIAL_OHL_ROWS_${partialOhlRows}`);

  const allowedNames = expectedIndexNameSet(indexCode);
  const detectedNames = [...detectedIndexNames].sort();
  const unexpectedIndexNames = detectedNames.filter((name) => !allowedNames.has(normalizeIndexName(name)));
  if (detectedNames.length === 0) warnings.push("INDEX_NAME_NOT_PRESENT_FOR_CROSSCHECK");
  if (unexpectedIndexNames.length > 0) warnings.push("UNEXPECTED_INDEX_NAME_PRESENT");

  const datedRows = rows
    .map((row) => ({ row, ms: parseDateMs(row.date) }))
    .filter((item): item is { row: ResearchIndexRawRow; ms: number } => item.ms !== null)
    .sort((a, b) => a.ms - b.ms);

  if (rows.length > 0 && datedRows.length !== rows.length) warnings.push("UNPARSEABLE_DATE_PRESENT");

  return {
    rows,
    audit: {
      indexCode,
      parsedRows: rows.length,
      skippedRows,
      partialOhlRows,
      firstDate: datedRows[0]?.row.date ?? null,
      lastDate: datedRows.at(-1)?.row.date ?? null,
      detectedIndexNames: detectedNames,
      unexpectedIndexNames,
      warnings,
    },
  };
}

export const historicalCsvPolicy = {
  source: "NSE_INDICES_PUBLIC_HISTORICAL_EXPORT",
  use: "ONE_TIME_OR_PERIODIC_RESEARCH_BACKFILL",
  liveTradingUse: false,
  productionImpact: "NONE",
  note: "Use the official Historical Index Data CSV export for long backfills; preserve legitimate missing O/H/L as null and never fabricate values.",
} as const;
