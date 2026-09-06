import { createHash } from "node:crypto";
import {
  CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1,
  validateCanonicalOfficialUniverseManifest,
  type CanonicalIndexOperatingMode,
  type CanonicalOfficialUniverseManifest,
  type CanonicalOfficialUniverseValidation,
} from "./canonical-official-index-universe-freeze.js";
import type { CanonicalMarketSymbol } from "./canonical-one-roof-market-snapshot.js";

export interface CanonicalOfficialUniverseSourceBundle {
  symbol: CanonicalMarketSymbol;
  operatingMode: CanonicalIndexOperatingMode;
  sourceUrl: string;
  sourceAsOfDate: string;
  sourceSha256: string;
  expectedConstituentCount: number;
  csvContent: string;
}

export interface CanonicalOfficialUniverseIngestResult {
  version: "CANONICAL_OFFICIAL_UNIVERSE_INGEST_V1";
  ready: boolean;
  manifestHash: string | null;
  manifest: CanonicalOfficialUniverseManifest | null;
  sourceHashesVerified: boolean;
  parsedRowCount: number;
  blockers: string[];
  readOnly: true;
  activatesRuntime: false;
  selectsConstituents: false;
  affectsDirection: false;
  affectsVerdict: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

const SYMBOL_HEADERS = new Set(["symbol", "tradingsymbol", "ticker"]);
const SECTOR_HEADERS = new Set(["sector", "industry", "industry name"]);
const WEIGHT_HEADERS = new Set(["weight", "weightpct", "weight pct", "weightage", "weightagepct", "weightage pct", "index weight"]);

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[()%]/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error("OFFICIAL_UNIVERSE_CSV_UNCLOSED_QUOTE");
  values.push(value.trim());
  return values;
}

function uniqueHeaderIndex(headers: string[], aliases: Set<string>, label: string): number {
  const matches = headers.map((header, index) => aliases.has(header) ? index : -1).filter((index) => index >= 0);
  if (matches.length !== 1) throw new Error(`OFFICIAL_UNIVERSE_CSV_${label}_HEADER_${matches.length === 0 ? "MISSING" : "AMBIGUOUS"}`);
  return matches[0];
}

function parseSourceCsv(content: string) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("OFFICIAL_UNIVERSE_CSV_ROWS_REQUIRED");
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const symbolIndex = uniqueHeaderIndex(headers, SYMBOL_HEADERS, "SYMBOL");
  const sectorIndex = uniqueHeaderIndex(headers, SECTOR_HEADERS, "SECTOR");
  const weightIndex = uniqueHeaderIndex(headers, WEIGHT_HEADERS, "WEIGHT");

  return lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    if (values.length !== headers.length) throw new Error(`OFFICIAL_UNIVERSE_CSV_COLUMN_MISMATCH:${rowIndex + 2}`);
    const tradingsymbol = values[symbolIndex]?.trim() ?? "";
    const sector = values[sectorIndex]?.trim() ?? "";
    const weightPct = Number(values[weightIndex]);
    if (!tradingsymbol) throw new Error(`OFFICIAL_UNIVERSE_CSV_SYMBOL_REQUIRED:${rowIndex + 2}`);
    if (!sector) throw new Error(`OFFICIAL_UNIVERSE_CSV_SECTOR_REQUIRED:${rowIndex + 2}`);
    if (!Number.isFinite(weightPct)) throw new Error(`OFFICIAL_UNIVERSE_CSV_WEIGHT_INVALID:${rowIndex + 2}`);
    return { tradingsymbol, sector, weightPct };
  });
}

function result(validation: CanonicalOfficialUniverseValidation | null, sourceHashesVerified: boolean, parsedRowCount: number, blockers: string[]): CanonicalOfficialUniverseIngestResult {
  const ready = Boolean(validation?.ready && sourceHashesVerified && blockers.length === 0);
  return {
    version: "CANONICAL_OFFICIAL_UNIVERSE_INGEST_V1",
    ready,
    manifestHash: ready ? validation!.manifestHash : null,
    manifest: ready ? validation!.manifest : null,
    sourceHashesVerified,
    parsedRowCount,
    blockers: [...new Set([...blockers, ...(validation?.blockers ?? [])])],
    readOnly: true,
    activatesRuntime: false,
    selectsConstituents: false,
    affectsDirection: false,
    affectsVerdict: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}

/**
 * Verifies exact source bytes, strictly parses constituent/sector/weight rows, and delegates
 * full scope/date/count/weight reconciliation to the frozen PR #308 contract.
 */
export function ingestCanonicalOfficialUniverseSources(input: {
  manifestId: string;
  generatedAt: string;
  sources: CanonicalOfficialUniverseSourceBundle[];
  asOfDate: string;
  maxSourceAgeDays: number;
  weightTolerancePct?: number;
}): CanonicalOfficialUniverseIngestResult {
  const blockers: string[] = [];
  if (!Array.isArray(input?.sources) || input.sources.length === 0) {
    return result(null, false, 0, ["OFFICIAL_UNIVERSE_SOURCE_BUNDLES_REQUIRED"]);
  }

  let parsedRowCount = 0;
  const scopes: CanonicalOfficialUniverseManifest["scopes"] = [];
  for (const source of input.sources) {
    try {
      if (typeof source.csvContent !== "string" || source.csvContent.length === 0) {
        throw new Error(`OFFICIAL_UNIVERSE_SOURCE_CONTENT_REQUIRED:${source.symbol}`);
      }
      const actualHash = createHash("sha256").update(source.csvContent, "utf8").digest("hex");
      if (actualHash !== source.sourceSha256.toLowerCase()) {
        throw new Error(`OFFICIAL_UNIVERSE_SOURCE_HASH_MISMATCH:${source.symbol}`);
      }
      const entries = parseSourceCsv(source.csvContent);
      parsedRowCount += entries.length;
      scopes.push({
        symbol: source.symbol,
        operatingMode: source.operatingMode,
        sourceUrl: source.sourceUrl,
        sourceAsOfDate: source.sourceAsOfDate,
        sourceSha256: source.sourceSha256,
        expectedConstituentCount: source.expectedConstituentCount,
        entries,
      });
    } catch (error) {
      blockers.push(error instanceof Error && error.message ? error.message : `OFFICIAL_UNIVERSE_SOURCE_PARSE_FAILED:${source?.symbol ?? "UNKNOWN"}`);
    }
  }
  if (blockers.length > 0) return result(null, false, parsedRowCount, blockers);

  const manifest: CanonicalOfficialUniverseManifest = {
    version: CANONICAL_OFFICIAL_INDEX_UNIVERSE_FREEZE_V1,
    manifestId: input.manifestId,
    generatedAt: input.generatedAt,
    scopes,
  };
  const validation = validateCanonicalOfficialUniverseManifest(manifest, {
    asOfDate: input.asOfDate,
    maxSourceAgeDays: input.maxSourceAgeDays,
    weightTolerancePct: input.weightTolerancePct,
  });
  return result(validation, true, parsedRowCount, []);
}
