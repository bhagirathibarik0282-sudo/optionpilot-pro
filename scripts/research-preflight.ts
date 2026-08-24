import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseOfficialHistoricalIndexCsv } from "../research-index-historical-csv.js";
import { RESEARCH_INDEX_POPULATION_FILES, RESEARCH_INDEX_POPULATION_ORDER } from "../research-index-population-manifest.js";

const ROOT = process.env.RESEARCH_DATA_DIR?.trim() || "research-data";
const MIN_ROWS = 253;

const report: Array<{
  indexCode: string;
  file: string;
  exists: boolean;
  rows: number;
  skipped: number;
  firstDate: string | null;
  lastDate: string | null;
  detectedIndexNames: string[];
  unexpectedIndexNames: string[];
  ready: boolean;
  blockers: string[];
}> = [];

for (const indexCode of RESEARCH_INDEX_POPULATION_ORDER) {
  const file = RESEARCH_INDEX_POPULATION_FILES[indexCode];
  const path = join(ROOT, file);
  const blockers: string[] = [];

  let csv = "";
  try {
    csv = await readFile(path, "utf8");
  } catch {
    blockers.push("FILE_MISSING");
  }

  if (!csv.trim()) {
    report.push({
      indexCode,
      file,
      exists: false,
      rows: 0,
      skipped: 0,
      firstDate: null,
      lastDate: null,
      detectedIndexNames: [],
      unexpectedIndexNames: [],
      ready: false,
      blockers,
    });
    continue;
  }

  const parsed = parseOfficialHistoricalIndexCsv(indexCode, csv);
  if (parsed.audit.parsedRows < MIN_ROWS) blockers.push(`INSUFFICIENT_ROWS_${parsed.audit.parsedRows}_NEED_${MIN_ROWS}`);
  if (!parsed.audit.firstDate || !parsed.audit.lastDate) blockers.push("MISSING_DATE_RANGE");
  if (parsed.audit.skippedRows > 0) blockers.push(`SKIPPED_ROWS_${parsed.audit.skippedRows}`);
  if (parsed.audit.detectedIndexNames.length === 0) blockers.push("INDEX_NAME_NOT_PRESENT_FOR_CROSSCHECK");
  if (parsed.audit.unexpectedIndexNames.length > 0) blockers.push("INDEX_IDENTITY_MISMATCH");

  report.push({
    indexCode,
    file,
    exists: true,
    rows: parsed.audit.parsedRows,
    skipped: parsed.audit.skippedRows,
    firstDate: parsed.audit.firstDate,
    lastDate: parsed.audit.lastDate,
    detectedIndexNames: parsed.audit.detectedIndexNames,
    unexpectedIndexNames: parsed.audit.unexpectedIndexNames,
    ready: blockers.length === 0,
    blockers,
  });
}

const latestDates = new Set(report.filter((x) => x.lastDate).map((x) => x.lastDate));
const alignedLatestDate = latestDates.size <= 1;
if (!alignedLatestDate) {
  for (const item of report) {
    item.blockers.push("LATEST_DATE_MISMATCH");
    item.ready = false;
  }
}

const ready = report.every((x) => x.ready) && alignedLatestDate;
console.log(JSON.stringify({
  mode: "RESEARCH_MODE",
  productionImpact: "NONE",
  dataDir: ROOT,
  expectedFiles: RESEARCH_INDEX_POPULATION_ORDER.length,
  ready,
  alignedLatestDate,
  report,
}, null, 2));

if (!ready) process.exitCode = 2;
