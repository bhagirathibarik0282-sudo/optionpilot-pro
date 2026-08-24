import type { ResearchIndexCode, ResearchIndexStore } from "./research-index-types.js";
import { normalizeResearchIndexRow } from "./research-index-importer.js";
import { parseOfficialHistoricalIndexCsv } from "./research-index-historical-csv.js";
import { validateResearchIndexRecord } from "./research-index-validator.js";

export interface HistoricalCsvImportAudit {
  mode: "RESEARCH_MODE";
  productionImpact: "NONE";
  indexCode: ResearchIndexCode;
  parsedRows: number;
  skippedRows: number;
  validRows: number;
  rejectedRows: number;
  writtenRows: number;
  writeFailedRows: number;
  firstDate: string | null;
  lastDate: string | null;
  warnings: string[];
  errors: string[];
}

export async function importOfficialHistoricalCsv(
  indexCode: ResearchIndexCode,
  csv: string,
  store: ResearchIndexStore,
): Promise<HistoricalCsvImportAudit> {
  const parsed = parseOfficialHistoricalIndexCsv(indexCode, csv);
  let validRows = 0;
  let rejectedRows = 0;
  let writtenRows = 0;
  let writeFailedRows = 0;
  const warnings = [...parsed.audit.warnings];
  const errors: string[] = [];

  for (const raw of parsed.rows) {
    const record = normalizeResearchIndexRow(indexCode, raw, "NSE_INDICES_PUBLIC_HISTORICAL_EXPORT");
    const validation = validateResearchIndexRecord(record);
    warnings.push(...validation.warnings.map((x) => `${record.tradeDate}:${x}`));
    errors.push(...validation.errors.map((x) => `${record.tradeDate}:${x}`));

    if (!validation.valid) {
      rejectedRows += 1;
      continue;
    }

    validRows += 1;
    record.validationStatus = validation.status;
    const ok = await store.upsertDaily(record);
    if (ok) writtenRows += 1;
    else writeFailedRows += 1;
  }

  return {
    mode: "RESEARCH_MODE",
    productionImpact: "NONE",
    indexCode,
    parsedRows: parsed.audit.parsedRows,
    skippedRows: parsed.audit.skippedRows,
    validRows,
    rejectedRows,
    writtenRows,
    writeFailedRows,
    firstDate: parsed.audit.firstDate,
    lastDate: parsed.audit.lastDate,
    warnings,
    errors,
  };
}
