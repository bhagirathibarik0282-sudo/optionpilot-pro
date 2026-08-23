import type { ResearchIndexCode, ResearchIndexStore } from "./research-index-types.js";
import { RESEARCH_INDEX_CODES } from "./research-index-health.js";
import { importOfficialHistoricalCsv, type HistoricalCsvImportAudit } from "./research-index-csv-import.js";

export type ResearchIndexCsvBundle = Partial<Record<ResearchIndexCode, string>>;

export interface BulkHistoricalImportAudit {
  mode: "RESEARCH_MODE";
  productionImpact: "NONE";
  requestedIndices: number;
  completedIndices: number;
  missingIndices: ResearchIndexCode[];
  failedIndices: ResearchIndexCode[];
  totalParsedRows: number;
  totalWrittenRows: number;
  totalRejectedRows: number;
  items: HistoricalCsvImportAudit[];
}

export async function importSevenIndexHistoricalBundle(
  bundle: ResearchIndexCsvBundle,
  store: ResearchIndexStore,
): Promise<BulkHistoricalImportAudit> {
  const items: HistoricalCsvImportAudit[] = [];
  const missingIndices: ResearchIndexCode[] = [];
  const failedIndices: ResearchIndexCode[] = [];

  // Sequential on purpose: large backfills are research jobs and should not
  // create unnecessary concurrent DB pressure.
  for (const indexCode of RESEARCH_INDEX_CODES) {
    const csv = bundle[indexCode];
    if (!csv?.trim()) {
      missingIndices.push(indexCode);
      continue;
    }

    const audit = await importOfficialHistoricalCsv(indexCode, csv, store);
    items.push(audit);
    if (audit.writtenRows === 0 || audit.writeFailedRows > 0 || audit.rejectedRows > 0) {
      failedIndices.push(indexCode);
    }
  }

  return {
    mode: "RESEARCH_MODE",
    productionImpact: "NONE",
    requestedIndices: RESEARCH_INDEX_CODES.length,
    completedIndices: items.length,
    missingIndices,
    failedIndices,
    totalParsedRows: items.reduce((n, x) => n + x.parsedRows, 0),
    totalWrittenRows: items.reduce((n, x) => n + x.writtenRows, 0),
    totalRejectedRows: items.reduce((n, x) => n + x.rejectedRows, 0),
    items,
  };
}
